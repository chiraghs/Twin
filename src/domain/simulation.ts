/**
 * What-If scenario engine.
 *
 * A scenario = shared factory state + explicit parameters. The engine:
 *  1. clones the live factory into a SimWorld,
 *  2. CALIBRATES each machine's condition from telemetry (level + OLS trend) — it never
 *     reads the hidden ground-truth degradation,
 *  3. translates plan levers (maintenance window, derating, re-routing, inventory and
 *     order assumptions) into directives,
 *  4. runs the same plant model used by the live twin at 15-minute resolution,
 *  5. computes delivery, downtime, cost, energy, scrap, risk and a transparent score.
 *
 * Everything is deterministic: identical state + parameters ⇒ identical results.
 */
import { PRIORITY_WEIGHT, SCENARIO_DT, SCORE_WEIGHTS, TEMP_PER_VIB_EXCESS } from "./constants";
import { computeHealthScore } from "./health";
import { clamp, round } from "./math";
import { estimateTrend, hoursToThreshold, readingsFor } from "./telemetry";
import type {
  CalibrationNote,
  Directive,
  FactoryState,
  HourlyPoint,
  OrderOutcome,
  ScenarioDefinition,
  ScenarioMetrics,
  ScenarioResult,
  TimelineEvent,
} from "./types";
import { describeAllocation, machineTemperature, machineVibration, stepWorld, worldFromState, type SimWorld } from "./world";

export interface Calibration extends CalibrationNote {
  vibExcess: number;
  vibSlope100: number;
  tempDrift: number;
  tempSlope100: number;
  tStat: number;
}

/** Estimate a machine's condition from its telemetry (what a real twin would do). */
export function calibrateAsset(state: FactoryState, assetId: string): Calibration | null {
  const a = state.assets.find((x) => x.id === assetId);
  if (!a) return null;
  const readings = readingsFor(state, assetId);
  const vib = estimateTrend(readings, "vibration", a.baseline.vibration, 6);
  const tmp = estimateTrend(readings, "temperature", a.baseline.temperature, 6);
  const lastRunning = [...readings].reverse().find((r) => r.running);
  const s = Math.max(0.3, (lastRunning?.speedPct ?? 100) / 100);
  const vibExcess = vib.zScore > 2.5 ? Math.max(0, vib.current - a.baseline.vibration) : 0;
  const vibSlope100 = vib.significant ? vib.slopePerHour / (s * s) : 0;
  const expectedTemp = a.baseline.temperature + TEMP_PER_VIB_EXCESS * vibExcess;
  const tempDrift = tmp.zScore > 2.5 ? Math.max(0, tmp.current - expectedTemp) : 0;
  const tempSlope100 = tmp.significant ? Math.max(0, tmp.slopePerHour - TEMP_PER_VIB_EXCESS * vib.slopePerHour) / s : 0;
  const hVib = hoursToThreshold(a.baseline.vibration + vibExcess, vibSlope100, a.thresholds.vibrationTrip);
  const hTemp = hoursToThreshold(expectedTemp + tempDrift, tempSlope100 + TEMP_PER_VIB_EXCESS * vibSlope100, a.thresholds.temperatureTrip);
  const h = Math.min(hVib, hTemp);
  return {
    assetId,
    vibration: round(a.baseline.vibration + vibExcess, 2),
    vibrationSlope: round(vibSlope100, 3),
    temperature: round(expectedTemp + tempDrift, 1),
    r2: vib.r2,
    n: vib.n,
    hoursToTrip: Number.isFinite(h) ? round(h, 1) : null,
    vibExcess,
    vibSlope100,
    tempDrift,
    tempSlope100,
    tStat: vib.tStat,
  };
}

export const MAINTENANCE_HOURS_BY_KIND: Record<string, number> = {
  robot: 6,
  press: 5,
  conveyor: 3,
  camera: 2,
  packager: 6,
  labeler: 3,
};

export function primaryProductOf(state: FactoryState, lineId: string) {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const entries = Object.entries(line.allocation).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? line.capabilities[0]?.productId ?? null;
}

