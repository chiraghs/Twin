/**
 * Process signals beyond run / throughput / vibration / temperature: the electrical side, process
 * values per machine type, cycle time, machine state with its reason, the line bottleneck, part
 * counts, remaining useful life, zone environment and mobile-robot batteries.
 *
 * Pure functions of the factory state (deterministic noise keyed on the plant clock), so the
 * browser, the server, the copilot and the simulated PLC all see the same values.
 */
import { diagnoseAsset } from "./anomaly";
import type { Amr } from "./intralogistics";
import { clamp, gaussian, round } from "./math";
import type { Asset, AssetKind, FactoryState, ProductionLine } from "./types";

/**
 * Plant-wide results are computed once per clock tick and state object (callers ask per machine).
 * The key includes what changes them between ticks: machine modes, speeds and open incidents.
 */
function perTick<T>(cache: WeakMap<FactoryState, { key: string; v: T }>, state: FactoryState, fn: () => T): T {
  const key = `${state.clock.tick}:${state.clock.hour}:${state.production.length}:${state.incidents.length}:${state.assets.map((a) => a.mode[0] + a.speedPct).join("")}:${state.lines.map((l) => l.state[0]).join("")}`;
  const hit = cache.get(state);
  if (hit && hit.key === key) return hit.v;
  const v = fn();
  cache.set(state, { key, v });
  return v;
}
const statesCache = new WeakMap<FactoryState, { key: string; v: Record<string, MachineStateInfo> }>();
const countsCache = new WeakMap<FactoryState, { key: string; v: ReturnType<typeof computePartCounts> }>();

const noise = (s: FactoryState, key: string, sd: number) => gaussian(s.seed, `${key}:${s.clock.tick}`) * sd;

/* ─────────────────────────── machine state ─────────────────────────── */

export type MachineState = "running" | "idle" | "starved" | "blocked" | "changeover" | "fault" | "maintenance";

/** Numeric codes for PLC registers and sequencer conditions. */
export const MACHINE_STATE_CODE: Record<MachineState, number> = { running: 0, idle: 1, starved: 2, blocked: 3, changeover: 4, fault: 5, maintenance: 6 };

export interface MachineStateInfo {
  assetId: string;
  state: MachineState;
  reason: string;
  /** This machine sets its line's pace (the constraint). */
  bottleneck: boolean;
}

const pace = (a: Asset) => (a.nominalRate > 0 ? a.signal.throughput / a.nominalRate : 1);

function missingMaterial(state: FactoryState, line: ProductionLine): string | null {
  const ids = new Set<string>();
  for (const pid of Object.keys(line.allocation)) for (const b of line.capabilities.find((c) => c.productId === pid)?.bom ?? []) ids.add(b.itemId);
  return state.inventory.find((i) => ids.has(i.id) && i.onHand <= 0)?.name ?? null;
}

/** Every machine's state with a reason, line by line in flow order. */
export function machineStates(state: FactoryState): Record<string, MachineStateInfo> {
  return perTick(statesCache, state, () => computeMachineStates(state));
}

