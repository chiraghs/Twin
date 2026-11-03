import { nextId } from "../ids";
import { presetScenarios } from "../scenarios";
import { rankScenarios, simulateScenarios } from "../simulation";
import type { AgentReport, FactoryState, ScenarioRun } from "../types";
import { fmtInt, type AnalysisContext } from "./context";

/** Build and simulate the baseline + alternative plans for the focus asset. */
export function runScenarioSet(state: FactoryState, targetAssetId: string, source: ScenarioRun["source"], nowISO: string): ScenarioRun {
  const defs = presetScenarios(state, targetAssetId);
  const results = simulateScenarios(state, defs);
  const ranking = rankScenarios(results);
  return {
    id: nextId(state, "RUN", 500),
    createdHour: state.clock.hour,
    at: nowISO,
    source,
    targetAssetId,
    results,
    baselineId: "baseline",
    recommendedId: ranking[0]?.scenarioId ?? null,
    ranking,
  };
}

/** Explicit conflict detection between agent priorities, resolved with simulation evidence. */
export function detectConflicts(ctx: AnalysisContext, run: ScenarioRun) {
  const conflicts: { between: string; issue: string; resolution: string }[] = [];
  const get = (id: string) => run.results.find((r) => r.definition.id === id);
  const prev = get("preventive");
  const cont = get("continue");
  const rer = get("reroute");
  const chosen = run.recommendedId ? get(run.recommendedId) : undefined;
  if (prev && cont) {
    conflicts.push({
      between: "Maintenance ↔ Production",
      issue: `Stopping ${ctx.focus.id} now protects the asset but ${prev.metrics.lateUnits > 0 ? `leaves ${fmtInt(prev.metrics.lateUnits)} units late` : "pauses output"}; continuing protects throughput but ${cont.metrics.failureOccurs ? `trips at h+${cont.metrics.failureHour?.toFixed(1)}` : "keeps risk elevated"}.`,
      resolution: rer?.feasible
        ? `Re-routing to an alternate line decouples the two: maintenance proceeds while ${rer.metrics.lateUnits === 0 ? "all due orders stay on time" : `late units drop to ${fmtInt(rer.metrics.lateUnits)}`}.`
        : "No alternate line — chose the plan with the best risk-adjusted score.",
    });
  }
  if (rer?.feasible) {
    const stockout = rer.timeline.find((e) => e.kind === "stockout");
    conflicts.push({
      between: "Production ↔ Supply chain",
      issue: "Re-routing runs a second line on the constrained component, increasing its consumption rate.",
      resolution: stockout
        ? `Simulation shows "${stockout.label}" at h+${stockout.hour.toFixed(1)} — after the critical order completes, so the plan is acceptable; replenishment PO covers later demand.`
        : "Simulation shows no stockout inside the horizon.",
    });
  }
  if (chosen && cont) {
    const dE = chosen.metrics.energyKwh - cont.metrics.energyKwh;
    conflicts.push({
      between: "Energy ↔ Production",
      issue: "Changeovers and lock-out windows change the energy profile.",
      resolution: `Net energy change ${dE >= 0 ? "+" : ""}${fmtInt(dE)} kWh vs no intervention; idle energy ${chosen.metrics.idleEnergyKwh <= cont.metrics.idleEnergyKwh ? "decreases" : "increases"} (${fmtInt(chosen.metrics.idleEnergyKwh)} vs ${fmtInt(cont.metrics.idleEnergyKwh)} kWh). Delivery and asset protection take precedence.`,
    });
  }
  return conflicts;
}

export function buildOrchestratorReport(ctx: AnalysisContext, run: ScenarioRun, reports: AgentReport[], startedMs: number): AgentReport {
  const conflicts = detectConflicts(ctx, run);
  const chosen = run.results.find((r) => r.definition.id === run.recommendedId);
  const baseline = run.results.find((r) => r.definition.kind === "baseline");
  return {
    agentId: "orchestrator",
    status: "complete",
    summary: chosen
      ? `Recommends "${chosen.definition.name}" (score ${chosen.metrics.score.toFixed(1)}) after comparing ${run.results.length - 1} plans.`
      : "No feasible plan found.",
    inputs: [
      ...reports.map((r) => `${r.agentId} report: ${r.findings.length} findings`),
      `${run.results.length} simulated scenarios (run ${run.id})`,
      "Scoring policy: delivery 40 · cost 30 · risk 20 · sustainability 10; asset-protection rule",
    ],
    method:
      "Translate agent proposals into operating plans, simulate each on the shared plant model, score against the healthy reference plan, demote any plan that runs the asset to a predicted trip, and resolve inter-agent conflicts with the simulated evidence.",
    findings: [
      ...run.ranking.map((r, i) => {
        const res = run.results.find((x) => x.definition.id === r.scenarioId)!;
        return {
          id: `of-${i + 1}`,
          title: `#${i + 1} ${res.definition.name} — ${r.score.toFixed(1)}`,
          detail: r.reason,
          severity: (i === 0 ? "success" : res.metrics.failureOccurs || !res.feasible ? "critical" : "warning") as "success" | "critical" | "warning",
          evidence: [
            { label: "Late units", value: fmtInt(res.metrics.lateUnits), source: "Simulation" },
            { label: "Est. cost", value: `$${fmtInt(res.metrics.operatingCost)}`, source: "Cost model" },
            { label: "Unplanned downtime", value: `${res.metrics.targetUnplannedDowntimeHours.toFixed(1)} h`, source: "Simulation" },
            { label: "Score", value: `D ${res.metrics.scoreBreakdown.delivery} · C ${res.metrics.scoreBreakdown.cost} · R ${res.metrics.scoreBreakdown.risk} · S ${res.metrics.scoreBreakdown.sustainability}`, source: "Scoring policy" },
          ],
          assetIds: res.affectedAssetIds,
        };
      }),
      ...conflicts.map((c, i) => ({
        id: `oc-${i + 1}`,
        title: `Conflict resolved: ${c.between}`,
        detail: `${c.issue} → ${c.resolution}`,
        severity: "info" as const,
        evidence: [],
        assetIds: [],
      })),
    ],
    proposals: chosen
      ? [{ title: `Approve: ${chosen.definition.name}`, detail: chosen.explanation.slice(0, 2).join(" "), priority: "now" }]
      : [],
    metrics: [
      { label: "Plans compared", value: String(run.results.length - 1) },
      { label: "Best score", value: chosen ? chosen.metrics.score.toFixed(1) : "-", tone: "success" },
      { label: "Reference", value: baseline ? baseline.metrics.score.toFixed(0) : "-" },
      { label: "Conflicts", value: String(conflicts.length) },
    ],
    confidence: {
      level: reports.every((r) => r.confidence.level !== "low") ? "high" : "medium",
      score: Math.min(...reports.map((r) => r.confidence.score), 0.9),
      rationale: "Inherits the lowest specialist confidence; ranking is deterministic given the stated assumptions.",
    },
    affectedAssetIds: chosen?.affectedAssetIds ?? [],
    durationMs: Date.now() - startedMs,
  };
}