/** Best alternate line for re-routing the target line's product (capable, assembly, healthiest). */
export function findRerouteLine(state: FactoryState, targetAssetId: string) {
  const asset = state.assets.find((a) => a.id === targetAssetId);
  if (!asset) return null;
  const line = state.lines.find((l) => l.id === asset.lineId);
  if (!line || line.kind !== "assembly") return null;
  const product = primaryProductOf(state, line.id);
  const candidates = state.lines.filter(
    (l) => l.id !== line.id && l.kind === "assembly" && l.capabilities.some((c) => c.productId === product),
  );
  if (!candidates.length) return null;
  const healthOf = (lid: string) => {
    const ms = state.assets.filter((a) => a.lineId === lid);
    return ms.length ? Math.min(...ms.map((a) => (a.mode === "running" ? a.healthScore : 0))) : 0;
  };
  return candidates.sort((a, b) => healthOf(b.id) - healthOf(a.id))[0];
}

interface PreparedWorld {
  world: SimWorld;
  start: number;
  calibration: CalibrationNote[];
  notes: string[];
  feasible: boolean;
  infeasibleReason?: string;
  expediteCost: number;
  plannedMaintenance: { start: number; duration: number } | null;
  reroute: { lineId: string; productId: string; start: number; end: number } | null;
}

