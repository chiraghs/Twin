/**
 * Twin tool layer: the single set of deterministic operations that agents may use.
 *
 * Shared by the copilot (Muse Spark function calling) and the MCP server (any external agent).
 * Every number an agent reports must come from one of these tools. Read tools never change the
 * twin. The one proposal tool can only create a *pending* recommendation; approving it stays a
 * human action in the Approvals screen. No tool can command equipment.
 */
import { z } from "zod";
import { detectAnomalies, diagnoseAsset } from "../anomaly";
import { ARCHETYPES } from "../archetypes";
import { appendAudit } from "../audit";
import { nextId } from "../ids";
import { computeKpis, consumptionPerHour } from "../kpis";
import { round } from "../math";
import { cameraView, computeQuality, recentDefectTypes } from "../quality";
import { describeStream } from "../vision";
import { addRecommendation, buildRecommendation } from "../recommendations";
import { addScenarioRun, pickFocusAsset, presetScenarios } from "../scenarios";
import { rankScenarios, simulateScenarios } from "../simulation";
import type { FactoryState, ScenarioDefinition, ScenarioResult, ScenarioRun } from "../types";

export interface ToolStore {
  get(): FactoryState;
  mutate<T>(fn: (s: FactoryState) => T): T;
  now(): string;
}

export interface TwinTool<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  shape: S;
  /** read: no state change · propose: creates a pending item a human must approve */
  effect: "read" | "propose";
  run(store: ToolStore, args: z.infer<z.ZodObject<S>>, actor: string): unknown;
}

const r1 = (v: number) => round(v, 1);
const r2 = (v: number) => round(v, 2);
const pct = (v: number) => round(v * 100, 1);
const hourLabel = (s: FactoryState, h: number) => `h${h >= 0 ? "+" : ""}${r1(h - s.clock.hour)}`;

function resolveAsset(s: FactoryState, id?: string | null) {
  if (!id) return pickFocusAsset(s);
  const a = s.assets.find((x) => x.id.toLowerCase() === id.toLowerCase() || x.name.toLowerCase() === id.toLowerCase());
  if (!a) throw new Error(`Unknown asset "${id}". Use list_assets to see valid ids.`);
  return a;
}

function summariseResult(s: FactoryState, r: ScenarioResult, rank: number | null) {
  const m = r.metrics;
  return {
    id: r.definition.id,
    name: r.definition.name,
    kind: r.definition.kind,
    feasible: r.feasible,
    infeasibleReason: r.infeasibleReason ?? null,
    rank,
    score: r1(m.score),
    failureOccurs: m.failureOccurs,
    failureAt: m.failureHour === null ? null : hourLabel(s, m.failureHour),
    ordersDue: m.ordersDue,
    ordersLate: m.ordersLate,
    lateUnits: Math.round(m.lateUnits),
    onTimeRatePct: pct(m.onTimeRate),
    operatingCostUsd: Math.round(m.operatingCost),
    latePenaltyUsd: Math.round(m.latePenaltyCost),
    unplannedDowntimeHours: r1(m.targetUnplannedDowntimeHours),
    plannedDowntimeHours: r1(m.targetPlannedDowntimeHours),
    energyKwh: Math.round(m.energyKwh),
    scrapRatePct: pct(m.scrapRate),
    explanation: r.explanation.slice(0, 3),
  };
}

function scenarioDefs(s: FactoryState, assetId: string, args: WhatIfArgs): ScenarioDefinition[] {
  const presets = presetScenarios(s, assetId, args.horizonHours ? { horizonHours: args.horizonHours } : undefined).map((d) =>
    args.expediteItemIds?.length ? { ...d, params: { ...d.params, expediteItemIds: args.expediteItemIds } } : d,
  );
  const custom = args.maintenanceStartHour != null || args.maintenanceDurationHours != null || args.targetSpeedPct != null || args.rerouteSharePct != null;
  if (!custom) return presets;
  const base = presets.find((d) => d.id === (args.rerouteSharePct ? "reroute" : "preventive"))!;
  const p = structuredClone(base.params);
  if (args.maintenanceStartHour != null) p.maintenanceStartHour = args.maintenanceStartHour;
  if (args.maintenanceDurationHours != null) p.maintenanceDurationHours = args.maintenanceDurationHours;
  if (args.targetSpeedPct != null) p.targetSpeedPct = args.targetSpeedPct;
  if (args.rerouteSharePct != null) p.reroute = { ...p.reroute, enabled: args.rerouteSharePct > 0, sharePct: args.rerouteSharePct };
  const parts = [
    args.maintenanceStartHour != null ? `maintenance at h+${args.maintenanceStartHour}` : null,
    args.maintenanceDurationHours != null ? `${args.maintenanceDurationHours} h window` : null,
    args.targetSpeedPct != null ? `${args.targetSpeedPct}% speed` : null,
    args.rerouteSharePct != null ? `${args.rerouteSharePct}% rerouted` : null,
  ].filter(Boolean);
  return [...presets, { id: "custom", kind: "custom", name: `Custom: ${parts.join(", ")}`, description: "Plan requested by the copilot user.", params: p }];
}

