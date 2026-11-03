/**
 * Visual quality model.
 *
 * Inspection results are derived from the plant model, not invented: every scrapped unit is
 * attributed to a cause (baseline process or a specific degraded machine) and mapped to the
 * defect classes an AOI / final-inspection station would report. Camera "views" are pure
 * functions of the shared factory state, so simulated feeds always agree with the twin.
 */
import { ARCHETYPES, ASSET_KINDS, type DefectClass } from "./archetypes";
import { hashString, linearFit, mean, round } from "./math";
import { readingsFor } from "./telemetry";
import type { Asset, AssetKind, Camera, FactoryState, LineHourRecord } from "./types";

export type { DefectClass };

const ASSEMBLY_PROCESS: DefectClass[] = [
  { type: "Solder bridging", share: 0.3, criterion: "IPC-A-610 soldering criteria" },
  { type: "Insufficient solder", share: 0.25, criterion: "IPC-A-610 soldering criteria" },
  { type: "Lifted lead", share: 0.2, criterion: "IPC-A-610 component lead criteria" },
  { type: "Solder balls", share: 0.15, criterion: "IPC-A-610 cleanliness / solder ball criteria" },
  { type: "Polarity error", share: 0.1, criterion: "IPC-A-610 orientation criteria" },
];
const PACKAGING_PROCESS: DefectClass[] = [
  { type: "Barcode grade below C", share: 0.4, criterion: "ISO/IEC 15416 print-quality grade" },
  { type: "Carton seal open", share: 0.35, criterion: "Pack-out seal criteria" },
  { type: "Count mismatch", share: 0.25, criterion: "Pack-out count check" },
];
const BY_MACHINE: Record<AssetKind, DefectClass[]> = Object.fromEntries(ASSET_KINDS.map((k) => [k, ARCHETYPES[k].defects])) as Record<AssetKind, DefectClass[]>;

/** Electronics sites use IPC-A-610 classes; other industries use their machines' own defect classes. */
export const usesIpc = (state: Pick<FactoryState, "profile">) => /electron|pcb|smt|semicon|circuit/i.test(`${state.profile.industry} ${state.profile.productionType}`);

function processDefects(state: FactoryState, lineId: string): DefectClass[] {
  const line = state.lines.find((l) => l.id === lineId);
  if (line?.kind === "packaging") return PACKAGING_PROCESS;
  if (usesIpc(state)) return ASSEMBLY_PROCESS;
  const kinds = [...new Set((line?.assetIds ?? []).map((id) => state.assets.find((a) => a.id === id)?.kind).filter((k): k is AssetKind => !!k && k !== "camera" && k !== "conveyor"))];
  const all = kinds.flatMap((k) => BY_MACHINE[k].map((d) => ({ ...d, share: d.share / kinds.length })));
  return all.length ? all : [{ type: "Process defect (unclassified)", share: 1, criterion: "Product specification" }];
}

export function defectMix(state: FactoryState, lineId: string, cause: string): DefectClass[] {
  if (cause === "process") return processDefects(state, lineId);
  const a = state.assets.find((x) => x.id === cause);
  return a ? BY_MACHINE[a.kind] : ASSEMBLY_PROCESS;
}

export interface StationHour {
  hour: number;
  inspected: number;
  defects: number;
  rate: number;
}

export interface InspectionStation {
  camera: Camera;
  lineId: string;
  lineName: string;
  inspected: number;
  defects: number;
  fpy: number;
  dpmo: number;
  opportunities: number;
  defectTypes: { type: string; count: number; share: number; criterion: string; cause: string }[];
  causes: { cause: string; label: string; count: number; share: number }[];
  hourly: StationHour[];
  recentRate: number; // last 2 complete hours
  baselineRate: number; // earlier hours in the window
}

export interface Correlation {
  assetId: string;
  lineId: string;
  r: number;
  slope: number; // defect-rate points per mm/s
  n: number;
  points: { hour: number; vibration: number; defectRate: number }[];
}

export interface QualityReport {
  windowHours: number;
  stations: InspectionStation[];
  rty: number; // rolled throughput yield along assembly → pack-out
  totalInspected: number;
  totalDefects: number;
  pareto: { type: string; count: number; share: number; cumulative: number }[];
  correlations: Correlation[];
  ipcClass: 2;
}