function prepareWorld(state: FactoryState, def: ScenarioDefinition): PreparedWorld {
  const p = def.params;
  const world = worldFromState(state);
  const start = world.hour;
  const notes: string[] = [];
  const calibration: CalibrationNote[] = [];
  let feasible = true;
  let infeasibleReason: string | undefined;

  // 1. Calibrate every machine from telemetry (replaces hidden ground truth).
  for (const a of state.assets) {
    const m = world.machines[a.id];
    const c = calibrateAsset(state, a.id);
    if (!m || !c) continue;
    m.vibExcess = c.vibExcess;
    m.vibSlope = c.vibSlope100;
    m.tempDrift = c.tempDrift;
    m.tempSlope = c.tempSlope100;
    m.alarmed = machineVibration(m) >= m.thresholds.vibrationAlarm || machineTemperature(m) >= m.thresholds.temperatureAlarm;
    if (a.id === p.targetAssetId || c.vibrationSlope > 0) calibration.push(c);
  }
  // Already-approved (scheduled) directives stay in force unless this scenario explicitly replaces them.
  world.directives = world.directives.filter((d) => {
    if (d.status !== "scheduled") return true;
    if (d.kind === "maintenance" && d.assetId === p.targetAssetId && p.maintenanceStartHour !== null) return false;
    if (d.kind === "speed" && d.assetId === p.targetAssetId && p.targetSpeedPct !== 100) return false;
    if (d.kind === "allocation" && p.reroute.enabled && d.lineId === p.reroute.toLineId) return false;
    return true;
  });

  world.params.idlePowerFactor = p.idlePowerFactor;
  world.params.unplannedRepairHours = p.unplannedRepairHours;

  const target = world.machines[p.targetAssetId];
  if (target && p.assumeHealthy) {
    target.vibExcess = 0;
    target.vibSlope = 0;
    target.tempDrift = 0;
    target.tempSlope = 0;
    target.alarmed = false;
    if (target.mode === "down") {
      target.mode = "running";
      target.downUntil = null;
    }
  }

  let plannedMaintenance: PreparedWorld["plannedMaintenance"] = null;
  const extra: Directive[] = [];
  if (target && p.maintenanceStartHour !== null && p.maintenanceDurationHours > 0) {
    plannedMaintenance = { start: start + p.maintenanceStartHour, duration: p.maintenanceDurationHours };
    extra.push({
      id: `SIM-MNT-${def.id}`,
      kind: "maintenance",
      assetId: target.id,
      startHour: plannedMaintenance.start,
      durationHours: p.maintenanceDurationHours,
      workOrderId: "SIM",
      status: "scheduled",
    });
  }
  if (target && p.targetSpeedPct !== target.speedPct && target.mode === "running") {
    const end = plannedMaintenance ? plannedMaintenance.start + plannedMaintenance.duration : null;
    extra.push({
      id: `SIM-SPD-${def.id}`,
      kind: "speed",
      assetId: target.id,
      speedPct: p.targetSpeedPct,
      startHour: start,
      endHour: end,
      revertSpeedPct: 100,
      status: "scheduled",
    });
  }
  let reroute: PreparedWorld["reroute"] = null;
  if (p.reroute.enabled) {
    const toLine = p.reroute.toLineId ? world.lines[p.reroute.toLineId] : undefined;
    const productId = target ? primaryProductOf(state, target.lineId) : null;
    if (!toLine || !productId || !toLine.capabilities[productId] || toLine.id === target?.lineId) {
      feasible = false;
      infeasibleReason = !toLine
        ? "No alternate line is configured that can build this product."
        : `${toLine.name} is not qualified to build ${productId ?? "this product"}.`;
    } else {
      const share = clamp(p.reroute.sharePct / 100, 0, 1);
      const current = { ...toLine.allocation };
      const native = Object.keys(current).find((k) => k !== productId && current[k] > 0);
      const allocation: Record<string, number> = { [productId]: share };
      if (native && share < 1) allocation[native] = 1 - share;
      reroute = { lineId: toLine.id, productId, start: start + p.reroute.startHour, end: start + p.reroute.startHour + p.reroute.durationHours };
      extra.push({
        id: `SIM-ALC-${def.id}`,
        kind: "allocation",
        lineId: toLine.id,
        allocation,
        startHour: reroute.start,
        endHour: reroute.end,
        revertAllocation: current,
        status: "scheduled",
      });
    }
  }
  world.directives.push(...extra);

  // Inventory assumptions
  for (const [itemId, pct] of Object.entries(p.inventoryAvailabilityPct)) {
    const item = world.inventory[itemId];
    if (item && pct !== 100) {
      item.onHand = item.onHand * clamp(pct, 0, 200) / 100;
      notes.push(`${item.name}: ${pct}% of recorded on-hand stock assumed usable.`);
    }
  }
  let expediteCost = 0;
  for (const itemId of p.expediteItemIds) {
    const item = world.inventory[itemId];
    const src = state.inventory.find((i) => i.id === itemId);
    if (!item || !src) continue;
    const eta = start + src.expediteEtaHours;
    if (item.inbound.length) {
      item.inbound[0] = { ...item.inbound[0], etaHour: Math.min(item.inbound[0].etaHour, eta), expedited: true };
    } else {
      item.inbound.push({ poId: "SPOT-BUY", qty: src.reorderPoint, etaHour: eta, expedited: true });
    }
    expediteCost += src.expediteCost;
    notes.push(`Expedite ${src.name} inbound to h+${src.expediteEtaHours} for $${src.expediteCost.toLocaleString("en-US")}.`);
  }
  // Order assumptions
  for (const o of world.orders) {
    const ov = p.orderOverrides[o.id];
    if (!ov) continue;
    if (ov.quantity !== undefined) o.quantity = Math.max(o.fulfilled, ov.quantity);
    if (ov.priority) o.priority = ov.priority;
  }

  return { world, start, calibration, notes, feasible, infeasibleReason, expediteCost, plannedMaintenance, reroute };
}

function riskOf(world: SimWorld, assetId: string) {
  const m = world.machines[assetId];
  if (!m) return 0;
  if (m.mode === "down") return 1;
  if (m.mode === "maintenance") return 0;
  const v = machineVibration(m);
  const t = machineTemperature(m);
  const rv = clamp((v - m.thresholds.vibrationAlarm) / (m.thresholds.vibrationTrip - m.thresholds.vibrationAlarm), 0, 1);
  const rt = clamp((t - m.thresholds.temperatureAlarm) / (m.thresholds.temperatureTrip - m.thresholds.temperatureAlarm), 0, 1);
  return Math.max(rv, rt);
}

