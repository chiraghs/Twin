/**
 * Operate tools: live signals, alarms, maintenance, experiments, fleet, asset shells, and one
 * view tool that points the 3D twin at something. Same rules as the core tools: every figure comes
 * from the deterministic model, read tools never change the twin, nothing commands equipment.
 */
import { z } from "zod";
import { aasEnvironment } from "../aas";
import { detectAnomalies } from "../anomaly";
import { runExperiment } from "../experiments";
import { maintenanceGuide } from "../guided-maintenance";
import { amrFleet } from "../intralogistics";
import { computeKpis, hourlySeries } from "../kpis";
import { activeAlarms, assetSignals, lineFlow, lineOutput } from "../live";
import { round } from "../math";
import type { FactoryState } from "../types";
import type { ToolStore } from "./twin-tools";

/** "ui": changes nothing in the twin; the app reacts (e.g. the 3D view flies to the target). */
export type ToolEffect = "read" | "propose" | "ui";

export interface OperateTool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  shape: S;
  effect: ToolEffect;
  run(store: ToolStore, args: z.infer<z.ZodObject<S>>, actor: string): unknown;
}

function tool<S extends z.ZodRawShape>(t: OperateTool<S>): OperateTool<S> {
  return t;
}

const r1 = (v: number) => round(v, 1);
const r2 = (v: number) => round(v, 2);
const pct = (v: number) => round(v * 100, 1);

function asset(s: FactoryState, id: string) {
  const a = s.assets.find((x) => x.id.toLowerCase() === id.toLowerCase() || x.name.toLowerCase() === id.toLowerCase());
  if (!a) throw new Error(`Unknown asset "${id}". Use list_assets to see valid ids.`);
  return a;
}
function line(s: FactoryState, id: string) {
  const l = s.lines.find((x) => x.id.toLowerCase() === id.toLowerCase() || x.name.toLowerCase() === id.toLowerCase());
  if (!l) throw new Error(`Unknown line "${id}". Use list_lines to see valid ids.`);
  return l;
}

const AssetId = z.string().max(60).describe("Asset id, e.g. A-ROB-03.");