function computeMachineStates(state: FactoryState): Record<string, MachineStateInfo> {
  const out: Record<string, MachineStateInfo> = {};
  const byId = new Map(state.assets.map((a) => [a.id, a]));
  for (const line of state.lines) {
    const ms = line.assetIds.map((id) => byId.get(id)).filter((a): a is Asset => !!a);
    const stoppedAt = ms.findIndex((a) => a.mode !== "running");
    const stopper = stoppedAt >= 0 ? ms[stoppedAt] : null;
    const running = ms.filter((a) => a.mode === "running" && a.nominalRate > 0);
    // Every machine on a line moves at the line's rate, so the constraint is the machine running
    // closest to its own capacity; the others have spare capacity and wait on it.
    const max = running.length > 1 && !stopper && line.state === "running" ? running.reduce((m, a) => (pace(a) > pace(m) ? a : m)) : null;
    const constraint = max && pace(max) >= 0.85 ? max : null;
    const upstream = state.lines.find((l) => l.downstreamLineId === line.id);
    ms.forEach((a, i) => {
      const set = (st: MachineState, reason: string, bottleneck = false) => void (out[a.id] = { assetId: a.id, state: st, reason, bottleneck });
      if (a.mode === "down") {
        const inc = state.incidents.find((x) => x.assetId === a.id && x.status !== "resolved");
        return set("fault", inc ? inc.title : "Tripped: waiting for repair", true);
      }
      if (a.mode === "maintenance") return set("maintenance", "Planned maintenance in progress", true);
      if (line.state === "changeover") return set("changeover", "Product changeover on the line");
      if (line.state === "idle") return set("idle", "No production scheduled on this line");
      if (stopper) {
        return i < stoppedAt
          ? set("blocked", `Blocked: ${stopper.name} downstream is ${stopper.mode === "down" ? "down" : "in maintenance"}`)
          : set("starved", `Starved: ${stopper.name} upstream is ${stopper.mode === "down" ? "down" : "in maintenance"}`);
      }
      if (line.state === "starved") {
        const item = missingMaterial(state, line);
        if (i === 0) return set("starved", item ? `Starved: ${item} is out of stock` : upstream ? `Starved: waiting for product from ${upstream.name}` : "Starved: waiting for material", true);
        return set("starved", "Starved: nothing coming from upstream");
      }
      if (line.state === "down" || line.state === "maintenance") return set("idle", `Line ${line.state === "down" ? "stopped" : "in maintenance"}`);
      if (constraint && a.id === constraint.id) return set("running", `Bottleneck: at ${Math.round(pace(a) * 100)}% of its capacity, it sets the line's pace`, true);
      if (constraint) return set("running", `Running at ${Math.round(pace(a) * 100)}% of capacity, paced by ${constraint.name}`);
      return set("running", upstream ? `Running at ${Math.round(pace(a) * 100)}% of capacity, paced by product arriving from upstream` : "Running");
    });
  }
  return out;
}

/** The constraint of each line (and the plant's worst one): what limits throughput, and why. */
export function bottlenecks(state: FactoryState) {
  const st = machineStates(state);
  const perLine = state.lines.map((l) => {
    const hit = l.assetIds.map((id) => st[id]).find((x) => x?.bottleneck) ?? null;
    return { lineId: l.id, lineName: l.name, lineState: l.state, assetId: hit?.assetId ?? null, reason: hit?.reason ?? (l.state === "running" ? "Balanced: no single machine limits the line" : `Line ${l.state}`) };
  });
  return perLine;
}

/* ─────────────────────────── electrical & process ─────────────────────────── */

export interface Electrical {
  voltageV: number;
  currentA: number;
  powerFactor: number;
  /** 0–1 share of rated load. */
  load: number;
}

export function electrical(state: FactoryState, a: Asset): Electrical {
  const span = Math.max(0.1, a.ratedPowerKw - a.idlePowerKw);
  const load = clamp((a.signal.powerKw - a.idlePowerKw) / span, 0, 1.3);
  const wear = clamp((a.signal.vibration - a.baseline.vibration) / Math.max(0.1, a.thresholds.vibrationTrip - a.baseline.vibration), 0, 1);
  const voltageV = 400 + noise(state, `${a.id}:V`, 1.8);
  // Lightly loaded motors run at a poor power factor; worn bearings pull extra reactive current.
  const powerFactor = clamp(0.62 + 0.24 * Math.min(1, load) - 0.05 * wear + noise(state, `${a.id}:pf`, 0.005), 0.5, 0.95);
  const currentA = a.signal.powerKw > 0 ? (a.signal.powerKw * 1000) / (Math.sqrt(3) * voltageV * powerFactor) : 0;
  return { voltageV: round(voltageV, 1), currentA: round(currentA, 1), powerFactor: round(powerFactor, 3), load: round(load, 3) };
}

export interface ProcessValue {
  key: string;
  name: string;
  unit: string;
  value: number;
  limits?: { alarm: number; trip: number };
}

/** Wear since last service as a share of the service interval (tool, nozzle, die, electrode wear). */
export const wearPct = (state: FactoryState, a: Asset) => clamp(((state.clock.hour - a.lastMaintenanceHour) / Math.max(1, a.maintenanceIntervalHours)) * 100, 0, 150);