interface RawRun {
  def: ScenarioDefinition;
  prepared: PreparedWorld;
  hourly: HourlyPoint[];
  timeline: TimelineEvent[];
  orders: OrderOutcome[];
  metrics: Omit<ScenarioMetrics, "score" | "scoreBreakdown">;
  baseScrapRate: number;
}

function runRaw(state: FactoryState, def: ScenarioDefinition): RawRun {
  const prepared = prepareWorld(state, def);
  const { world, start } = prepared;
  const p = def.params;
  const steps = Math.round(p.horizonHours / SCENARIO_DT);
  const perHour = Math.round(1 / SCENARIO_DT);
  const hourly: HourlyPoint[] = [];
  const target = world.machines[p.targetAssetId];
  const acc0 = () =>
    Object.fromEntries(Object.keys(world.acc).map((k) => [k, { ...world.acc[k] }])) as typeof world.acc;
  let lastProduced = 0;
  let cumulative = 0;
  let lastEnergy = 0;
  let peakRisk = target ? riskOf(world, target.id) : 0;
  const lineGoodPrev: Record<string, number> = Object.fromEntries(Object.keys(world.acc).map((k) => [k, 0]));
  void acc0;

  for (let i = 0; i < steps; i++) {
    stepWorld(world, SCENARIO_DT);
    if (target) peakRisk = Math.max(peakRisk, riskOf(world, target.id));
    if ((i + 1) % perHour === 0) {
      const produced = Object.values(world.producedByProduct).reduce((a, b) => a + b, 0);
      const output = produced - lastProduced;
      lastProduced = produced;
      cumulative += output;
      const energy = Object.values(world.acc).reduce((a, b) => a + b.energyKwh, 0);
      const lineThroughput: Record<string, number> = {};
      for (const [lid, acc] of Object.entries(world.acc)) {
        lineThroughput[lid] = round(acc.goodUnits - lineGoodPrev[lid], 1);
        lineGoodPrev[lid] = acc.goodUnits;
      }
      const v = target ? machineVibration(target) : 0;
      const t = target ? machineTemperature(target) : 0;
      const tAsset = state.assets.find((a) => a.id === p.targetAssetId);
      hourly.push({
        hour: round(world.hour - start, 2),
        output: round(output, 1),
        cumulative: round(cumulative, 1),
        cumulativeByProduct: Object.fromEntries(Object.entries(world.producedByProduct).map(([k, x]) => [k, round(x, 1)])),
        lineThroughput,
        targetVibration: round(target?.mode === "running" ? v : target?.mode === "maintenance" ? 0 : v, 2),
        targetTemperature: round(t, 1),
        targetHealth: tAsset && target ? (target.mode === "down" ? 0 : computeHealthScore(v, t, tAsset.baseline, tAsset.thresholds)) : 100,
        energyKwh: round(energy - lastEnergy, 2),
        targetMode: target?.mode ?? "running",
      });
      lastEnergy = energy;
    }
  }

  const horizonEnd = start + p.horizonHours;
  const orders: OrderOutcome[] = world.orders.map((o) => {
    const dueInHorizon = o.dueHour <= horizonEnd + 1e-6;
    const onTime = o.completedHour !== null && o.completedHour <= o.dueHour + 1e-6;
    const atDue = o.fulfilledAtDue ?? o.fulfilled;
    const lateUnits = dueInHorizon && !onTime ? Math.max(0, o.quantity - atDue) : 0;
    return {
      orderId: o.id,
      customer: o.customer,
      productId: o.productId,
      priority: o.priority,
      quantity: o.quantity,
      delivered: round(o.fulfilled, 0),
      dueHour: round(o.dueHour - start, 2),
      completionHour: o.completedHour !== null ? round(o.completedHour - start, 2) : null,
      dueInHorizon,
      onTime: dueInHorizon ? onTime : o.completedHour !== null,
      lateUnits: round(lateUnits, 0),
    };
  });

  const accs = Object.entries(world.acc);
  const assemblyIds = new Set(state.lines.filter((l) => l.kind === "assembly").map((l) => l.id));
  const totalOutput = Object.values(world.producedByProduct).reduce((a, b) => a + b, 0);
  const energyKwh = accs.reduce((s, [, a]) => s + a.energyKwh, 0);
  const idleEnergyKwh = accs.reduce((s, [, a]) => s + a.idleEnergyKwh, 0);
  const asmGood = accs.filter(([k]) => assemblyIds.has(k)).reduce((s, [, a]) => s + a.goodUnits, 0);
  const scrapUnits = accs.reduce((s, [, a]) => s + a.scrapUnits, 0);
  const asmScrap = accs.filter(([k]) => assemblyIds.has(k)).reduce((s, [, a]) => s + a.scrapUnits, 0);
  const scrapCost = Object.entries(world.scrapByProduct).reduce(
    (s, [pid, q]) => s + q * (state.products.find((x) => x.id === pid)?.unitMaterialCost ?? 0),
    0,
  );
  const cm = state.costModel;
  const maint = world.directives.filter((d) => d.kind === "maintenance" && d.status !== "scheduled" && d.status !== "cancelled");
  const maintenanceCost = maint.reduce(
    (s, d) => s + (d.kind === "maintenance" ? d.durationHours * cm.maintenanceLaborPerHour + cm.maintenancePartsCost : 0),
    0,
  );
  const failures = Object.values(world.machines).reduce((s, m) => s + m.failures, 0);
  const repairCost = failures * (cm.unplannedRepairCost + p.unplannedRepairHours * cm.maintenanceLaborPerHour * 1.5);
  const changeoverCost = world.changeovers * cm.changeoverCost;
  const latePenaltyCost = orders.reduce((s, o) => {
    const src = world.orders.find((x) => x.id === o.orderId);
    return s + o.lateUnits * (src?.penaltyPerLateUnit ?? 0);
  }, 0);
  const energyCost = energyKwh * p.energyPricePerKwh;
  const failureEvent = world.events.find((e) => e.kind === "failure" && e.assetId === p.targetAssetId);
  const due = orders.filter((o) => o.dueInHorizon);
  const targetLineAcc = target ? world.acc[target.lineId] : undefined;
  const outputByLine = Object.fromEntries(accs.map(([k, a]) => [k, round(a.goodUnits, 0)]));
  const tAsset = state.assets.find((a) => a.id === p.targetAssetId);
  const endHealth =
    target && tAsset
      ? target.mode === "down"
        ? 0
        : computeHealthScore(machineVibration(target), machineTemperature(target), tAsset.baseline, tAsset.thresholds)
      : 100;
  const baseScrapRate =
    state.lines.filter((l) => l.kind === "assembly").reduce((s, l) => s + l.baseScrapRate, 0) /
    Math.max(1, state.lines.filter((l) => l.kind === "assembly").length);

  const timeline: TimelineEvent[] = world.events
    .filter((e) => e.kind !== "alarm" || e.assetId === p.targetAssetId)
    .map((e) => ({ hour: round(e.hour - start, 2), kind: e.kind, label: e.label, assetId: e.assetId, lineId: e.lineId, severity: e.severity }));

  const metrics: RawRun["metrics"] = {
    totalOutput: round(totalOutput, 0),
    outputByProduct: Object.fromEntries(Object.entries(world.producedByProduct).map(([k, v]) => [k, round(v, 0)])),
    outputByLine,
    targetPlannedDowntimeHours: round(target?.plannedDownHours ?? 0, 2),
    targetUnplannedDowntimeHours: round(target?.unplannedDownHours ?? 0, 2),
    lineDowntimeHours: round((targetLineAcc?.plannedDownHours ?? 0) + (targetLineAcc?.unplannedDownHours ?? 0) + (targetLineAcc?.changeoverHours ?? 0), 2),
    failureOccurs: !!failureEvent,
    failureHour: failureEvent ? round(failureEvent.hour - start, 2) : null,
    ordersDue: due.length,
    ordersOnTime: due.filter((o) => o.onTime).length,
    ordersLate: due.filter((o) => !o.onTime).length,
    lateUnits: round(due.reduce((s, o) => s + o.lateUnits, 0), 0),
    onTimeRate: due.length ? round(due.filter((o) => o.onTime).length / due.length, 3) : 1,
    energyKwh: round(energyKwh, 0),
    idleEnergyKwh: round(idleEnergyKwh, 0),
    energyCost: round(energyCost, 0),
    energyPerUnit: round(totalOutput > 0 ? energyKwh / totalOutput : 0, 3),
    scrapUnits: round(scrapUnits, 0),
    scrapRate: round(asmGood + asmScrap > 0 ? asmScrap / (asmGood + asmScrap) : 0, 4),
    scrapCost: round(scrapCost, 0),
    maintenanceCost: round(maintenanceCost, 0),
    repairCost: round(repairCost, 0),
    changeoverCost: round(changeoverCost, 0),
    expediteCost: round(prepared.expediteCost, 0),
    latePenaltyCost: round(latePenaltyCost, 0),
    operatingCost: round(energyCost + scrapCost + maintenanceCost + repairCost + changeoverCost + prepared.expediteCost + latePenaltyCost, 0),
    peakRisk: round(failureEvent ? 1 : peakRisk, 3),
    endHealth: round(endHealth, 1),
  };
  return { def, prepared, hourly, timeline, orders, metrics, baseScrapRate };
}

