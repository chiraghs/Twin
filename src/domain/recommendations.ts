import { appendAudit } from "./audit";
import { DomainError } from "./errors";
import { nextId } from "./ids";
import { simulateScenarios, primaryProductOf } from "./simulation";
import type { Evidence, FactoryState, ImpactLine, ProposedAction, Recommendation, ScenarioResult, ScenarioRun } from "./types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function actionsFromScenario(state: FactoryState, result: ScenarioResult): ProposedAction[] {
  const p = result.definition.params;
  const asset = state.assets.find((a) => a.id === p.targetAssetId);
  const actions: ProposedAction[] = [];
  if (p.reroute.enabled && p.reroute.toLineId && result.feasible) {
    const line = state.lines.find((l) => l.id === p.reroute.toLineId);
    const product = asset ? primaryProductOf(state, asset.lineId) : null;
    actions.push({
      id: "A1",
      type: "reroute-production",
      title: `Reroute ${product} to ${line?.name ?? p.reroute.toLineId}`,
      detail: `Allocate ${p.reroute.sharePct}% of ${line?.name} to ${product} from h+${p.reroute.startHour} for ${p.reroute.durationHours.toFixed(2)} h (changeovers included), then return to its native product.`,
      assetIds: line?.assetIds ?? [],
      params: { toLineId: p.reroute.toLineId, productId: product ?? "", sharePct: p.reroute.sharePct, startInHours: p.reroute.startHour, durationHours: p.reroute.durationHours },
      reversible: true,
      rollback: "Restore the line's previous allocation (incurs one changeover).",
    });
  }
  if (p.targetSpeedPct < 100) {
    actions.push({
      id: `A${actions.length + 1}`,
      type: "adjust-speed",
      title: `Derate ${p.targetAssetId} to ${p.targetSpeedPct}%`,
      detail: `Reduce commanded speed to slow wear${p.maintenanceStartHour !== null ? " until maintenance completes" : ""}.`,
      assetIds: [p.targetAssetId],
      params: { assetId: p.targetAssetId, speedPct: p.targetSpeedPct },
      reversible: true,
      rollback: "Restore 100% commanded speed.",
    });
  }
  if (p.maintenanceStartHour !== null) {
    actions.push({
      id: `A${actions.length + 1}`,
      type: "schedule-maintenance",
      title: `Preventive maintenance on ${p.targetAssetId}`,
      detail: `${p.maintenanceDurationHours} h work order starting h+${p.maintenanceStartHour}: ${asset?.condition.failureMode ? `inspect and correct ${asset.condition.failureMode.toLowerCase()}` : "inspect drive train"}, lubricate, re-verify alignment.`,
      assetIds: [p.targetAssetId],
      params: { assetId: p.targetAssetId, startInHours: p.maintenanceStartHour, durationHours: p.maintenanceDurationHours },
      reversible: true,
      rollback: "Cancel the work order if it has not started; an in-progress job runs to completion.",
    });
  }
  for (const itemId of p.expediteItemIds) {
    const item = state.inventory.find((i) => i.id === itemId);
    if (!item) continue;
    actions.push({
      id: `A${actions.length + 1}`,
      type: "expedite-inbound",
      title: `Expedite ${item.inbound[0]?.poId ?? "spot buy"} (${item.name})`,
      detail: `Pay $${fmt(item.expediteCost)} to bring delivery forward to h+${item.expediteEtaHours}.`,
      assetIds: [],
      params: { itemId, etaInHours: item.expediteEtaHours, cost: item.expediteCost },
      reversible: false,
      rollback: "Expedite fees are committed once the supplier confirms.",
    });
  }
  return actions;
}

function impactLines(proposed: ScenarioResult, reference: ScenarioResult): ImpactLine[] {
  const a = reference.metrics;
  const b = proposed.metrics;
  return [
    { label: "Late units (due orders)", baseline: a.lateUnits, proposed: b.lateUnits, unit: "units", better: "lower" },
    { label: "Orders on time", baseline: a.ordersOnTime, proposed: b.ordersOnTime, unit: `of ${b.ordersDue}`, better: "higher" },
    { label: "Estimated operating cost", baseline: a.operatingCost, proposed: b.operatingCost, unit: "$", better: "lower" },
    { label: "Unplanned downtime", baseline: a.targetUnplannedDowntimeHours, proposed: b.targetUnplannedDowntimeHours, unit: "h", better: "lower" },
    { label: "Peak failure risk", baseline: Math.round(a.peakRisk * 100), proposed: Math.round(b.peakRisk * 100), unit: "%", better: "lower" },
    { label: "Packaged output", baseline: a.totalOutput, proposed: b.totalOutput, unit: "units", better: "higher" },
    { label: "Energy", baseline: a.energyKwh, proposed: b.energyKwh, unit: "kWh", better: "lower" },
    { label: "Scrap", baseline: a.scrapUnits, proposed: b.scrapUnits, unit: "units", better: "lower" },
  ];
}