type Proc = { key: string; name: string; unit: string; nominal: number; alarm?: number; trip?: number; wear?: number; idle?: number };
/** Process values per machine type: nominal at full load; `wear` raises it as the machine degrades. */
const PROCESS: Partial<Record<AssetKind, Proc[]>> = {
  press: [{ key: "Pressure", name: "Hydraulic pressure", unit: "bar", nominal: 180, alarm: 215, trip: 235, wear: 0.12, idle: 40 }],
  filler: [
    { key: "Pressure", name: "Fill pressure", unit: "bar", nominal: 2.4, alarm: 3.0, trip: 3.4, wear: 0.1, idle: 0.3 },
    { key: "Flow", name: "Product flow", unit: "L/min", nominal: 120, idle: 0 },
  ],
  pump: [
    { key: "Pressure", name: "Discharge pressure", unit: "bar", nominal: 6, alarm: 7.5, trip: 8.5, wear: -0.15, idle: 0.5 },
    { key: "Flow", name: "Flow", unit: "m³/h", nominal: 40, wear: -0.12, idle: 0 },
  ],
  mixer: [{ key: "Flow", name: "Ingredient flow", unit: "L/min", nominal: 85, idle: 0 }, { key: "Torque", name: "Agitator torque", unit: "%", nominal: 62, alarm: 85, trip: 95, wear: 0.25, idle: 5 }],
  extruder: [{ key: "Pressure", name: "Melt pressure", unit: "bar", nominal: 160, alarm: 210, trip: 240, wear: 0.15, idle: 10 }, { key: "Torque", name: "Screw torque", unit: "%", nominal: 68, alarm: 88, trip: 96, wear: 0.2, idle: 5 }],
  molder: [{ key: "Pressure", name: "Injection pressure", unit: "bar", nominal: 1100, alarm: 1400, trip: 1550, wear: 0.12, idle: 0 }],
  cnc: [{ key: "SpindleLoad", name: "Spindle load", unit: "%", nominal: 58, alarm: 85, trip: 95, wear: 0.35, idle: 3 }],
  robot: [{ key: "JointLoad", name: "Peak joint load", unit: "%", nominal: 55, alarm: 82, trip: 92, wear: 0.4, idle: 4 }],
  welder: [{ key: "WeldCurrent", name: "Weld current", unit: "A", nominal: 9500, alarm: 11000, trip: 12000, wear: 0.1, idle: 0 }],
  oven: [{ key: "ZoneTemp", name: "Zone setpoint error", unit: "°C", nominal: 1.5, alarm: 6, trip: 10, wear: 3, idle: 0.5 }],
  packager: [{ key: "Vacuum", name: "Vacuum", unit: "kPa", nominal: -65, idle: -5 }],
  palletizer: [{ key: "JointLoad", name: "Gripper load", unit: "%", nominal: 48, alarm: 80, trip: 92, wear: 0.3, idle: 3 }],
  conveyor: [{ key: "MotorLoad", name: "Drive load", unit: "%", nominal: 45, alarm: 80, trip: 95, wear: 0.4, idle: 8 }],
};

/** Machine types whose tools / dies / nozzles wear and get replaced at service. */
const TOOLED = new Set<AssetKind>(["cnc", "press", "welder", "robot", "molder", "extruder", "filler", "labeler"]);

export function processValues(state: FactoryState, a: Asset): ProcessValue[] {
  const e = electrical(state, a);
  const running = a.mode === "running" && a.signal.throughput > 0;
  const deg = clamp((a.signal.vibration - a.baseline.vibration) / Math.max(0.1, a.thresholds.vibrationTrip - a.baseline.vibration), 0, 1.2);
  const out: ProcessValue[] = (PROCESS[a.kind] ?? []).map((p) => {
    const atLoad = p.nominal * (0.75 + 0.25 * Math.min(1.2, e.load)) * (1 + (p.wear ?? 0) * deg);
    const v = running ? atLoad + noise(state, `${a.id}:${p.key}`, Math.abs(p.nominal) * 0.012) : (p.idle ?? 0);
    return { key: p.key, name: p.name, unit: p.unit, value: round(v, Math.abs(p.nominal) >= 100 ? 0 : 2), ...(p.alarm !== undefined && p.trip !== undefined ? { limits: { alarm: p.alarm, trip: p.trip } } : {}) };
  });
  if (TOOLED.has(a.kind)) out.push({ key: "ToolWear", name: a.kind === "welder" ? "Electrode wear" : a.kind === "filler" ? "Nozzle wear" : "Tool wear", unit: "%", value: round(wearPct(state, a), 0), limits: { alarm: 90, trip: 110 } });
  return out;
}