function scoreRun(run: RawRun, reference: RawRun) {
  const m = run.metrics;
  const due = run.orders.filter((o) => o.dueInHorizon);
  const weighted = due.reduce((s, o) => s + PRIORITY_WEIGHT[o.priority] * o.quantity, 0);
  const lateWeighted = due.reduce((s, o) => s + PRIORITY_WEIGHT[o.priority] * o.lateUnits, 0);
  const delivery = SCORE_WEIGHTS.delivery * (weighted > 0 ? clamp(1 - lateWeighted / weighted, 0, 1) : 1);
  const refCost = Math.max(1, reference.metrics.operatingCost);
  const cost = SCORE_WEIGHTS.cost * clamp(refCost / Math.max(1, m.operatingCost), 0, 1);
  const risk = SCORE_WEIGHTS.risk * (1 - clamp(m.peakRisk, 0, 1));
  const refEpu = reference.metrics.energyPerUnit || m.energyPerUnit || 1;
  const epuRatio = m.energyPerUnit > 0 ? refEpu / m.energyPerUnit : 0;
  const qualityRatio = (1 - m.scrapRate) / Math.max(0.01, 1 - reference.metrics.scrapRate);
  const sustainability = SCORE_WEIGHTS.sustainability * clamp(epuRatio * qualityRatio, 0, 1);
  const breakdown = {
    delivery: round(delivery, 1),
    cost: round(cost, 1),
    risk: round(risk, 1),
    sustainability: round(sustainability, 1),
  };
  return { score: round(delivery + cost + risk + sustainability, 1), breakdown };
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const hh = (h: number) => `h+${h.toFixed(h < 10 && h % 1 !== 0 ? 1 : 0)}`;

function explain(state: FactoryState, run: RawRun): string[] {
  const { metrics: m, def, prepared } = run;
  const p = def.params;
  const asset = state.assets.find((a) => a.id === p.targetAssetId);
  const name = asset ? `${asset.id}` : p.targetAssetId;
  const out: string[] = [];
  if (p.assumeHealthy) {
    out.push(`Reference plan: assumes ${name} were operating at its healthy baseline. It shows what the schedule would deliver without the incident — it is not an available option.`);
  }
  if (p.targetSpeedPct < 100 && !p.assumeHealthy) {
    out.push(`${name} derated to ${p.targetSpeedPct}% — wear rate scales with speed², so degradation slows to ${Math.round((p.targetSpeedPct / 100) ** 2 * 100)}% of the full-speed rate.`);
  }
  if (prepared.plannedMaintenance) {
    out.push(
      `Planned maintenance on ${name} from ${hh(prepared.plannedMaintenance.start - prepared.start)} for ${prepared.plannedMaintenance.duration} h restores its condition to baseline.`,
    );
  }
  if (prepared.reroute) {
    const line = state.lines.find((l) => l.id === prepared.reroute!.lineId);
    out.push(
      `${line?.name ?? prepared.reroute.lineId} builds ${prepared.reroute.productId} at ${p.reroute.sharePct}% allocation from ${hh(prepared.reroute.start - prepared.start)} to ${hh(prepared.reroute.end - prepared.start)} (changeovers included).`,
    );
  }
  if (m.failureOccurs && m.failureHour !== null) {
    out.push(`Calibrated trend reaches the trip threshold at ${hh(m.failureHour)}, forcing a ${p.unplannedRepairHours} h unplanned stop and $${fmt(m.repairCost)} in emergency repair.`);
  } else if (!p.assumeHealthy) {
    out.push(`No protective trip predicted within the ${p.horizonHours} h horizon (peak risk ${(m.peakRisk * 100).toFixed(0)}% of the alarm-to-trip band).`);
  }
  const lateOrders = run.orders.filter((o) => o.dueInHorizon && !o.onTime);
  if (lateOrders.length) {
    out.push(
      `${lateOrders.map((o) => `${o.orderId} is ${fmt(o.lateUnits)} units short at its due time`).join("; ")} — $${fmt(m.latePenaltyCost)} in contractual penalties.`,
    );
  } else if (m.ordersDue) {
    out.push(`All ${m.ordersDue} orders due within the horizon ship on time.`);
  }
  const costs: [string, number][] = [
    ["late-delivery penalties", m.latePenaltyCost],
    ["emergency repair", m.repairCost],
    ["planned maintenance", m.maintenanceCost],
    ["scrap", m.scrapCost],
    ["energy", m.energyCost],
    ["changeovers", m.changeoverCost],
    ["expediting", m.expediteCost],
  ];
  const top = costs.sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 0) out.push(`Largest cost driver: ${top[0]} ($${fmt(top[1])} of $${fmt(m.operatingCost)} estimated operating cost).`);
  return out;
}

