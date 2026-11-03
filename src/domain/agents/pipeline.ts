/**
 * Agent workflow: OBSERVE → INVESTIGATE → PREDICT → SIMULATE → RECOMMEND → HUMAN APPROVAL.
 *
 * Runs on an immutable snapshot of the factory and yields every intermediate result as
 * it is computed (streamed to the UI). The returned bundle is committed to the live
 * state afterwards. `pace` only spaces events out for legibility — every stage performs
 * real computation and its outputs are what the UI shows.
 */
import { detectAnomalies, type Anomaly } from "../anomaly";
import { appendAudit } from "../audit";
import { nextId } from "../ids";
import { deterministicNarrative, type NarrativeInput } from "../narrative";
import { addRecommendation, buildRecommendation } from "../recommendations";
import { addScenarioRun, pickFocusAsset, presetScenarios } from "../scenarios";
import { simulateScenarios } from "../simulation";
import type { AgentId, AgentReport, AnalysisRun, FactoryState, Narrative, Recommendation, ScenarioResult, ScenarioRun, StageState, WorkflowStage } from "../types";
import { AGENT_META, fmtInt, type AnalysisContext } from "./context";
import { runEnergyAgent } from "./energy";
import { runMaintenanceAgent } from "./maintenance";
import { buildOrchestratorReport, detectConflicts, runScenarioSet } from "./orchestrator";
import { runProductionAgent } from "./production";
import { runSupplyAgent } from "./supply";
import { runQualityAgent } from "./quality";

/** Re-exported for existing importers; the function lives with the other scenario helpers. */
export { addScenarioRun };

export const STAGES: WorkflowStage[] = ["observe", "investigate", "predict", "simulate", "recommend", "approval"];

export type PipelineEvent =
  | { type: "start"; analysis: AnalysisRun }
  | { type: "stage"; stage: WorkflowStage; status: StageState["status"]; summary?: string; at: string }
  | { type: "observation"; focusAssetId: string; anomalies: Anomaly[]; assetsScanned: number; readings: number }
  | { type: "agent"; agentId: AgentId; status: "running" | "complete"; report?: AgentReport }
  | { type: "forecast"; forecast: ScenarioResult }
  | { type: "scenarios"; run: ScenarioRun }
  | { type: "narrative"; narrative: Narrative }
  | { type: "recommendation"; recommendation: Recommendation }
  | { type: "complete"; analysis: AnalysisRun }
  | { type: "error"; message: string };

export interface PipelineDeps {
  nowISO: () => string;
  pace: (ms: number) => Promise<void>;
  narrate?: (input: NarrativeInput) => Promise<Narrative>;
}

export interface AnalysisBundle {
  analysis: AnalysisRun;
  scenarioRun: ScenarioRun | null;
  recommendation: Recommendation | null;
  counters: Record<string, number>;
  audit: { category: "agent" | "scenario" | "recommendation"; actor: string; title: string; detail: string; severity: "info" | "warning" | "critical" | "success"; refs: Record<string, unknown> }[];
}

