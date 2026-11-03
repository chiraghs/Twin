/** Executive KPIs — all derived from the shared factory state. */
import { riskFromStatus } from "./health";
import { round } from "./math";
import type { AssetStatus, FactoryState, LineHourRecord } from "./types";

export interface OeeBreakdown {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

export function oeeOf(records: LineHourRecord[]): OeeBreakdown {
  const planned = records.reduce((s, r) => s + r.plannedHours, 0);
  const run = records.reduce((s, r) => s + r.runHours, 0);
  const ideal = records.reduce((s, r) => s + r.idealUnits, 0);
  const good = records.reduce((s, r) => s + r.goodUnits, 0);
  const scrap = records.reduce((s, r) => s + r.scrapUnits, 0);
  const availability = planned > 0 ? run / planned : 0;
  const performance = ideal > 0 ? Math.min(1, (good + scrap) / ideal) : 0;
  const quality = good + scrap > 0 ? good / (good + scrap) : 0;
  return {
    availability: round(availability, 4),
    performance: round(performance, 4),
    quality: round(quality, 4),
    oee: round(availability * performance * quality, 4),
  };
}

function windowRecords(state: FactoryState, hours: number) {
  const end = state.clock.hour;
  return state.production.filter((r) => r.hour >= Math.floor(end - hours) && r.hour <= end);
}

export interface FactoryKpis {
  oee: OeeBreakdown;
  oeeByLine: Record<string, OeeBreakdown>;
  output: { actual: number; target: number; attainment: number };
  energy: { kwh: number; idleKwh: number; kwhPerUnit: number; byLine: Record<string, number> };
  scrap: { units: number; rate: number };
  health: { distribution: Record<AssetStatus, number>; average: number; atRisk: number };
  incidents: { open: number; critical: number };
  inventory: { belowReorder: number; items: { id: string; name: string; onHand: number; reorderPoint: number; coverageHours: number }[] };
  windowHours: number;
}

/** Hourly consumption of an inventory item by current line allocations. */
export function consumptionPerHour(state: FactoryState, itemId: string) {
  let rate = 0;
  for (const l of state.lines) {
    if (l.state === "down" || l.state === "maintenance") continue;
    for (const [pid, share] of Object.entries(l.allocation)) {
      const cap = l.capabilities.find((c) => c.productId === pid);
      const b = cap?.bom.find((x) => x.itemId === itemId);
      if (cap && b) rate += cap.ratePerHour * share * b.qty * (l.kind === "packaging" ? 1 : 1 + l.baseScrapRate);
    }
  }
  return rate;
}

export function computeKpis(state: FactoryState, windowHours = 8): FactoryKpis {
  const recs = windowRecords(state, windowHours);
  const lineIds = state.lines.map((l) => l.id);
  const assembly = state.lines.filter((l) => l.kind === "assembly").map((l) => l.id);
  const packaging = state.lines.filter((l) => l.kind === "packaging").map((l) => l.id);
  const oeeByLine = Object.fromEntries(lineIds.map((id) => [id, oeeOf(recs.filter((r) => r.lineId === id))]));
  const oee = oeeOf(recs.filter((r) => assembly.includes(r.lineId)));
  const outRecs = recs.filter((r) => packaging.includes(r.lineId));
  const actual = outRecs.reduce((s, r) => s + r.goodUnits, 0);
  const asmTarget = recs.filter((r) => assembly.includes(r.lineId)).reduce((s, r) => s + r.targetUnits, 0);
  const kwh = recs.reduce((s, r) => s + r.energyKwh, 0);
  const idleKwh = recs.reduce((s, r) => s + r.idleEnergyKwh, 0);
  const scrapUnits = recs.reduce((s, r) => s + r.scrapUnits, 0);
  const goodAsm = recs.filter((r) => assembly.includes(r.lineId)).reduce((s, r) => s + r.goodUnits, 0);
  const scrapAsm = recs.filter((r) => assembly.includes(r.lineId)).reduce((s, r) => s + r.scrapUnits, 0);
  const distribution: Record<AssetStatus, number> = { healthy: 0, warning: 0, critical: 0, offline: 0, maintenance: 0 };
  for (const a of state.assets) distribution[a.status]++;
  const items = state.inventory.map((i) => {
    const rate = consumptionPerHour(state, i.id);
    return {
      id: i.id,
      name: i.name,
      onHand: round(i.onHand, 0),
      reorderPoint: i.reorderPoint,
      coverageHours: rate > 0 ? round(i.onHand / rate, 1) : Infinity,
    };
  });
  return {
    oee,
    oeeByLine,
    output: { actual: round(actual, 0), target: round(asmTarget, 0), attainment: asmTarget > 0 ? round(actual / asmTarget, 4) : 0 },
    energy: {
      kwh: round(kwh, 1),
      idleKwh: round(idleKwh, 1),
      kwhPerUnit: actual > 0 ? round(kwh / actual, 3) : 0,
      byLine: Object.fromEntries(lineIds.map((id) => [id, round(recs.filter((r) => r.lineId === id).reduce((s, r) => s + r.energyKwh, 0), 1)])),
    },
    scrap: { units: round(scrapUnits, 0), rate: goodAsm + scrapAsm > 0 ? round(scrapAsm / (goodAsm + scrapAsm), 4) : 0 },
    health: {
      distribution,
      average: round(state.assets.reduce((s, a) => s + a.healthScore, 0) / Math.max(1, state.assets.length), 1),
      atRisk: state.assets.filter((a) => ["high", "critical"].includes(riskFromStatus(a))).length,
    },
    incidents: {
      open: state.incidents.filter((i) => i.status !== "resolved").length,
      critical: state.incidents.filter((i) => i.status !== "resolved" && i.severity === "critical").length,
    },
    inventory: { belowReorder: items.filter((i) => i.onHand < i.reorderPoint || i.coverageHours < 24).length, items },
    windowHours,
  };
}

export interface HourlyKpiPoint {
  hour: number;
  target: number;
  actual: number;
  oee: number;
  scrap: number;
  energy: Record<string, number>;
  energyTotal: number;
  idleEnergy: number;
}

/** Hour-by-hour series for charts (most recent `hours` complete or in-progress buckets). */
export function hourlySeries(state: FactoryState, hours = 24): HourlyKpiPoint[] {
  const assembly = new Set(state.lines.filter((l) => l.kind === "assembly").map((l) => l.id));
  const packaging = new Set(state.lines.filter((l) => l.kind === "packaging").map((l) => l.id));
  const end = Math.floor(state.clock.hour + 1e-9);
  const out: HourlyKpiPoint[] = [];
  for (let h = end - hours + 1; h <= end; h++) {
    const recs = state.production.filter((r) => r.hour === h);
    if (!recs.length) continue;
    const asm = recs.filter((r) => assembly.has(r.lineId));
    const planned = asm.reduce((s, r) => s + r.plannedHours, 0);
    // Normalise a partially elapsed hour to an hourly rate so the latest bar is comparable.
    const frac = planned > 0 && asm.length ? planned / asm.length : 1;
    const scale = frac > 0 ? 1 / frac : 1;
    out.push({
      hour: h,
      target: round(asm.reduce((s, r) => s + r.targetUnits, 0) * scale, 0),
      actual: round(recs.filter((r) => packaging.has(r.lineId)).reduce((s, r) => s + r.goodUnits, 0) * scale, 0),
      oee: round(oeeOf(asm).oee * 100, 1),
      scrap: round(asm.reduce((s, r) => s + r.scrapUnits, 0) * scale, 1),
      energy: Object.fromEntries(recs.map((r) => [r.lineId, round(r.energyKwh * scale, 1)])),
      energyTotal: round(recs.reduce((s, r) => s + r.energyKwh, 0) * scale, 1),
      idleEnergy: round(recs.reduce((s, r) => s + r.idleEnergyKwh, 0) * scale, 2),
    });
  }
  return out;
}