function assumptions(state: FactoryState, run: RawRun): string[] {
  const p = run.def.params;
  const cm = state.costModel;
  const target = state.assets.find((a) => a.id === p.targetAssetId);
  const cal = run.prepared.calibration.find((c) => c.assetId === p.targetAssetId);
  const list: string[] = [];
  if (target && cal && !p.assumeHealthy) {
    list.push(
      `${target.id} condition calibrated from the last 6 h of telemetry: ${cal.vibration.toFixed(2)} mm/s, trend ${cal.vibrationSlope >= 0 ? "+" : ""}${cal.vibrationSlope.toFixed(2)} mm/s/h at full speed (OLS, R² ${cal.r2.toFixed(2)}, n=${cal.n}).`,
    );
  }
  if (target) {
    list.push(
      `Protective trip at ${target.thresholds.vibrationTrip} mm/s or ${target.thresholds.temperatureTrip} °C; an unplanned stop lasts ${p.unplannedRepairHours} h and costs $${fmt(cm.unplannedRepairCost)} + labor at 1.5×.`,
    );
  }
  list.push(`Wear rate ∝ speed²; temperature rises ${TEMP_PER_VIB_EXCESS} °C per mm/s of excess vibration; scrap rises 1.2 pts per mm/s above 60% of the alarm level.`);
  list.push(`Planned maintenance: $${cm.maintenanceLaborPerHour}/h crew + $${fmt(cm.maintenancePartsCost)} parts kit; restores baseline condition. Changeover: $${fmt(cm.changeoverCost)} each.`);
  list.push(`Energy priced at $${p.energyPricePerKwh.toFixed(2)}/kWh; idle machines draw ${Math.round(p.idlePowerFactor * 100)}% of their rated idle power.`);
  list.push(`Late units are charged the per-unit penalty in each order contract; orders are filled by priority, then due date.`);
  list.push(...run.prepared.notes);
  list.push("All figures are model estimates computed from demo data and the assumptions above — not validated forecasts.");
  return list;
}

