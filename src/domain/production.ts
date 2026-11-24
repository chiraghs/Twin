/**
 * Production figures for the Production tab of a machine and the plant's Production analytics page.
 * Everything comes from the plant model's hourly production records and live machine signals, the
 * same data the KPIs use: no new numbers are invented here.
 */
import { computeKpis, oeeOf, type OeeBreakdown } from "./kpis";
import { lineOutputRate } from "./intralogistics";
import { round } from "./math";
import { cycleTime, machineStates, partCounts, type MachineStateInfo } from "./process-signals";
import type { Asset, FactoryState, LineHourRecord, ProductionLine } from "./types";

export interface LineLosses {
  /** Hours in the window, summed over the line's hourly records. */
  planned: number;
  run: number;
  plannedDown: number;
  unplannedDown: number;
  changeover: number;
  starved: number;
}

export interface HourPoint {
  hour: number;
  good: number;
  scrap: number;
  target: number;
}

export interface LineProduction {
  id: string;
  name: string;
  kind: ProductionLine["kind"];
  state: ProductionLine["state"];
  oee: OeeBreakdown;
  good: number;
  reject: number;
  rejectPct: number;
  target: number;
  /** Units per hour now, and at the allocated products' rated speed. */
  rate: number;
  ratedRate: number;
  bottleneckId: string | null;
  losses: LineLosses;
  hourly: HourPoint[];
}

export interface MachineProduction {
  assetId: string;
  /** Units this machine processed in the window, from its own throughput readings. */
  units: number;
  /** Its units per complete hour (last 12), against its nameplate rate. */
  hourlyUnits: { hour: number; units: number; nameplate: number }[];
  state: MachineStateInfo | null;
  throughput: number;
  nameplate: number;
  /** Throughput as a share of nameplate (0–1+). */
  pace: number;
  speedPct: number;
  utilization: number;
  cycle: { idealS: number; actualS: number | null; lossPct: number | null };
  rejectsCaused: number;
  /** Share of its line's rejects this machine caused (0–1). */
  rejectShare: number;
  line: LineProduction | null;
}

type Weighted = LineHourRecord & { w?: number };
const sum = (rs: Weighted[], k: keyof Omit<LineHourRecord, "scrapByCause" | "lineId" | "hour">) => rs.reduce((s, r) => s + r[k] * (r.w ?? 1), 0);

/** The line's hourly records in the window; the hour the window starts in counts for the part inside it. */
function recordsFor(state: FactoryState, lineId: string, hours: number): Weighted[] {
  const since = state.clock.hour - hours;
  return state.production.filter((r) => r.lineId === lineId && r.hour + 1 > since).map((r) => (r.hour >= since ? r : { ...r, w: r.hour + 1 - since }));
}

function ratedRate(line: ProductionLine) {
  return Object.entries(line.allocation).reduce((s, [pid, share]) => s + (line.capabilities.find((c) => c.productId === pid)?.ratePerHour ?? 0) * share, 0);
}

const scale = (r: LineHourRecord, w: number): LineHourRecord => ({
  ...r,
  plannedHours: r.plannedHours * w,
  runHours: r.runHours * w,
  idealUnits: r.idealUnits * w,
  goodUnits: r.goodUnits * w,
  scrapUnits: r.scrapUnits * w,
});