const causeLabel = (state: FactoryState, cause: string) =>
  cause === "process" ? "Baseline process" : (state.assets.find((a) => a.id === cause)?.name ?? cause);

function lineOpportunities(state: FactoryState, lineId: string) {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return 1;
  if (line.kind === "packaging") return 3; // label, barcode, seal
  const entries = Object.entries(line.allocation).filter(([, s]) => s > 0);
  const total = entries.reduce((s, [, sh]) => s + sh, 0) || 1;
  return entries.reduce((s, [pid, sh]) => s + (state.products.find((p) => p.id === pid)?.inspectionOpportunities ?? 100) * (sh / total), 0);
}

function stationFor(state: FactoryState, camera: Camera, recs: LineHourRecord[]): InspectionStation {
  const lineId = camera.lineId!;
  const lineRecs = recs.filter((r) => r.lineId === lineId);
  const inspected = lineRecs.reduce((s, r) => s + r.goodUnits + r.scrapUnits, 0);
  const defects = lineRecs.reduce((s, r) => s + r.scrapUnits, 0);
  const causeTotals: Record<string, number> = {};
  for (const r of lineRecs) for (const [c, v] of Object.entries(r.scrapByCause ?? {})) causeTotals[c] = (causeTotals[c] ?? 0) + v;
  const typeTotals = new Map<string, { count: number; criterion: string; cause: string }>();
  for (const [cause, count] of Object.entries(causeTotals)) {
    for (const d of defectMix(state, lineId, cause)) {
      const prev = typeTotals.get(d.type);
      const add = count * d.share;
      typeTotals.set(d.type, { count: (prev?.count ?? 0) + add, criterion: d.criterion, cause: prev && prev.count > add ? prev.cause : cause });
    }
  }
  const opportunities = lineOpportunities(state, lineId);
  const hourly: StationHour[] = lineRecs
    .map((r) => {
      const n = r.goodUnits + r.scrapUnits;
      return { hour: r.hour, inspected: round(n, 1), defects: round(r.scrapUnits, 2), rate: n > 0 ? r.scrapUnits / n : 0 };
    })
    .sort((a, b) => a.hour - b.hour);
  const complete = hourly.filter((h) => h.inspected > 0);
  const recent = complete.slice(-3, -1).length ? complete.slice(-3, -1) : complete.slice(-2);
  const earlier = complete.slice(0, Math.max(1, complete.length - 3));
  return {
    camera,
    lineId,
    lineName: state.lines.find((l) => l.id === lineId)?.name ?? lineId,
    inspected: round(inspected, 0),
    defects: round(defects, 1),
    fpy: inspected > 0 ? round(1 - defects / inspected, 5) : 1,
    dpmo: inspected > 0 ? round((defects / (inspected * opportunities)) * 1e6, 0) : 0,
    opportunities: round(opportunities, 0),
    defectTypes: [...typeTotals.entries()]
      .map(([type, v]) => ({ type, count: round(v.count, 1), share: defects > 0 ? round(v.count / defects, 4) : 0, criterion: v.criterion, cause: v.cause }))
      .sort((a, b) => b.count - a.count),
    causes: Object.entries(causeTotals)
      .map(([cause, count]) => ({ cause, label: causeLabel(state, cause), count: round(count, 1), share: defects > 0 ? round(count / defects, 4) : 0 }))
      .sort((a, b) => b.count - a.count),
    hourly,
    recentRate: round(mean(recent.map((h) => h.rate)), 5),
    baselineRate: round(mean(earlier.map((h) => h.rate)), 5),
  };
}