export function buildRecommendation(
  state: FactoryState,
  run: ScenarioRun,
  scenarioId: string,
  opts: { source: Recommendation["source"]; analysisId: string | null; nowISO: string; evidence?: Evidence[] },
): Recommendation {
  const proposed = run.results.find((r) => r.definition.id === scenarioId);
  if (!proposed) throw new Error(`Scenario ${scenarioId} not found in run ${run.id}`);
  const reference =
    run.results.find((r) => r.definition.kind === "continue" && r.definition.id !== scenarioId) ??
    run.results.find((r) => r.definition.kind === "baseline")!;
  const p = proposed.definition.params;
  const asset = state.assets.find((a) => a.id === p.targetAssetId);
  const m = proposed.metrics;
  const r = reference.metrics;
  const actions = actionsFromScenario(state, proposed);

  const benefits: string[] = [];
  if (r.lateUnits > m.lateUnits) benefits.push(`Avoids ${fmt(r.lateUnits - m.lateUnits)} late units vs "${reference.definition.name}".`);
  if (m.ordersDue && m.ordersLate === 0) benefits.push(`All ${m.ordersDue} orders due in the next ${p.horizonHours} h ship on time.`);
  if (r.failureOccurs && !m.failureOccurs) benefits.push(`Prevents the predicted trip at h+${r.failureHour?.toFixed(1)} and a ${p.unplannedRepairHours} h unplanned stop.`);
  if (r.operatingCost > m.operatingCost) benefits.push(`Saves ≈$${fmt(r.operatingCost - m.operatingCost)} in estimated operating cost (${fmt(((r.operatingCost - m.operatingCost) / Math.max(1, r.operatingCost)) * 100)}%).`);
  if (r.scrapUnits > m.scrapUnits) benefits.push(`${fmt(r.scrapUnits - m.scrapUnits)} fewer scrapped units (less component waste).`);
  if (r.idleEnergyKwh > m.idleEnergyKwh) benefits.push(`${fmt(r.idleEnergyKwh - m.idleEnergyKwh)} kWh less idle energy.`);

  const risks: string[] = [];
  if (p.reroute.enabled && p.reroute.toLineId) {
    const line = state.lines.find((l) => l.id === p.reroute.toLineId);
    const native = line ? Object.entries(line.allocation).sort((x, y) => y[1] - x[1])[0]?.[0] : undefined;
    if (native) {
      const lost = (r.outputByProduct[native] ?? 0) - (m.outputByProduct[native] ?? 0);
      if (lost > 0) risks.push(`${line?.name} produces ≈${fmt(lost)} fewer ${native} units in the horizon; affected ${native} orders remain on time in the model.`);
    }
    risks.push("Two changeovers add execution risk (first-article checks, setup errors).");
  }
  if (p.maintenanceStartHour !== null && p.maintenanceStartHour > 0 && asset) {
    risks.push(`${asset.id} keeps running ${p.maintenanceStartHour.toFixed(2)} h before the maintenance window — monitor vibration until lock-out.`);
  }
  // Sensitivity: maintenance overrun of +2 h
  if (p.maintenanceStartHour !== null) {
    const overrun = { ...proposed.definition, id: `${proposed.definition.id}-overrun`, params: { ...p, maintenanceDurationHours: p.maintenanceDurationHours + 2, reroute: { ...p.reroute, durationHours: p.reroute.durationHours + (p.reroute.enabled ? 2 : 0) } } };
    const [o] = simulateScenarios(state, [overrun]);
    risks.push(
      o.metrics.lateUnits > m.lateUnits
        ? `Sensitivity: a 2 h maintenance overrun would leave ${fmt(o.metrics.lateUnits)} units late.`
        : "Sensitivity: plan still meets all due orders with a 2 h maintenance overrun.",
    );
  }
  if (m.failureOccurs) risks.push(`The model still predicts a trip at h+${m.failureHour?.toFixed(1)} under this plan.`);
  risks.push("Outcome estimates come from a calibrated demo model; validate on site before relying on them.");

  const cal = proposed.calibration.find((c) => c.assetId === p.targetAssetId);
  const robust = risks.some((x) => x.startsWith("Sensitivity: plan still meets"));
  const confidence: Recommendation["confidence"] = {
    level: cal && cal.r2 > 0.8 && robust ? "high" : cal && cal.r2 > 0.5 ? "medium" : "low",
    rationale: `${cal ? `Trend calibration R² ${cal.r2.toFixed(2)} (n=${cal.n}). ` : ""}${robust ? "Plan is robust to a 2 h overrun." : "Plan is sensitive to maintenance overrun."}`,
  };

  const evidence: Evidence[] = [
    ...(opts.evidence ?? []),
    { label: "Scenario score", value: `${m.score.toFixed(1)} vs ${r.score.toFixed(1)} (${reference.definition.name})`, source: `Scenario run ${run.id}` },
    { label: "Delivery", value: `${m.ordersOnTime}/${m.ordersDue} on time · ${fmt(m.lateUnits)} late units`, source: "Order allocation model" },
    { label: "Cost", value: `$${fmt(m.operatingCost)} vs $${fmt(r.operatingCost)}`, source: "Cost model (stated assumptions)" },
  ];

  return {
    id: nextId(state, "REC", 300),
    createdHour: state.clock.hour,
    at: opts.nowISO,
    source: opts.source,
    analysisId: opts.analysisId,
    scenarioRunId: run.id,
    scenarioId,
    scenarioName: proposed.definition.name,
    comparedToScenarioId: reference.definition.id,
    title: actions.length ? actions.map((a) => a.title).join(" + ") : proposed.definition.name,
    summary: proposed.explanation.slice(0, 3).join(" "),
    reason: `Highest-scoring feasible plan (${m.score.toFixed(1)}/100) that ${m.failureOccurs ? "limits" : "avoids"} the failure risk on ${p.targetAssetId}${m.ordersLate === 0 ? " and keeps every due order on time" : ` with ${fmt(m.lateUnits)} late units`}.`,
    evidence,
    benefits,
    risks,
    impact: impactLines(proposed, reference),
    affectedAssetIds: proposed.affectedAssetIds,
    actions,
    confidence,
    status: "pending",
    decision: null,
    execution: null,
  };
}

