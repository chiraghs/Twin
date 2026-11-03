import "server-only";
import { approveRecommendation } from "@/domain/actions";
import { AGENT_META } from "@/domain/agents/context";
import { runEnergyAgent } from "@/domain/agents/energy";
import { runMaintenanceAgent } from "@/domain/agents/maintenance";
import { runScenarioSet } from "@/domain/agents/orchestrator";
import { runProductionAgent } from "@/domain/agents/production";
import { runSupplyAgent } from "@/domain/agents/supply";
import { runQualityAgent } from "@/domain/agents/quality";
import { detectAnomalies } from "@/domain/anomaly";
import { fastForward } from "@/domain/commands";
import { applyScriptedCrisis, CRISIS_ASSET_ID } from "@/domain/crisis";
import { isoModelFromState } from "@/domain/layout";
import { buildRecommendation } from "@/domain/recommendations";
import { buildDemoFactory } from "@/domain/seed";
import { readingsFor } from "@/domain/telemetry";
import type { StoryData } from "@/lib/contracts";

/**
 * Data for the landing-page scroll story. Every figure is produced by running the real
 * engine on the scripted crisis scenario (deterministic), not written by hand.
 */
export type { StoryData };

const ANCHOR = "2026-10-13T06:00:00.000Z";
const NOW = "2026-10-13T06:05:00.000Z";
let cached: StoryData | null = null;

function compute(): StoryData {
  const base = buildDemoFactory(ANCHOR);
  const before = isoModelFromState(base);
  const crisis = applyScriptedCrisis(structuredClone(base), NOW);

  const { anomalies, diagnostics } = detectAnomalies(crisis);
  const focus = crisis.assets.find((a) => a.id === CRISIS_ASSET_ID)!;
  const ctx = { state: crisis, focus, anomalies, diagnostics };
  const reports = [runMaintenanceAgent(ctx), runQualityAgent(ctx), runProductionAgent(ctx), runSupplyAgent(ctx), runEnergyAgent(ctx)];
  const run = runScenarioSet(crisis, focus.id, "agent", NOW);
  const best = run.results.find((r) => r.definition.id === run.recommendedId)!;
  const cont = run.results.find((r) => r.definition.id === "continue")!;
  const d = diagnostics[focus.id];

  const crisisRisk = Object.fromEntries(cont.orders.map((o) => [o.orderId, o.dueInHorizon && !o.onTime]));
  const crisisModel = isoModelFromState(crisis, crisisRisk);

  // Execute the recommended plan on a copy and record what the twin logs.
  const executed = structuredClone(crisis);
  const rec = buildRecommendation(executed, run, best.definition.id, { source: "orchestrator", analysisId: null, nowISO: NOW });
  executed.recommendations.unshift(rec);
  const auditStart = executed.audit.length;
  approveRecommendation(executed, rec.id, "Shift lead", "Crew confirmed", NOW);
  fastForward(executed, 8, NOW);
  const newEntries = executed.audit.slice(0, executed.audit.length - auditStart).reverse();
  const after = isoModelFromState(executed);

  return {
    before,
    crisis: crisisModel,
    after,
    counts: {
      machines: base.assets.length,
      sensors: base.assets.reduce((s, a) => s + a.sensors.length, 0),
      lines: base.lines.length,
      materials: base.inventory.length,
      orders: base.orders.length,
      readings: Object.values(base.telemetry).reduce((s, r) => s + r.length, 0),
    },
    focus: {
      id: focus.id,
      name: focus.name,
      baseline: focus.baseline.vibration,
      vibration: d.vib.current,
      step: d.vib.stepChange.size,
      slope: d.vib.slopePerHour,
      hoursToTrip: d.hoursToTrip,
      p24: d.tripProbability24h,
      failureMode: focus.condition.failureMode ?? "bearing wear",
    },
    vibration: readingsFor(crisis, focus.id)
      .filter((r) => r.running)
      .slice(-60)
      .map((r) => r.vibration),
    agents: reports.map((r) => ({ id: r.agentId, name: AGENT_META[r.agentId].name, summary: r.summary })).concat([
      { id: "orchestrator", name: AGENT_META.orchestrator.name, summary: `Compared ${run.results.length - 1} plans on the plant model and recommends “${best.definition.name}”.` },
    ]),
    scenarios: run.results
      .filter((r) => r.definition.kind !== "baseline")
      .map((r) => ({
        id: r.definition.id,
        name: r.definition.name,
        lateUnits: r.metrics.lateUnits,
        cost: r.metrics.operatingCost,
        failureHour: r.metrics.failureHour,
        downtime: r.metrics.targetUnplannedDowntimeHours,
        score: r.metrics.score,
      })),
    recommendedId: best.definition.id,
    recommendationTitle: rec.title,
    highlight: {
      assetIds: best.affectedAssetIds,
      lineIds: best.affectedLineIds,
      targetAssetId: focus.id,
      rerouteLineId: best.definition.params.reroute.enabled ? best.definition.params.reroute.toLineId : null,
    },
    impact: {
      downtimeAvoided: cont.metrics.targetUnplannedDowntimeHours - best.metrics.targetUnplannedDowntimeHours,
      lateAvoided: cont.metrics.lateUnits - best.metrics.lateUnits,
      costAvoided: cont.metrics.operatingCost - best.metrics.operatingCost,
      scrapAvoided: cont.metrics.scrapUnits - best.metrics.scrapUnits,
    },
    audit: newEntries.map((e) => e.title).slice(0, 7),
    afterHealth: executed.assets.find((a) => a.id === focus.id)!.healthScore,
  };
}

export function getStory(): StoryData {
  cached ??= compute();
  return cached;
}