/** Pearson correlation between a machine's hourly vibration and its line's hourly defect rate. */
function correlate(state: FactoryState, asset: Asset, station: InspectionStation): Correlation | null {
  const readings = readingsFor(state, asset.id).filter((r) => r.running);
  const points: Correlation["points"] = [];
  for (const h of station.hourly) {
    const rs = readings.filter((r) => r.t >= h.hour && r.t < h.hour + 1);
    if (rs.length < 2 || h.inspected < 5) continue;
    points.push({ hour: h.hour, vibration: round(mean(rs.map((r) => r.vibration)), 3), defectRate: round(h.rate, 5) });
  }
  if (points.length < 6) return null;
  const xs = points.map((p) => p.vibration);
  const ys = points.map((p) => p.defectRate);
  const fit = linearFit(xs, ys);
  const r = Math.sign(fit.slope) * Math.sqrt(fit.r2);
  return { assetId: asset.id, lineId: station.lineId, r: round(r, 3), slope: round(fit.slope * 100, 3), n: points.length, points };
}

export function computeQuality(state: FactoryState, windowHours = 24): QualityReport {
  const end = state.clock.hour;
  const recs = state.production.filter((r) => r.hour >= Math.floor(end) - windowHours);
  const stations = state.cameras.filter((c) => c.kind === "inspection" && c.lineId).map((c) => stationFor(state, c, recs));
  const asm = stations.filter((s) => state.lines.find((l) => l.id === s.lineId)?.kind === "assembly");
  const pkg = stations.filter((s) => state.lines.find((l) => l.id === s.lineId)?.kind === "packaging");
  const asmYield = asm.length ? asm.reduce((s, x) => s + x.fpy * x.inspected, 0) / Math.max(1, asm.reduce((s, x) => s + x.inspected, 0)) : 1;
  const pkgYield = pkg.length ? pkg.reduce((s, x) => s + x.fpy, 0) / pkg.length : 1;
  const typeTotals = new Map<string, number>();
  for (const st of stations) for (const d of st.defectTypes) typeTotals.set(d.type, (typeTotals.get(d.type) ?? 0) + d.count);
  const totalDefects = stations.reduce((s, x) => s + x.defects, 0);
  // Shares use the unrounded class totals so the cumulative line ends at exactly 100%.
  const classTotal = [...typeTotals.values()].reduce((a, b) => a + b, 0);
  let cum = 0;
  const pareto = [...typeTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      cum += count;
      return { type, count: round(count, 1), share: classTotal > 0 ? round(count / classTotal, 4) : 0, cumulative: classTotal > 0 ? round(cum / classTotal, 4) : 0 };
    });
  const correlations: Correlation[] = [];
  for (const st of asm) {
    for (const a of state.assets.filter((x) => x.lineId === st.lineId && x.kind !== "camera")) {
      const c = correlate(state, a, st);
      if (c && Math.abs(c.r) >= 0.5) correlations.push(c);
    }
  }
  correlations.sort((a, b) => b.r - a.r);
  return {
    windowHours,
    stations,
    rty: round(asmYield * pkgYield, 5),
    totalInspected: round(stations.reduce((s, x) => s + x.inspected, 0), 0),
    totalDefects: round(totalDefects, 1),
    pareto,
    correlations,
    ipcClass: 2,
  };
}

/* ───────────────────────────── camera views ───────────────────────────── */

export interface Detection {
  label: string;
  tone: "ok" | "warn" | "bad" | "info";
  detail?: string;
}

export interface InspectionFrame {
  unit: number;
  pass: boolean;
  defect: { type: string; criterion: string; x: number; y: number; w: number; h: number } | null;
}

export interface CameraView {
  camera: Camera;
  headline: string;
  detections: Detection[];
  frames: InspectionFrame[]; // inspection cameras: most recent units, newest last
  thermal: { assetId: string; name: string; temperature: number; alarm: number; trip: number }[];
  occupancy: { label: string; value: number; of: number; tone: Detection["tone"] }[];
  recentRate: number | null;
}

/** Deterministic pseudo-random in [0, 1) for a (camera, unit) pair. */
const unitRand = (cameraId: string, unit: number, salt = "") => (hashString(`${cameraId}:${unit}:${salt}`) % 10000) / 10000;