export function lineProduction(state: FactoryState, line: ProductionLine, hours = 8, states = machineStates(state)): LineProduction {
  const rs = recordsFor(state, line.id, hours);
  const good = sum(rs, "goodUnits");
  const reject = sum(rs, "scrapUnits");
  const end = Math.floor(state.clock.hour + 1e-9);
  const hourly: HourPoint[] = [];
  // Complete hours only: the hour in progress would read as a sudden drop.
  for (let h = end - 12; h < end; h++) {
    const hr = state.production.filter((r) => r.lineId === line.id && r.hour === h);
    if (!hr.length) continue;
    hourly.push({ hour: h, good: round(sum(hr, "goodUnits"), 0), scrap: round(sum(hr, "scrapUnits"), 0), target: round(sum(hr, "targetUnits"), 0) });
  }
  return {
    id: line.id,
    name: line.name,
    kind: line.kind,
    state: line.state,
    oee: oeeOf(rs.map((r) => (r.w === undefined ? r : scale(r, r.w)))),
    good: Math.round(good),
    reject: Math.round(reject),
    rejectPct: good + reject > 0 ? round((reject / (good + reject)) * 100, 2) : 0,
    target: Math.round(sum(rs, "targetUnits")),
    rate: round(lineOutputRate(state, line), 0),
    ratedRate: round(ratedRate(line), 0),
    bottleneckId: line.assetIds.find((id) => states[id]?.bottleneck) ?? null,
    losses: {
      planned: round(sum(rs, "plannedHours"), 2),
      run: round(sum(rs, "runHours"), 2),
      plannedDown: round(sum(rs, "plannedDownHours"), 2),
      unplannedDown: round(sum(rs, "unplannedDownHours"), 2),
      changeover: round(sum(rs, "changeoverHours"), 2),
      starved: round(sum(rs, "starvedHours"), 2),
    },
    hourly,
  };
}

/**
 * Units a machine processed between two plant hours: its throughput readings (units/h, about every
 * 10 min) integrated over time, counting only the time it was running.
 */
export function machineUnits(state: FactoryState, assetId: string, from: number, to: number): number {
  const rs = state.telemetry[assetId] ?? [];
  let units = 0;
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1];
    const b = rs[i];
    const lo = Math.max(a.t, from);
    const hi = Math.min(b.t, to);
    if (hi <= lo) continue;
    const rate = ((a.running ? a.throughput : 0) + (b.running ? b.throughput : 0)) / 2;
    units += rate * (hi - lo);
  }
  return Math.round(units);
}

export function machineProduction(state: FactoryState, asset: Asset, hours = 8): MachineProduction {
  const states = machineStates(state);
  const line = state.lines.find((l) => l.id === asset.lineId) ?? null;
  const lp = line ? lineProduction(state, line, hours, states) : null;
  const caused = partCounts(state).byMachine[asset.id] ?? 0;
  const now = state.clock.hour;
  const end = Math.floor(now + 1e-9);
  const hourlyUnits: MachineProduction["hourlyUnits"] = [];
  const first = (state.telemetry[asset.id] ?? [])[0]?.t ?? now;
  for (let h = end - 12; h < end; h++) if (h >= Math.floor(first)) hourlyUnits.push({ hour: h, units: machineUnits(state, asset.id, h, h + 1), nameplate: asset.nominalRate });
  return {
    assetId: asset.id,
    units: machineUnits(state, asset.id, now - hours, now),
    hourlyUnits,
    state: states[asset.id] ?? null,
    throughput: round(asset.signal.throughput, 0),
    nameplate: asset.nominalRate,
    pace: asset.nominalRate > 0 ? round(asset.signal.throughput / asset.nominalRate, 3) : 0,
    speedPct: asset.speedPct,
    utilization: asset.utilization,
    cycle: cycleTime(asset),
    rejectsCaused: caused,
    rejectShare: lp && lp.reject > 0 ? round(Math.min(1, caused / lp.reject), 3) : 0,
    line: lp,
  };
}

/** The whole plant over the last `hours`: headline KPIs, every line, every machine and the open orders. */
export function plantProduction(state: FactoryState, hours = 8) {
  const states = machineStates(state);
  const kpis = computeKpis(state, hours);
  const lines = state.lines.map((l) => lineProduction(state, l, hours, states));
  const machines = state.assets.map((a) => machineProduction(state, a, hours));
  const orders = state.orders
    .filter((o) => o.completedHour === null)
    .sort((a, b) => a.dueHour - b.dueHour)
    .map((o) => ({ ...o, product: state.products.find((p) => p.id === o.productId)?.name ?? o.productId, progress: o.quantity > 0 ? Math.min(1, o.fulfilled / o.quantity) : 1, dueIn: round(o.dueHour - state.clock.hour, 1) }));
  return { hours, kpis, lines, machines, orders };
}