const WhatIfShape = {
  assetId: z.string().max(40).optional().describe("Asset to plan around (default: the asset with the most urgent open incident)."),
  maintenanceStartHour: z.number().min(0).max(72).optional().describe("Custom plan: start maintenance this many hours from now."),
  maintenanceDurationHours: z.number().min(0.5).max(48).optional().describe("Custom plan: maintenance window length in hours."),
  targetSpeedPct: z.number().min(30).max(110).optional().describe("Custom plan: run the asset at this % of nameplate speed."),
  rerouteSharePct: z.number().min(0).max(100).optional().describe("Custom plan: % of the line's product moved to the alternate line."),
  expediteItemIds: z.array(z.string().max(20)).max(6).optional().describe("Inventory item ids whose inbound POs are expedited."),
  horizonHours: z.number().int().min(12).max(96).optional().describe("Planning horizon in hours (default 48)."),
};
type WhatIfArgs = z.infer<z.ZodObject<typeof WhatIfShape>>;

function tool<S extends z.ZodRawShape>(t: TwinTool<S>): TwinTool<S> {
  return t;
}

export const TWIN_TOOLS = [
  tool({
    name: "get_plant_overview",
    title: "Plant overview",
    description: "Current state of the factory: lines and their state, asset health counts, open incidents, key KPIs (last 8 h) and pending recommendations. Start here.",
    shape: {},
    effect: "read",
    run(store) {
      const s = store.get();
      const k = computeKpis(s);
      const counts: Record<string, number> = {};
      for (const a of s.assets) counts[a.status] = (counts[a.status] ?? 0) + 1;
      return {
        factory: { name: s.profile.name, industry: s.profile.industry, location: s.profile.location, isDemo: s.profile.isDemo, dataSource: "simulated plant model" },
        clock: { hour: r2(s.clock.hour), liveTelemetry: s.clock.liveTelemetry },
        lines: s.lines.map((l) => ({
          id: l.id,
          name: l.name,
          kind: l.kind,
          state: l.state,
          products: Object.entries(l.allocation)
            .filter(([, v]) => v > 0)
            .map(([p]) => p),
          machines: l.assetIds.length,
        })),
        assetHealth: counts,
        openIncidents: s.incidents.filter((i) => i.status !== "resolved").map((i) => ({ id: i.id, assetId: i.assetId, title: i.title, severity: i.severity })),
        kpis: {
          windowHours: k.windowHours,
          oeePct: pct(k.oee.oee),
          availabilityPct: pct(k.oee.availability),
          performancePct: pct(k.oee.performance),
          qualityPct: pct(k.oee.quality),
          outputUnits: Math.round(k.output.actual),
          targetUnits: Math.round(k.output.target),
          scrapRatePct: pct(k.scrap.rate),
          kwhPerUnit: r2(k.energy.kwhPerUnit),
          inventoryBelowReorder: k.inventory.belowReorder,
        },
        pendingRecommendations: s.recommendations.filter((r) => r.status === "pending").map((r) => ({ id: r.id, title: r.title })),
      };
    },
  }),
  tool({
    name: "list_assets",
    title: "List assets",
    description: "Machines with live condition: status, health score (0–100), vibration and temperature against their alarm limits, throughput. Optional filters.",
    shape: {
      lineId: z.string().max(20).optional().describe("Only this line, e.g. LINE-A."),
      status: z.enum(["healthy", "warning", "critical", "offline", "maintenance"]).optional(),
    },
    effect: "read",
    run(store, a) {
      const s = store.get();
      return s.assets
        .filter((x) => (!a.lineId || x.lineId === a.lineId) && (!a.status || x.status === a.status))
        .map((x) => ({
          id: x.id,
          name: x.name,
          type: ARCHETYPES[x.kind].name,
          lineId: x.lineId,
          status: x.status,
          mode: x.mode,
          health: r1(x.healthScore),
          vibrationMmS: r2(x.signal.vibration),
          vibrationAlarm: x.thresholds.vibrationAlarm,
          temperatureC: r1(x.signal.temperature),
          temperatureAlarm: x.thresholds.temperatureAlarm,
          throughputPerHour: Math.round(x.signal.throughput),
          speedPct: x.speedPct,
        }));
    },
  }),
  tool({
    name: "diagnose_asset",
    title: "Diagnose asset",
    description: "Condition diagnosis of one machine from its telemetry: vibration and temperature trends (OLS, change-point), hours to alarm and trip, trip probability in 24 h, maintenance overdue, and detected anomalies.",
    shape: { assetId: z.string().max(60).describe("Asset id (e.g. A-ROB-03) or exact name.") },
    effect: "read",
    run(store, a) {
      const s = store.get();
      const asset = resolveAsset(s, a.assetId);
      const d = diagnoseAsset(s, asset);
      const anomalies = detectAnomalies(s).anomalies.filter((x) => x.assetId === asset.id);
      return {
        asset: { id: asset.id, name: asset.name, type: ARCHETYPES[asset.kind].name, status: asset.status, health: r1(asset.healthScore), typicalFailureMode: ARCHETYPES[asset.kind].template.failureMode },
        vibration: { now: r2(asset.signal.vibration), baseline: asset.baseline.vibration, alarm: asset.thresholds.vibrationAlarm, trip: asset.thresholds.vibrationTrip, slopePerHour: r2(d.vib.slopePerHour), r2: r2(d.vib.r2), stepChange: d.vib.stepChange.detected },
        temperature: { now: r1(asset.signal.temperature), alarm: asset.thresholds.temperatureAlarm, trip: asset.thresholds.temperatureTrip, slopePerHour: r2(d.temp.slopePerHour) },
        hoursToAlarm: Number.isFinite(d.hoursToAlarm) ? r1(d.hoursToAlarm) : null,
        hoursToTrip: Number.isFinite(d.hoursToTrip) ? r1(d.hoursToTrip) : null,
        tripProbability24hPct: pct(d.tripProbability24h),
        maintenanceOverdueHours: d.pmOverdueHours > 0 ? Math.round(d.pmOverdueHours) : 0,
        readingsAnalysed: d.readingsUsed,
        anomalies: anomalies.map((x) => ({ metric: x.metric, kind: x.kind, severity: x.severity, detail: x.detail })),
        method: "Telemetry trend estimation on simulated demo data; estimates, not guarantees.",
      };
    },
  }),
  tool({
    name: "list_incidents",
    title: "List incidents",
    description: "Incidents raised by telemetry monitoring or operators.",
    shape: { includeResolved: z.boolean().optional() },
    effect: "read",
    run(store, a) {
      const s = store.get();
      return s.incidents
        .filter((i) => a.includeResolved || i.status !== "resolved")
        .map((i) => ({ id: i.id, assetId: i.assetId, title: i.title, severity: i.severity, status: i.status, opened: hourLabel(s, i.openedHour), summary: i.summary }));
    },
  }),
  tool({
    name: "get_orders",
    title: "Customer orders and delivery risk",
    description: "Open customer orders with due time, progress, and whether each ships on time if nothing changes (forecast by simulating the current plan).",
    shape: {},
    effect: "read",
    run(store) {
      const s = store.get();
      const focus = pickFocusAsset(s);
      const cont = presetScenarios(s, focus.id).find((d) => d.id === "continue")!;
      const forecast = simulateScenarios(s, [cont])[0];
      return {
        forecastAssumption: `Current plan continued with no intervention on ${focus.id}.`,
        orders: s.orders.map((o) => {
          const f = forecast.orders.find((x) => x.orderId === o.id);
          return {
            id: o.id,
            customer: o.customer,
            productId: o.productId,
            quantity: o.quantity,
            fulfilled: Math.round(o.fulfilled),
            priority: o.priority,
            dueIn: hourLabel(s, o.dueHour),
            completed: o.completedHour !== null,
            forecastOnTime: f ? f.onTime : null,
            forecastLateUnits: f ? Math.round(f.lateUnits) : null,
          };
        }),
      };
    },
  }),
  tool({
    name: "get_inventory",
    title: "Inventory coverage",
    description: "Stock on hand, reorder point, hours of coverage at current consumption, inbound purchase orders and expedite options.",
    shape: {},
    effect: "read",
    run(store) {
      const s = store.get();
      return s.inventory.map((i) => {
        const rate = consumptionPerHour(s, i.id);
        return {
          id: i.id,
          name: i.name,
          onHand: Math.round(i.onHand),
          reorderPoint: i.reorderPoint,
          consumptionPerHour: r1(rate),
          coverageHours: rate > 0 ? r1(i.onHand / rate) : null,
          inbound: i.inbound.map((p) => ({ po: p.poId, qty: p.qty, eta: hourLabel(s, p.etaHour), expedited: !!p.expedited })),
          expedite: { costUsd: i.expediteCost, etaHours: i.expediteEtaHours },
        };
      });
    },
  }),
  tool({
    name: "run_what_if",
    title: "What-if simulation",
    description:
      "Simulate operating plans on the deterministic plant model and rank them (delivery 40%, cost 30%, risk 20%, sustainability 10%). Without custom parameters it compares: reference, continue, preventive maintenance, reroute + maintain. Add custom parameters to evaluate one extra plan. Nothing is changed.",
    shape: WhatIfShape,
    effect: "read",
    run(store, a) {
      const s = store.get();
      const asset = resolveAsset(s, a.assetId);
      const results = simulateScenarios(s, scenarioDefs(s, asset.id, a));
      const ranking = rankScenarios(results);
      const rankOf = (id: string) => ranking.findIndex((x) => x.scenarioId === id);
      return {
        targetAssetId: asset.id,
        recommendedPlanId: ranking[0]?.scenarioId ?? null,
        plans: results.map((r) => summariseResult(s, r, r.definition.kind === "baseline" ? null : rankOf(r.definition.id) + 1 || null)),
        note: "Model estimates from simulated demo data. The reference plan assumes the asset were healthy and is not actionable.",
      };
    },
  }),
  tool({
    name: "get_quality",
    title: "Visual quality",
    description:
      "Inspection stations (first-pass yield, DPMO, recent vs earlier reject rate, defect mix over 24 h and the last 3 h, attributed reject causes), defect Pareto, and correlations between machine vibration and reject rate. A shift in the last-3-hour mix shows what is driving a recent rise.",
    shape: {},
    effect: "read",
    run(store) {
      const s = store.get();
      const q = computeQuality(s, 24);
      return {
        rolledThroughputYieldPct: pct(q.rty),
        unitsInspected: q.totalInspected,
        stations: q.stations.map((st) => ({
          cameraId: st.camera.id,
          line: st.lineName,
          inspected: Math.round(st.inspected),
          rejects: Math.round(st.defects),
          fpyPct: round(st.fpy * 100, 2),
          dpmo: Math.round(st.dpmo),
          recentRejectRatePct: round(st.recentRate * 100, 2),
          earlierRejectRatePct: round(st.baselineRate * 100, 2),
          topDefect24h: st.defectTypes[0]?.type ?? null,
          defectMixLast3h: recentDefectTypes(s, st.lineId, 3)
            .slice(0, 3)
            .map((d) => ({ type: d.type, sharePct: pct(d.share) })),
          rejectCauses24h: st.causes.slice(0, 3).map((c) => ({ cause: c.label, sharePct: pct(c.share) })),
        })),
        paretoTop: q.pareto.slice(0, 5).map((p) => ({ type: p.type, count: Math.round(p.count), cumulativePct: pct(p.cumulative) })),
        correlations: q.correlations.slice(0, 3).map((c) => ({ assetId: c.assetId, lineId: c.lineId, pearsonR: r2(c.r), hours: c.n, rejectPointsPerMmS: r2(c.slope) })),
      };
    },
  }),
  tool({
    name: "get_camera_view",
    title: "Camera view",
    description: "What a camera currently sees, from its analytics (counts, rejects, temperatures, loading). Without cameraId, lists all cameras with a one-line summary.",
    shape: { cameraId: z.string().max(30).optional() },
    effect: "read",
    run(store, a) {
      const s = store.get();
      if (!a.cameraId) return s.cameras.map((c) => ({ id: c.id, name: c.name, kind: c.kind, zone: c.zone, headline: cameraView(s, c).headline, stream: c.stream.kind }));
      const cam = s.cameras.find((c) => c.id.toLowerCase() === a.cameraId!.toLowerCase());
      if (!cam) throw new Error(`Unknown camera "${a.cameraId}".`);
      const v = cameraView(s, cam);
      return {
        id: cam.id,
        name: cam.name,
        purpose: cam.purpose,
        standard: cam.standard,
        feed: describeStream(cam),
        note: cam.stream.kind === "footage" ? "The video is reference footage from another facility. The headline and detections below come from the twin, not from the video." : undefined,
        headline: v.headline,
        detections: v.detections.map((d) => `${d.label}${d.detail ? ` (${d.detail})` : ""}`),
        thermal: v.thermal,
        occupancy: v.occupancy.slice(0, 8),
      };
    },
  }),
  tool({
    name: "search_audit",
    title: "Search audit trail",
    description: "Search the audit trail of alerts, agent findings, scenario runs, decisions and actions.",
    shape: {
      query: z.string().max(80).optional().describe("Text to match in title or detail."),
      category: z.string().max(30).optional().describe("e.g. telemetry-alert, agent, scenario, recommendation, approval, action, system."),
      limit: z.number().int().min(1).max(30).optional(),
    },
    effect: "read",
    run(store, a) {
      const s = store.get();
      const q = a.query?.toLowerCase();
      return s.audit
        .filter((e) => (!a.category || e.category === a.category) && (!q || `${e.title} ${e.detail}`.toLowerCase().includes(q)))
        .slice(0, a.limit ?? 10)
        .map((e) => ({ id: e.id, at: hourLabel(s, e.hour), category: e.category, actor: e.actor, title: e.title, detail: e.detail.slice(0, 300) }));
    },
  }),
  tool({
    name: "get_latest_analysis",
    title: "Latest agent analysis",
    description: "Summary of the most recent multi-agent investigation: each specialist agent's finding and confidence, and the recommendation it produced.",
    shape: {},
    effect: "read",
    run(store) {
      const s = store.get();
      const a = s.analyses[0];
      if (!a) return { analysis: null, note: "No analysis has run yet. The user can start one in AI Operations." };
      return {
        id: a.id,
        status: a.status,
        focusAssetId: a.focusAssetId,
        agents: Object.values(a.reports).map((r) => ({ agent: r!.agentId, summary: r!.summary, confidence: r!.confidence.level })),
        recommendationId: a.recommendationId,
        narrativeSource: a.narrative?.source ?? null,
      };
    },
  }),
  tool({
    name: "propose_plan",
    title: "Propose a plan for approval",
    description:
      "Create a PENDING recommendation from a simulated plan so a person can review and approve it in Approvals. This does not change production or equipment. Use only when the user explicitly asks to propose or submit a plan.",
    shape: {
      plan: z.enum(["continue", "preventive", "reroute"]).describe("Which operating plan to propose."),
      assetId: z.string().max(60).optional(),
      reason: z.string().max(300).describe("One sentence on why, for the approver."),
    },
    effect: "propose",
    run(store, a, actor) {
      const at = store.now();
      return store.mutate((s) => {
        const asset = resolveAsset(s, a.assetId);
        const defs = presetScenarios(s, asset.id);
        const results = simulateScenarios(s, defs);
        const ranking = rankScenarios(results);
        const run: ScenarioRun = {
          id: nextId(s, "RUN", 500),
          createdHour: s.clock.hour,
          at,
          source: "agent",
          targetAssetId: asset.id,
          results,
          baselineId: "baseline",
          recommendedId: ranking[0]?.scenarioId ?? null,
          ranking,
        };
        const chosen = results.find((r) => r.definition.id === a.plan)!;
        if (!chosen.feasible) throw new Error(`The ${a.plan} plan is not feasible: ${chosen.infeasibleReason}`);
        addScenarioRun(s, run);
        const rec = addRecommendation(s, buildRecommendation(s, run, a.plan, { source: "operator", analysisId: null, nowISO: at }));
        appendAudit(s, at, {
          category: "recommendation",
          actor,
          title: `${rec.id} proposed by ${actor} — awaiting human approval`,
          detail: `${rec.title}. Reason given: ${a.reason}`,
          severity: "warning",
          refs: { recommendationId: rec.id, scenarioRunId: run.id, assetIds: rec.affectedAssetIds },
        });
        return { recommendationId: rec.id, title: rec.title, status: "pending — a person must approve it in Approvals", plan: summariseResult(s, chosen, ranking.findIndex((x) => x.scenarioId === a.plan) + 1) };
      });
    },
  }),
] as const satisfies readonly TwinTool[];

export type TwinToolName = (typeof TWIN_TOOLS)[number]["name"];

/** Validate arguments and run a tool by name (used by both the copilot and MCP). */
export function callTwinTool(store: ToolStore, name: string, args: unknown, actor: string): unknown {
  const t = TWIN_TOOLS.find((x) => x.name === name) as TwinTool | undefined;
  if (!t) throw new Error(`Unknown tool ${name}`);
  const parsed = z.object(t.shape).strict().safeParse(args ?? {});
  if (!parsed.success) throw new Error(`Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return t.run(store, parsed.data, actor);
}