export function inspectionFrames(state: FactoryState, camera: Camera, count = 8, unitOffset = 0): InspectionFrame[] {
  const lineId = camera.lineId!;
  const recs = state.production.filter((r) => r.lineId === lineId);
  const total = Math.floor(recs.reduce((s, r) => s + r.goodUnits + r.scrapUnits, 0)) + unitOffset;
  const last = recs.filter((r) => r.hour >= Math.floor(state.clock.hour) - 1);
  const insp = last.reduce((s, r) => s + r.goodUnits + r.scrapUnits, 0);
  const rate = insp > 0 ? last.reduce((s, r) => s + r.scrapUnits, 0) / insp : 0;
  const causes: Record<string, number> = {};
  for (const r of last) for (const [c, v] of Object.entries(r.scrapByCause ?? {})) causes[c] = (causes[c] ?? 0) + v;
  const causeTotal = Object.values(causes).reduce((a, b) => a + b, 0);
  const pool: DefectClass[] = [];
  for (const [c, v] of Object.entries(causes)) for (const d of defectMix(state, lineId, c)) pool.push({ ...d, share: causeTotal > 0 ? (v / causeTotal) * d.share : 0 });
  const frames: InspectionFrame[] = [];
  for (let u = total - count + 1; u <= total; u++) {
    const fail = unitRand(camera.id, u) < rate;
    let defect: InspectionFrame["defect"] = null;
    if (fail && pool.length) {
      let pick = unitRand(camera.id, u, "type");
      const d = pool.find((x) => (pick -= x.share) < 0) ?? pool[0];
      defect = { type: d.type, criterion: d.criterion, x: 0.12 + unitRand(camera.id, u, "x") * 0.62, y: 0.16 + unitRand(camera.id, u, "y") * 0.5, w: 0.12, h: 0.14 };
    }
    frames.push({ unit: u, pass: !fail, defect });
  }
  return frames;
}