export async function* runAnalysisPipeline(snapshot: FactoryState, deps: PipelineDeps): AsyncGenerator<PipelineEvent, AnalysisBundle> {
  const state = snapshot;
  const audit: AnalysisBundle["audit"] = [];
  const analysis: AnalysisRun = {
    id: nextId(state, "ANL", 700),
    startedHour: state.clock.hour,
    startedAt: deps.nowISO(),
    completedAt: null,
    status: "running",
    focusAssetId: null,
    incidentId: null,
    stages: STAGES.map((s) => ({ stage: s, status: "pending" })),
    reports: {},
    scenarioRunId: null,
    recommendationId: null,
    narrative: null,
  };
  const setStage = (stage: WorkflowStage, status: StageState["status"], summary?: string) => {
    const s = analysis.stages.find((x) => x.stage === stage)!;
    s.status = status;
    if (status === "running") s.startedAt = deps.nowISO();
    if (status === "complete" || status === "waiting") s.completedAt = deps.nowISO();
    if (summary) s.summary = summary;
    return { type: "stage" as const, stage, status, summary, at: deps.nowISO() };
  };

  yield { type: "start", analysis: structuredClone(analysis) };

  // OBSERVE
  yield setStage("observe", "running");
  await deps.pace(500);
  const { anomalies, diagnostics } = detectAnomalies(state);
  const focus = pickFocusAsset(state);
  const incident = state.incidents.find((i) => i.assetId === focus.id && i.status !== "resolved");
  analysis.focusAssetId = focus.id;
  analysis.incidentId = incident?.id ?? null;
  const readings = Object.values(state.telemetry).reduce((s, r) => s + r.length, 0);
  yield { type: "observation", focusAssetId: focus.id, anomalies: anomalies.slice(0, 10), assetsScanned: state.assets.length, readings };
  const critical = anomalies.filter((a) => a.severity === "critical").length;
  yield setStage(
    "observe",
    "complete",
    `${state.assets.length} assets · ${fmtInt(readings)} readings scanned · ${anomalies.length} anomalies (${critical} critical) · focus ${focus.id}`,
  );

  const ctx: AnalysisContext = { state, focus, anomalies, diagnostics };

  // INVESTIGATE
  yield setStage("investigate", "running");
  const reports: AgentReport[] = [];
  const specialists: [AgentId, (c: AnalysisContext) => AgentReport][] = [
    ["maintenance", runMaintenanceAgent],
    ["quality", runQualityAgent],
    ["production", runProductionAgent],
    ["supply", runSupplyAgent],
    ["energy", runEnergyAgent],
  ];
  for (const [id, fn] of specialists) {
    yield { type: "agent", agentId: id, status: "running" };
    await deps.pace(650);
    const report = fn(ctx);
    reports.push(report);
    analysis.reports[id] = report;
    audit.push({
      category: "agent",
      actor: AGENT_META[id].name,
      title: `${AGENT_META[id].short}: ${report.findings.length} finding(s)`,
      detail: report.summary,
      severity: report.findings.some((f) => f.severity === "critical") ? "critical" : report.findings.some((f) => f.severity === "warning") ? "warning" : "info",
      refs: { analysisId: analysis.id, assetIds: report.affectedAssetIds.slice(0, 6) },
    });
    yield { type: "agent", agentId: id, status: "complete", report };
  }
  yield setStage("investigate", "complete", `${reports.reduce((s, r) => s + r.findings.length, 0)} findings from ${reports.length} specialist agents`);

  // PREDICT — no-intervention projection on the shared plant model
  yield setStage("predict", "running");
  await deps.pace(500);
  const continueDef = presetScenarios(state, focus.id).find((d) => d.id === "continue")!;
  const [forecast] = simulateScenarios(state, [continueDef]);
  ctx.forecast = forecast;
  yield { type: "forecast", forecast };
  const fm = forecast.metrics;
  yield setStage(
    "predict",
    "complete",
    fm.failureOccurs
      ? `Without intervention: ${focus.id} trips at h+${fm.failureHour?.toFixed(1)} · ${fmtInt(fm.lateUnits)} late units · $${fmtInt(fm.operatingCost)} est. cost`
      : `Without intervention: no trip in ${continueDef.params.horizonHours} h · ${fmtInt(fm.lateUnits)} late units`,
  );

  // SIMULATE
  yield setStage("simulate", "running");
  yield { type: "agent", agentId: "orchestrator", status: "running" };
  await deps.pace(600);
  const simulateStarted = Date.now();
  const run = runScenarioSet(state, focus.id, "agent", deps.nowISO());
  analysis.scenarioRunId = run.id;
  ctx.scenarioRun = run;
  yield { type: "scenarios", run };
  const best = run.results.find((r) => r.definition.id === run.recommendedId);
  audit.push({
    category: "scenario",
    actor: AGENT_META.orchestrator.name,
    title: `Scenario run ${run.id}: ${run.results.length} scenarios simulated`,
    detail: run.ranking.map((r) => `${r.scenarioId} ${r.score.toFixed(1)}`).join(" · "),
    severity: "info",
    refs: { analysisId: analysis.id, scenarioRunId: run.id, assetIds: [focus.id] },
  });
  yield setStage("simulate", "complete", `${run.results.length} scenarios simulated · best: ${best?.definition.name ?? "none"} (${best?.metrics.score.toFixed(1) ?? "-"})`);

  // RECOMMEND
  yield setStage("recommend", "running");
  const orchestrator = buildOrchestratorReport(ctx, run, reports, simulateStarted);
  analysis.reports.orchestrator = orchestrator;
  yield { type: "agent", agentId: "orchestrator", status: "complete", report: orchestrator };

  let recommendation: Recommendation | null = null;
  if (run.recommendedId) {
    const maintEvidence = analysis.reports.maintenance?.findings[0]?.evidence.slice(0, 3) ?? [];
    recommendation = buildRecommendation(state, run, run.recommendedId, {
      source: "orchestrator",
      analysisId: analysis.id,
      nowISO: deps.nowISO(),
      evidence: maintEvidence,
    });
    analysis.recommendationId = recommendation.id;
  }
  const narrativeInput: NarrativeInput = {
    factory: state.profile.name,
    asset: { id: focus.id, name: focus.name, failureMode: focus.condition.failureMode },
    incident: incident?.title ?? null,
    agentSummaries: reports.map((r) => ({ agent: AGENT_META[r.agentId].name, summary: r.summary, confidence: r.confidence.level })),
    scenarios: run.results.map((r) => ({
      id: r.definition.id,
      name: r.definition.name,
      score: r.metrics.score,
      lateUnits: r.metrics.lateUnits,
      ordersLate: r.metrics.ordersLate,
      operatingCost: r.metrics.operatingCost,
      failureHour: r.metrics.failureHour,
      unplannedDowntime: r.metrics.targetUnplannedDowntimeHours,
      feasible: r.feasible,
    })),
    recommended: best && recommendation
      ? { id: best.definition.id, name: best.definition.name, explanation: best.explanation, risks: recommendation.risks, benefits: recommendation.benefits }
      : null,
    conflicts: detectConflicts(ctx, run).map((c) => `${c.between}: ${c.resolution}`),
  };
  let narrative: Narrative;
  try {
    narrative = deps.narrate ? await deps.narrate(narrativeInput) : deterministicNarrative(narrativeInput);
  } catch (e) {
    narrative = deterministicNarrative(narrativeInput, `LLM narrative failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  analysis.narrative = narrative;
  yield { type: "narrative", narrative };
  if (recommendation) {
    audit.push({
      category: "recommendation",
      actor: AGENT_META.orchestrator.name,
      title: `${recommendation.id} proposed — awaiting human approval`,
      detail: `${recommendation.title}. ${recommendation.reason}`,
      severity: "warning",
      refs: { analysisId: analysis.id, recommendationId: recommendation.id, scenarioRunId: run.id, assetIds: recommendation.affectedAssetIds },
    });
    yield { type: "recommendation", recommendation };
  }
  yield setStage("recommend", "complete", recommendation ? `${recommendation.id}: ${recommendation.title}` : "No recommendation");

  // HUMAN APPROVAL
  yield setStage("approval", "waiting", recommendation ? "Awaiting operator decision" : "Nothing to approve");
  analysis.status = "complete";
  analysis.completedAt = deps.nowISO();
  yield { type: "complete", analysis: structuredClone(analysis) };

  return { analysis, scenarioRun: run, recommendation, counters: { ...state.counters }, audit };
}

/** Merge a finished analysis into the live factory state. */
export function commitAnalysis(live: FactoryState, bundle: AnalysisBundle, nowISO: string) {
  for (const [k, v] of Object.entries(bundle.counters)) {
    if (["ANL", "RUN", "REC"].includes(k)) live.counters[k] = Math.max(live.counters[k] ?? 0, v);
  }
  live.analyses.unshift(bundle.analysis);
  live.analyses = live.analyses.slice(0, 5);
  if (bundle.scenarioRun) addScenarioRun(live, bundle.scenarioRun);
  if (bundle.recommendation) addRecommendation(live, bundle.recommendation);
  if (bundle.analysis.incidentId) {
    const inc = live.incidents.find((i) => i.id === bundle.analysis.incidentId);
    if (inc && inc.status === "open") inc.status = "investigating";
  }
  appendAudit(live, nowISO, {
    category: "agent",
    actor: AGENT_META.orchestrator.name,
    title: `Analysis ${bundle.analysis.id} started — focus ${bundle.analysis.focusAssetId}`,
    detail: bundle.analysis.stages[0].summary ?? "",
    severity: "info",
    refs: { analysisId: bundle.analysis.id, incidentId: bundle.analysis.incidentId ?? undefined, assetIds: bundle.analysis.focusAssetId ? [bundle.analysis.focusAssetId] : [] },
  });
  for (const a of bundle.audit) appendAudit(live, nowISO, a as Parameters<typeof appendAudit>[2]);
}