function affected(state: FactoryState, run: RawRun) {
  const p = run.def.params;
  const target = state.assets.find((a) => a.id === p.targetAssetId);
  const lineIds = new Set<string>();
  const assetIds = new Set<string>();
  const itemIds = new Set<string>();
  const orderIds = new Set<string>();
  if (target) {
    assetIds.add(target.id);
    lineIds.add(target.lineId);
    const line = state.lines.find((l) => l.id === target.lineId);
    if (line?.downstreamLineId) lineIds.add(line.downstreamLineId);
    const product = primaryProductOf(state, target.lineId);
    const cap = line?.capabilities.find((c) => c.productId === product);
    cap?.bom.forEach((b) => itemIds.add(b.itemId));
    state.orders.filter((o) => o.productId === product && o.completedHour === null).forEach((o) => orderIds.add(o.id));
  }
  if (run.prepared.reroute) {
    lineIds.add(run.prepared.reroute.lineId);
    state.assets.filter((a) => a.lineId === run.prepared.reroute!.lineId).forEach((a) => assetIds.add(a.id));
  }
  if (run.metrics.failureOccurs || run.prepared.plannedMaintenance) {
    state.assets.filter((a) => a.lineId === target?.lineId).forEach((a) => assetIds.add(a.id));
  }
  for (const o of run.orders) if (o.dueInHorizon && !o.onTime) orderIds.add(o.orderId);
  return { assetIds: [...assetIds], lineIds: [...lineIds], itemIds: [...itemIds], orderIds: [...orderIds] };
}