export const OPERATE_TOOLS = [
  tool({
    name: "list_lines",
    title: "List lines",
    description: "Production lines: state, machines in order, products allocated, current pace (share of nominal flow) and good units in the last 8 h.",
    shape: {},
    effect: "read",
    run(store) {
      const s = store.get();
      return s.lines.map((l) => ({
        id: l.id,
        name: l.name,
        kind: l.kind,
        state: l.state,
        machines: l.assetIds,
        products: Object.entries(l.allocation).filter(([, v]) => v > 0).map(([p, v]) => ({ productId: p, sharePct: pct(v) })),
        pacePct: pct(lineFlow(s, l.id)),
        goodUnitsLast8h: lineOutput(s, l.id, 8),
      }));
    },
  }),
  tool({
    name: "get_line_flow",
    title: "Line flow",
    description: "Live flow on one line: pace vs nominal, the slowest (bottleneck) machine, and good units over a window.",
    shape: { lineId: z.string().max(60).describe("Line id or name."), hours: z.number().int().min(1).max(72).optional().describe("Output window (default 8 h).") },
    effect: "read",
    run(store, a) {
      const s = store.get();
      const l = line(s, a.lineId);
      const machines = l.assetIds.map((id) => s.assets.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
      const slowest = machines.filter((m) => m.mode !== "down").sort((x, y) => x.signal.throughput - y.signal.throughput)[0] ?? null;
      return {
        lineId: l.id,
        state: l.state,
        pacePct: pct(lineFlow(s, l.id)),
        bottleneck: slowest ? { assetId: slowest.id, throughputUph: r1(slowest.signal.throughput), speedPct: slowest.speedPct } : null,
        goodUnits: lineOutput(s, l.id, a.hours ?? 8),
        windowHours: a.hours ?? 8,
      };
    },
  }),
  tool({
    name: "get_live_signals",
    title: "Live signals",
    description: "Every signal one machine exposes right now (run state, fault, speed setpoint, throughput, vibration, temperature, power, health) with alarm and trip limits.",
    shape: { assetId: AssetId },
    effect: "read",
    run(store, a) {
      const s = store.get();
      return assetSignals(s, asset(s, a.assetId)).map((x) => ({ id: x.id, name: x.name, value: typeof x.value === "number" ? r2(x.value) : x.value, unit: x.unit, state: x.state, limits: x.limits ?? null }));
    },
  }),
  tool({
    name: "list_alarms",
    title: "Active alarms",
    description: "Active alarms: open incidents, then machines above an alarm limit without an incident yet.",
    shape: {},
    effect: "read",
    run(store) {
      const s = store.get();
      return activeAlarms(s).map((x) => ({ ...x, since: `h${r1(x.sinceHour - s.clock.hour)}` }));
    },
  }),
  tool({
    name: "get_asset_telemetry",
    title: "Asset telemetry",
    description: "Recent telemetry for one machine (vibration, temperature, power, speed, throughput), down-sampled to at most 24 points.",
    shape: { assetId: AssetId, hours: z.number().int().min(1).max(72).optional().describe("How far back (default 12 h).") },
    effect: "read",
    run(store, a) {
      const s = store.get();
      const as = asset(s, a.assetId);
      const since = s.clock.hour - (a.hours ?? 12);
      const rows = (s.telemetry[as.id] ?? []).filter((r) => r.t >= since);
      const step = Math.max(1, Math.ceil(rows.length / 24));
      return {
        assetId: as.id,
        limits: { vibrationAlarm: as.thresholds.vibrationAlarm, temperatureAlarm: as.thresholds.temperatureAlarm },
        points: rows.filter((_, i) => i % step === 0).map((r) => ({ at: `h${r1(r.t - s.clock.hour)}`, vibration: r2(r.vibration), temperature: r1(r.temperature), powerKw: r1(r.powerKw), speedPct: r1(r.speedPct), throughput: r1(r.throughput), running: r.running })),
      };
    },
  }),
  tool({
    name: "scan_anomalies",
    title: "Scan for anomalies",
    description: "Runs anomaly detection across every machine: drifting signals, their trend and the probability of reaching the trip limit.",
    shape: {},
    effect: "read",
    run(store) {
      return detectAnomalies(store.get()).anomalies.slice(0, 12);
    },
  }),
  tool({
    name: "get_kpis",
    title: "KPIs",
    description: "OEE (availability, performance, quality), output vs target, scrap and energy per unit over a window.",
    shape: { windowHours: z.number().int().min(1).max(72).optional().describe("Default 8 h.") },
    effect: "read",
    run(store, a) {
      const k = computeKpis(store.get(), a.windowHours ?? 8);
      return {
        windowHours: k.windowHours,
        oeePct: pct(k.oee.oee),
        availabilityPct: pct(k.oee.availability),
        performancePct: pct(k.oee.performance),
        qualityPct: pct(k.oee.quality),
        outputUnits: Math.round(k.output.actual),
        targetUnits: Math.round(k.output.target),
        scrapRatePct: pct(k.scrap.rate),
        kwhPerUnit: r2(k.energy.kwhPerUnit),
      };
    },
  }),
  tool({
    name: "get_kpi_trend",
    title: "KPI trend",
    description: "Hour-by-hour plant KPIs (output, OEE, scrap, energy) for the last N hours.",
    shape: { hours: z.number().int().min(2).max(48).optional().describe("Default 12 h.") },
    effect: "read",
    run(store, a) {
      return hourlySeries(store.get(), a.hours ?? 12);
    },
  }),
  tool({
    name: "list_work_orders",
    title: "Work orders",
    description: "Maintenance work orders with status, window, cost and guided-maintenance progress. Optional filters.",
    shape: { status: z.enum(["scheduled", "in-progress", "completed", "cancelled"]).optional(), assetId: AssetId.optional() },
    effect: "read",
    run(store, a) {
      const s = store.get();
      return s.workOrders
        .filter((w) => (!a.status || w.status === a.status) && (!a.assetId || w.assetId.toLowerCase() === a.assetId.toLowerCase()))
        .slice(-20)
        .map((w) => ({ id: w.id, assetId: w.assetId, type: w.type, status: w.status, starts: `h${r1(w.startHour - s.clock.hour)}`, durationHours: w.durationHours, costUsd: Math.round(w.cost), reason: w.reason, stepsSigned: Object.keys(w.steps ?? {}).length }));
    },
  }),
  tool({
    name: "get_maintenance_guide",
    title: "Maintenance guide",
    description: "The step-by-step guided procedure for a work order (lock-out, inspect, repair, test run, close), which steps are signed, and the live test-run check.",
    shape: { workOrderId: z.string().max(40) },
    effect: "read",
    run(store, a) {
      const g = maintenanceGuide(store.get(), a.workOrderId);
      return { workOrderId: g.workOrder.id, assetId: g.asset.id, failureMode: g.failureMode, progress: g.progress, nextStepId: g.nextStepId, steps: g.steps.map((x) => ({ id: x.id, kind: x.kind, title: x.title, check: x.check ?? null, signedBy: x.done?.by ?? null })) };
    },
  }),
  tool({
    name: "get_maintenance_history",
    title: "Maintenance history",
    description: "Past maintenance on one machine: type, when, duration, technician, notes, cost.",
    shape: { assetId: AssetId },
    effect: "read",
    run(store, a) {
      const s = store.get();
      const id = asset(s, a.assetId).id;
      return s.maintenanceHistory.filter((m) => m.assetId === id).slice(-12).map((m) => ({ id: m.id, type: m.type, at: `h${r1(m.hour - s.clock.hour)}`, durationHours: m.durationHours, technician: m.technician, notes: m.notes, costUsd: Math.round(m.cost) }));
    },
  }),
  tool({
    name: "run_experiment",
    title: "Experiment under uncertainty",
    description: "Runs every plan (continue, preventive, reroute) many times with repair times, maintenance windows, supplier fill rates and order sizes varied. Returns mean score with 95% intervals and the odds of late orders, asset failure and being the best plan.",
    shape: {
      assetId: AssetId.optional().describe("Asset to plan around (default: the most urgent)."),
      replications: z.number().int().min(5).max(40).optional().describe("Default 20."),
      uncertainty: z.enum(["low", "medium", "high"]).optional().describe("Default medium."),
    },
    effect: "read",
    run(store, a) {
      const s = store.get();
      const spread = a.uncertainty === "low" ? 0.1 : a.uncertainty === "high" ? 0.35 : 0.2;
      const r = runExperiment(s, { targetAssetId: a.assetId ? asset(s, a.assetId).id : undefined, replications: a.replications ?? 20, spread });
      return {
        assetId: r.targetAssetId,
        replications: r.replications,
        recommendedId: r.recommendedId,
        plans: r.plans.map((p) => ({ id: p.scenarioId, name: p.name, scoreMean: r1(p.score.mean), score95: p.score.ci95.map(r1), lateUnitsMean: Math.round(p.lateUnits.mean), costMeanUsd: Math.round(p.operatingCost.mean), pLatePct: pct(p.pLate), pFailurePct: pct(p.pFailure), pBestPct: pct(p.pBest) })),
        variedInputs: r.inputs,
      };
    },
  }),
  tool({
    name: "list_recommendations",
    title: "Recommendations",
    description: "Recommendations and their decision status (pending, approved, rejected, rolled back).",
    shape: { status: z.enum(["pending", "approved", "rejected", "rolled-back", "superseded"]).optional() },
    effect: "read",
    run(store, a) {
      return store
        .get()
        .recommendations.filter((r) => !a.status || r.status === a.status)
        .slice(-15)
        .map((r) => ({ id: r.id, title: r.title, status: r.status, source: r.source, confidence: r.confidence.level, affectedAssetIds: r.affectedAssetIds, decidedBy: r.decision?.by ?? null }));
    },
  }),
  tool({
    name: "get_recommendation",
    title: "Recommendation detail",
    description: "One recommendation in full: summary, reason, benefits, risks, impact and the actions it would take.",
    shape: { recommendationId: z.string().max(40) },
    effect: "read",
    run(store, a) {
      const r = store.get().recommendations.find((x) => x.id.toLowerCase() === a.recommendationId.toLowerCase());
      if (!r) throw new Error(`Unknown recommendation "${a.recommendationId}". Use list_recommendations.`);
      return { id: r.id, title: r.title, status: r.status, summary: r.summary, reason: r.reason, benefits: r.benefits, risks: r.risks, impact: r.impact, actions: r.actions, confidence: r.confidence, decision: r.decision, execution: r.execution?.status ?? null };
    },
  }),
  tool({
    name: "get_order",
    title: "Order detail",
    description: "One customer order: product, quantity, fulfilled, due time, priority, late penalty and whether it is complete.",
    shape: { orderId: z.string().max(40) },
    effect: "read",
    run(store, a) {
      const s = store.get();
      const o = s.orders.find((x) => x.id.toLowerCase() === a.orderId.toLowerCase());
      if (!o) throw new Error(`Unknown order "${a.orderId}". Use get_orders.`);
      const product = s.products.find((p) => p.id === o.productId);
      return { id: o.id, customer: o.customer, product: product?.name ?? o.productId, quantity: o.quantity, fulfilled: o.fulfilled, remaining: Math.max(0, o.quantity - o.fulfilled), due: `h${r1(o.dueHour - s.clock.hour)}`, priority: o.priority, penaltyPerLateUnitUsd: o.penaltyPerLateUnit, completed: o.completedHour !== null };
    },
  }),
  tool({
    name: "list_products",
    title: "Products",
    description: "Products made in the plant with SKU, unit cost, unit price and finished-goods stock.",
    shape: {},
    effect: "read",
    run(store) {
      const s = store.get();
      return s.products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unitMaterialCostUsd: p.unitMaterialCost, unitPriceUsd: p.unitPrice, finishedGoods: Math.round(s.finishedGoods[p.id] ?? 0) }));
    },
  }),
  tool({
    name: "list_cameras",
    title: "Cameras",
    description: "Cameras in the plant: kind (area, inspection, thermal, dock), zone, what they cover, analytics and current source (twin feed, footage, gateway).",
    shape: {},
    effect: "read",
    run(store) {
      return store.get().cameras.map((c) => ({ id: c.id, name: c.name, kind: c.kind, zone: c.zone, lineId: c.lineId, covers: c.covers, source: c.stream.kind, resolution: c.resolution, fps: c.fps }));
    },
  }),
  tool({
    name: "get_amr_fleet",
    title: "Mobile robot fleet",
    description: "Mobile robots (AMRs): mission, line served, trips per hour, payload, and whether each is active or parked (and why).",
    shape: {},
    effect: "read",
    run(store) {
      return amrFleet(store.get()).map((a) => ({ id: a.id, fleet: a.fleetName, mission: a.mission, lineId: a.lineId, from: a.from, to: a.to, payload: a.payload, unitsPerTrip: a.unitsPerTrip, tripsPerHour: a.tripsPerHour, status: a.status, reason: a.reason }));
    },
  }),
  tool({
    name: "get_asset_shell",
    title: "Asset Administration Shell",
    description: "The machine's Asset Administration Shell (IEC 63278 / AAS v3): nameplate, technical data and operational data submodels.",
    shape: { assetId: AssetId },
    effect: "read",
    run(store, a) {
      const s = store.get();
      return aasEnvironment(s, [asset(s, a.assetId).id]);
    },
  }),
  tool({
    name: "show_in_3d",
    title: "Show in the 3D twin",
    description:
      "Points the user's 3D twin view at a machine, robot, camera, rack or truck (by id) and selects it, or resets to the overview. Changes nothing in the plant. Use when the user asks to show, find or look at something.",
    shape: {
      target: z.string().max(60).describe('Asset id (e.g. A-ROB-03), "cam:<camera id>", "amr:<robot id>", "inv:<item id>", "ord:<order id>", or "overview".'),
    },
    effect: "ui",
    run(store, a) {
      const s = store.get();
      if (a.target.toLowerCase() === "overview") return { shown: "overview" };
      const [prefix, rest] = a.target.includes(":") ? (a.target.split(":", 2) as [string, string]) : [null, a.target];
      if (!prefix) return { shown: asset(s, rest).id };
      const known =
        (prefix === "cam" && s.cameras.some((c) => c.id === rest)) ||
        (prefix === "amr" && amrFleet(s).some((x) => x.id === rest)) ||
        (prefix === "inv" && s.inventory.some((x) => x.id === rest)) ||
        (prefix === "ord" && s.orders.some((x) => x.id === rest));
      if (!known) throw new Error(`Nothing called "${a.target}" in the 3D twin.`);
      return { shown: `${prefix}:${rest}` };
    },
  }),
] as const;