export function cameraView(state: FactoryState, camera: Camera, unitOffset = 0): CameraView {
  const covered = camera.covers.map((id) => state.assets.find((a) => a.id === id)).filter((a): a is Asset => !!a);
  const view: CameraView = { camera, headline: "", detections: [], frames: [], thermal: [], occupancy: [], recentRate: null };
  if (camera.kind === "inspection" && camera.lineId) {
    view.frames = inspectionFrames(state, camera, 8, unitOffset);
    const fails = view.frames.filter((f) => !f.pass).length;
    const recs = state.production.filter((r) => r.lineId === camera.lineId && r.hour >= Math.floor(state.clock.hour) - 1);
    const insp = recs.reduce((s, r) => s + r.goodUnits + r.scrapUnits, 0);
    view.recentRate = insp > 0 ? recs.reduce((s, r) => s + r.scrapUnits, 0) / insp : 0;
    const latest = view.frames[view.frames.length - 1];
    view.headline = latest ? (latest.pass ? `Unit #${latest.unit} · PASS` : `Unit #${latest.unit} · FAIL — ${latest.defect?.type}`) : "No units inspected";
    view.detections.push({ label: `Defect rate (last hour): ${(view.recentRate * 100).toFixed(2)}%`, tone: view.recentRate > 0.04 ? "bad" : view.recentRate > 0.025 ? "warn" : "ok" });
    view.detections.push({ label: `${fails} of last ${view.frames.length} units rejected`, tone: fails ? "warn" : "ok" });
    const host = state.assets.find((a) => a.id === camera.assetId);
    if (host && host.mode !== "running") view.detections.push({ label: "Station not inspecting (line stopped)", tone: "info" });
  } else if (camera.kind === "thermal") {
    view.thermal = covered.map((a) => ({ assetId: a.id, name: a.name, temperature: round(a.signal.temperature, 1), alarm: a.thresholds.temperatureAlarm, trip: a.thresholds.temperatureTrip }));
    const hottest = [...view.thermal].sort((a, b) => b.temperature / b.alarm - a.temperature / a.alarm)[0];
    view.headline = hottest ? `Hottest: ${hottest.assetId} ${hottest.temperature.toFixed(1)} °C` : "No targets";
    for (const t of view.thermal) {
      const ratio = t.temperature / t.alarm;
      view.detections.push({ label: `${t.assetId}: ${t.temperature.toFixed(1)} °C`, tone: ratio >= 1 ? "bad" : ratio >= 0.85 ? "warn" : "ok", detail: `alarm ${t.alarm} °C` });
    }
  } else if (camera.kind === "dock") {
    const open = state.orders.filter((o) => o.completedHour === null);
    view.occupancy = state.orders.map((o) => ({ label: o.id, value: round((o.fulfilled / o.quantity) * 100, 0), of: 100, tone: o.completedHour !== null ? "ok" : o.dueHour - state.clock.hour < 6 && o.fulfilled < o.quantity ? "bad" : "info" }));
    view.headline = `${open.length} trailers loading · ${state.orders.length - open.length} dispatched`;
    for (const o of open.slice(0, 4)) view.detections.push({ label: `${o.id}: ${Math.round((o.fulfilled / o.quantity) * 100)}% loaded`, tone: "info", detail: `due ${Math.max(0, o.dueHour - state.clock.hour).toFixed(0)} h` });
  } else if (camera.id === "CCTV-STORES") {
    view.occupancy = state.inventory.map((i) => ({ label: i.id, value: round(Math.min(100, (i.onHand / (i.reorderPoint * 3)) * 100), 0), of: 100, tone: i.onHand < i.reorderPoint ? "bad" : i.onHand < i.reorderPoint * 1.25 ? "warn" : "ok" }));
    const low = state.inventory.filter((i) => i.onHand < i.reorderPoint * 1.25);
    view.headline = low.length ? `${low.length} rack(s) running low` : "All racks above reorder point";
    for (const i of low) view.detections.push({ label: `${i.id} rack low`, tone: "warn", detail: `${Math.round(i.onHand)} on hand` });
    view.detections.push({ label: "Restricted zone: no unauthorised entry detected", tone: "ok", detail: "advisory" });
  } else {
    const line = state.lines.find((l) => l.id === camera.lineId);
    const throughput = covered.length ? Math.min(...covered.map((a) => a.signal.throughput)) : 0;
    view.headline = line ? `${line.state === "running" ? "Running" : line.state} · ${Math.round(throughput)} units/h counted` : "Monitoring";
    view.detections.push({ label: `Units counted: ${Math.round(throughput)} /h`, tone: "info" });
    for (const a of covered) {
      if (a.mode === "maintenance") {
        const wo = state.workOrders.find((w) => w.assetId === a.id && w.status === "in-progress");
        view.detections.push({ label: `Lock-out zone active at ${a.id}`, tone: "info", detail: wo ? `maintenance crew present · ${wo.id} (expected)` : "maintenance" });
      } else if (a.mode === "down") {
        view.detections.push({ label: `${a.id} stopped`, tone: "bad", detail: "unplanned stop" });
      } else if (a.status === "critical") {
        view.detections.push({ label: `${a.id} flagged by telemetry`, tone: "warn", detail: "watch for abnormal motion" });
      }
    }
    if (line?.state === "changeover") view.detections.push({ label: "Changeover in progress", tone: "info" });
    view.detections.push({ label: "Faces blurred · advisory analytics", tone: "info" });
  }
  return view;
}

/** Hourly vibration ↔ defect-rate trend statistics used by the Quality agent. */
export function defectTrend(station: InspectionStation) {
  const pts = station.hourly.filter((h) => h.inspected > 5);
  if (pts.length < 4) return { slopePerHour: 0, r2: 0 };
  const fit = linearFit(
    pts.map((p) => p.hour),
    pts.map((p) => p.rate),
  );
  return { slopePerHour: fit.slope, r2: fit.r2 };
}

/** Defect classes for the most recent hours on a line (shows how the reject mix is shifting). */
export function recentDefectTypes(state: FactoryState, lineId: string, hours = 3) {
  const recs = state.production.filter((r) => r.lineId === lineId && r.hour >= Math.floor(state.clock.hour) - hours + 1);
  const totals = new Map<string, number>();
  let all = 0;
  for (const r of recs) {
    for (const [cause, count] of Object.entries(r.scrapByCause ?? {})) {
      all += count;
      for (const d of defectMix(state, lineId, cause)) totals.set(d.type, (totals.get(d.type) ?? 0) + count * d.share);
    }
  }
  return [...totals.entries()].map(([type, count]) => ({ type, count: round(count, 1), share: all > 0 ? round(count / all, 4) : 0 })).sort((a, b) => b.count - a.count);
}