/** How many recommendations the live state keeps, newest first. */
export const RECOMMENDATION_LIMIT = 20;

/**
 * Put a new recommendation on the live state: pending recommendations for the same target (first
 * affected asset) are superseded, the new one goes first and the list is capped.
 */
export function addRecommendation(state: FactoryState, rec: Recommendation): Recommendation {
  for (const other of state.recommendations) {
    if (other.status === "pending" && other.affectedAssetIds[0] === rec.affectedAssetIds[0]) other.status = "superseded";
  }
  state.recommendations.unshift(rec);
  state.recommendations = state.recommendations.slice(0, RECOMMENDATION_LIMIT);
  return rec;
}

/** Operator-initiated recommendation from a stored scenario run; it waits for a person to approve it. */
export function createRecommendationFromRun(state: FactoryState, scenarioRunId: string, scenarioId: string, nowISO: string): Recommendation {
  const run = state.scenarioRuns.find((r) => r.id === scenarioRunId);
  if (!run) throw new DomainError(`Scenario run ${scenarioRunId} not found`, 404);
  const result = run.results.find((r) => r.definition.id === scenarioId);
  if (!result) throw new DomainError(`Scenario ${scenarioId} not in ${scenarioRunId}`, 404);
  if (result.definition.kind === "baseline") throw new DomainError("The reference plan is not an actionable option", 400);
  if (!result.feasible) throw new DomainError(`Scenario is infeasible: ${result.infeasibleReason}`, 400);
  if (!result.hourly.length) throw new DomainError("Scenario run is too old to act on — re-run the simulation", 409);
  const r = addRecommendation(state, buildRecommendation(state, run, scenarioId, { source: "operator", analysisId: null, nowISO }));
  appendAudit(state, nowISO, {
    category: "recommendation",
    actor: "Operator",
    title: `${r.id} created from scenario "${result.definition.name}" — awaiting approval`,
    detail: r.title,
    severity: "warning",
    refs: { recommendationId: r.id, scenarioRunId: run.id, assetIds: r.affectedAssetIds },
  });
  return r;
}