/**
 * Simulate a set of scenarios. The first `baseline` scenario (if present) is the scoring
 * reference; otherwise the first scenario is used.
 */
export function simulateScenarios(state: FactoryState, defs: ScenarioDefinition[]): ScenarioResult[] {
  const runs = defs.map((d) => runRaw(state, d));
  const reference = runs.find((r) => r.def.kind === "baseline") ?? runs[0];
  return runs.map((run) => {
    const { score, breakdown } = scoreRun(run, reference);
    const feasible = run.prepared.feasible;
    const aff = affected(state, run);
    return {
      definition: run.def,
      feasible,
      infeasibleReason: run.prepared.infeasibleReason,
      metrics: { ...run.metrics, score: feasible ? score : 0, scoreBreakdown: breakdown },
      hourly: run.hourly,
      timeline: run.timeline,
      orders: run.orders,
      affectedAssetIds: aff.assetIds,
      affectedLineIds: aff.lineIds,
      affectedItemIds: aff.itemIds,
      affectedOrderIds: aff.orderIds,
      calibration: run.prepared.calibration,
      assumptions: assumptions(state, run),
      explanation: feasible ? explain(state, run) : [run.prepared.infeasibleReason ?? "Scenario is not feasible."],
    };
  });
}

/** Rank feasible, actionable scenarios (baseline reference excluded). */
export function rankScenarios(results: ScenarioResult[]) {
  return results
    .filter((r) => r.definition.kind !== "baseline")
    .map((r) => {
      const m = r.metrics;
      let reason: string;
      if (!r.feasible) reason = r.infeasibleReason ?? "Infeasible";
      else if (m.failureOccurs) reason = `Predicted trip at h+${m.failureHour?.toFixed(1)} violates the asset-protection policy`;
      else if (m.ordersLate) reason = `${m.ordersLate} order(s) late (${fmt(m.lateUnits)} units)`;
      else reason = `All due orders on time at $${fmt(m.operatingCost)} estimated cost`;
      // Asset-protection policy: any plan that runs the asset to failure is ranked below plans that do not.
      const policyPenalty = m.failureOccurs ? 1000 : 0;
      return { scenarioId: r.definition.id, score: r.metrics.score, reason, sortKey: (r.feasible ? r.metrics.score : -1) - policyPenalty };
    })
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(({ scenarioId, score, reason }) => ({ scenarioId, score, reason }));
}

export { describeAllocation };