/** Seconds per unit: ideal from nameplate rate, actual from measured throughput (null when not producing). */
export function cycleTime(a: Asset) {
  const ideal = a.nominalRate > 0 ? 3600 / a.nominalRate : 0;
  const actual = a.mode === "running" && a.signal.throughput > 0.5 ? 3600 / a.signal.throughput : null;
  return { idealS: round(ideal, 2), actualS: actual === null ? null : round(actual, 2), lossPct: actual === null || ideal <= 0 ? null : round(((actual - ideal) / ideal) * 100, 1) };
}

/* ─────────────────────────── counts ─────────────────────────── */

/** Good and rejected units over the last 8 hours: per line, and the rejects each machine caused. */
export function partCounts(state: FactoryState) {
  return perTick(countsCache, state, () => computePartCounts(state, 8));
}

function computePartCounts(state: FactoryState, hours: number) {
  const since = state.clock.hour - hours;
  const recs = state.production.filter((r) => r.hour >= since);
  const lines: Record<string, { good: number; reject: number; rejectPct: number }> = {};
  const byMachine: Record<string, number> = {};
  for (const l of state.lines) {
    const rs = recs.filter((r) => r.lineId === l.id);
    const good = rs.reduce((s, r) => s + r.goodUnits, 0);
    const reject = rs.reduce((s, r) => s + r.scrapUnits, 0);
    lines[l.id] = { good: Math.round(good), reject: Math.round(reject), rejectPct: good + reject > 0 ? round((reject / (good + reject)) * 100, 2) : 0 };
    for (const r of rs) for (const [cause, v] of Object.entries(r.scrapByCause ?? {})) if (cause !== "process") byMachine[cause] = (byMachine[cause] ?? 0) + v;
  }
  for (const k of Object.keys(byMachine)) byMachine[k] = Math.round(byMachine[k]);
  return { hours, lines, byMachine };
}

/* ─────────────────────────── remaining useful life ─────────────────────────── */

export interface RemainingLife {
  assetId: string;
  /** Hours until the trip limit at the current wear rate; null when no wear trend. */
  hoursToTrip: number | null;
  hoursToAlarm: number | null;
  tripProbability24h: number;
  /** Hours until the planned service (negative: overdue). */
  serviceDueHours: number;
  /** One line for boards and speech. */
  summary: string;
  tone: "ok" | "warn" | "bad";
}

const fmtH = (h: number) => (h < 1 ? "under an hour" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);

export function remainingLife(state: FactoryState, a: Asset): RemainingLife {
  const d = diagnoseAsset(state, a);
  const hTrip = Number.isFinite(d.hoursToTrip) ? d.hoursToTrip : null;
  const hAlarm = Number.isFinite(d.hoursToAlarm) ? d.hoursToAlarm : null;
  const due = round(a.lastMaintenanceHour + a.maintenanceIntervalHours - state.clock.hour, 0);
  let summary: string;
  let tone: RemainingLife["tone"] = "ok";
  if (a.mode === "down") {
    summary = "Failed: down until repaired";
    tone = "bad";
  } else if (hTrip !== null && hTrip <= 0) {
    summary = "At the trip limit now";
    tone = "bad";
  } else if (hTrip !== null && hTrip < 168) {
    summary = `Predicted trip in ${fmtH(hTrip)} (${Math.round(d.tripProbability24h * 100)}% within 24 h)`;
    tone = hTrip < 48 ? "bad" : "warn";
  } else if (due < 0) {
    summary = `No wear trend · service overdue by ${fmtH(-due)}`;
    tone = "warn";
  } else summary = `No wear trend · service due in ${fmtH(due)}`;
  return { assetId: a.id, hoursToTrip: hTrip === null ? null : round(hTrip, 1), hoursToAlarm: hAlarm === null ? null : round(hAlarm, 1), tripProbability24h: d.tripProbability24h, serviceDueHours: due, summary, tone };
}

/* ─────────────────────────── environment ─────────────────────────── */

export interface ZoneEnvironment {
  lineId: string;
  temperatureC: number;
  humidityPct: number;
  /** Fine particulates, µg/m³ (welding, molding, ovens raise it). */
  pm25: number;
  noiseDb: number;
}

const FUMES: Partial<Record<AssetKind, number>> = { welder: 22, molder: 6, extruder: 6, oven: 5, cnc: 4 };

export function zoneEnvironment(state: FactoryState): ZoneEnvironment[] {
  const ambient = state.costModel.ambientTemperature ?? 22;
  const byId = new Map(state.assets.map((a) => [a.id, a]));
  return state.lines.map((l) => {
    const ms = l.assetIds.map((id) => byId.get(id)).filter((a): a is Asset => !!a);
    const run = ms.filter((a) => a.mode === "running" && a.signal.throughput > 0);
    const heatKw = ms.reduce((s, a) => s + a.signal.powerKw, 0);
    const temperatureC = ambient + Math.min(9, heatKw * 0.035) + noise(state, `${l.id}:zt`, 0.15);
    const humidityPct = clamp(48 - (temperatureC - ambient) * 1.6 + noise(state, `${l.id}:rh`, 0.6), 25, 75);
    const pm25 = 6 + run.reduce((s, a) => s + (FUMES[a.kind] ?? 1) * Math.min(1.2, a.signal.throughput / Math.max(1, a.nominalRate)), 0) + noise(state, `${l.id}:pm`, 0.4);
    // Each running machine radiates ~72 dB at baseline vibration, +20·log10 of the vibration ratio; levels add logarithmically.
    const levels = run.map((a) => 72 + 20 * Math.log10(Math.max(0.5, a.signal.vibration / Math.max(0.1, a.baseline.vibration))));
    const noiseDb = levels.length ? 10 * Math.log10(levels.reduce((s, L) => s + 10 ** (L / 10), 0)) : 45;
    return { lineId: l.id, temperatureC: round(temperatureC, 1), humidityPct: round(humidityPct, 0), pm25: round(Math.max(2, pm25), 1), noiseDb: round(noiseDb, 0) };
  });
}

/* ─────────────────────────── mobile-robot batteries ─────────────────────────── */

export interface RobotBattery {
  id: string;
  pct: number;
  charging: boolean;
  /** Active robots wait for a charger below 20 %. */
  low: boolean;
}

/**
 * Battery of each mobile robot: active robots drain ~13 %/h on missions and charge ~45 %/h at the
 * charger (opportunity charging below 25 %); parked robots barely drain. Staggered per robot.
 */
export function robotBatteries(state: FactoryState, fleet: Amr[]): RobotBattery[] {
  const drain = 13;
  const charge = 45;
  const hi = 95;
  const lo = 25;
  const period = (hi - lo) / drain + (hi - lo) / charge;
  return fleet.map((r, i) => {
    const t = state.clock.hour + i * period * 0.37;
    const ph = ((t % period) + period) % period;
    const draining = ph < (hi - lo) / drain;
    let pct = draining ? hi - ph * drain : lo + (ph - (hi - lo) / drain) * charge;
    if (r.status === "parked") pct = Math.max(lo, pct - 4);
    return { id: r.id, pct: round(clamp(pct, 0, 100), 0), charging: !draining && r.status !== "parked", low: pct < 30 };
  });
}

/* ─────────────────────────── one-shot summary (copilot, voice) ─────────────────────────── */

/** Why a line is (not) producing, in one sentence: for the copilot and for spoken answers. */
export function throughputExplanation(state: FactoryState, lineId?: string): string {
  const st = machineStates(state);
  const pick = lineId ? state.lines.filter((l) => l.id === lineId) : state.lines;
  return pick
    .map((l) => {
      const hit = l.assetIds.map((id) => st[id]).find((x) => x?.bottleneck);
      const a = hit ? state.assets.find((x) => x.id === hit.assetId) : null;
      if (!a || !hit) return `${l.name} is ${l.state}${l.state === "running" ? " with no single bottleneck" : ""}.`;
      return `${l.name}: ${a.id} ${a.name} is the constraint (${hit.reason.replace(/^Bottleneck: /, "")}).`;
    })
    .join(" ");
}
