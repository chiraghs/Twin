/**
 * Turning intelligence-backend results into PENDING recommendations for this twin.
 * Nothing here changes the plant: a person approves in Approvals, then the execution
 * engine applies it (a maintenance window, or an inbound purchase order), simulated only.
 */
import { appendAudit } from "./audit";
import { DomainError } from "./errors";
import { nextId } from "./ids";
import type { MaintenanceAssetInsight, SupplyItemInsight } from "./intelligence";
import { round } from "./math";
import { addRecommendation, buildRecommendation, PURCHASE_ORDER } from "./recommendations";
import { addScenarioRun, presetScenarios } from "./scenarios";
import { rankScenarios, simulateScenarios } from "./simulation";
import type { Evidence, FactoryState, Recommendation, ScenarioRun } from "./types";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const SOURCE = "Intelligence backend";

function hasPending(state: FactoryState, assetIds: string[], scenarioId: string) {
  return state.recommendations.find((r) => r.status === "pending" && r.scenarioId === scenarioId && r.affectedAssetIds[0] === assetIds[0]);
}

/** Preventive maintenance for an at-risk machine, simulated on the twin's own scenario engine. */
export function proposePreventiveMaintenance(state: FactoryState, insight: MaintenanceAssetInsight, nowISO: string, actor: string): Recommendation {
  const asset = state.assets.find((a) => a.id === insight.assetId);
  if (!asset) throw new DomainError(`Asset ${insight.assetId} not found`, 404);
  if (insight.risk === "low" || insight.risk === "n/a") throw new DomainError(`${asset.id} is ${insight.risk} risk; there is nothing to propose.`, 409);
  const existing = hasPending(state, [asset.id], "preventive");
  if (existing) throw new DomainError(`${existing.id} already proposes maintenance for ${asset.id}; decide on it in Approvals.`, 409);

  const results = simulateScenarios(state, presetScenarios(state, asset.id));
  const ranking = rankScenarios(results);
  const run: ScenarioRun = {
    id: nextId(state, "RUN", 500),
    createdHour: state.clock.hour,
    at: nowISO,
    source: "operator",
    targetAssetId: asset.id,
    results,
    baselineId: "baseline",
    recommendedId: ranking[0]?.scenarioId ?? null,
    ranking,
  };
  const chosen = results.find((r) => r.definition.id === "preventive");
  if (!chosen?.feasible) throw new DomainError(`Preventive maintenance is not feasible for ${asset.id}: ${chosen?.infeasibleReason ?? "no plan"}`, 409);
  addScenarioRun(state, run);
  const evidence: Evidence[] = [
    { label: "ISO 10816-3 zone", value: `${(insight.isoZone ?? "").replace("ZONE_", "").replace(/_/g, " ").toLowerCase()} at ${insight.vibration?.toFixed(2)} mm/s`, source: SOURCE },
    { label: "Remaining useful life", value: insight.hoursToTrip == null ? "no degradation trend" : `≈${insight.hoursToTrip.toFixed(1)} h to the ${insight.limits?.trip} mm/s trip`, source: SOURCE },
    { label: "Health score", value: `${Math.round((insight.healthScore ?? 0) * 100)}/100`, source: SOURCE },
  ];
  const rec = buildRecommendation(state, run, "preventive", { source: "intelligence", analysisId: null, nowISO, evidence });
  rec.reason = `${insight.recommendedAction ?? "Backend predicts degradation."} ${rec.reason}`.trim();
  addRecommendation(state, rec);
  appendAudit(state, nowISO, {
    category: "recommendation",
    actor,
    title: `${rec.id} proposed from predictive maintenance — awaiting human approval`,
    detail: `${rec.title}. ${insight.risk} risk, ${insight.hoursToTrip == null ? "no trend" : `trip in ≈${insight.hoursToTrip.toFixed(1)} h`}.`,
    severity: "warning",
    refs: { recommendationId: rec.id, scenarioRunId: run.id, assetIds: rec.affectedAssetIds },
  });
  return rec;
}

/** A purchase order for a material the backend expects to run short; approval adds an inbound delivery. */
export function proposePurchaseOrder(state: FactoryState, insight: SupplyItemInsight, nowISO: string, actor: string): Recommendation {
  const item = state.inventory.find((i) => i.id === insight.itemId);
  if (!item) throw new DomainError(`Material ${insight.itemId} not found`, 404);
  const po = insight.purchaseOrder;
  if (!po) throw new DomainError(`No purchase order is recommended for ${item.id}.`, 409);
  const dup = state.recommendations.find((r) => r.status === "pending" && r.actions.some((a) => a.type === "place-order" && a.params.itemId === item.id));
  if (dup) throw new DomainError(`${dup.id} already proposes an order for ${item.id}; decide on it in Approvals.`, 409);

  const rate = insight.consumptionPerHour;
  const runway = insight.runwayHours ?? 0;
  const after = rate > 0 ? runway + po.qty / rate : runway;
  const lines = [...new Set(insight.usedBy.map((u) => u.lineId))];
  const assetIds = state.assets.filter((a) => lines.includes(a.lineId)).map((a) => a.id);
  const rec: Recommendation = {
    id: nextId(state, "REC", 300),
    createdHour: state.clock.hour,
    at: nowISO,
    source: "intelligence",
    analysisId: null,
    scenarioRunId: "",
    scenarioId: PURCHASE_ORDER,
    scenarioName: "Purchase order",
    comparedToScenarioId: "continue",
    title: `Order ${fmt(po.qty)} ${item.unit} of ${item.name} from ${po.supplier}`,
    summary: `${item.name} lasts ≈${runway.toFixed(0)} h at ${rate.toFixed(1)} ${item.unit}/h, against a ${insight.leadTimeHours} h lead time. Ordering now brings ${fmt(po.qty)} ${item.unit} at h+${po.etaInHours}.`,
    reason: `Supply chain intelligence flags ${item.id} (${po.urgency.toLowerCase()}): ${insight.atRisk ? "below its reorder point" : "runway shorter than the lead time"}.`,
    evidence: [
      { label: "On hand / reorder point", value: `${fmt(insight.onHand)} / ${fmt(insight.reorderPoint)} ${item.unit}`, source: "Inventory ledger" },
      { label: "Runway", value: `≈${runway.toFixed(1)} h (${insight.daysOfSupply ?? "—"} days of supply)`, source: SOURCE },
      { label: "Lead time", value: `${insight.leadTimeHours} h from ${po.supplier}`, source: "Supplier master" },
    ],
    benefits: [`Extends coverage of ${item.name} to ≈${after.toFixed(0)} h.`, lines.length ? `Protects ${lines.join(", ")} from starving.` : "Restores the safety stock."],
    risks: [`$${fmt(po.cost)} of inventory (simulated order; no ERP is connected).`, po.etaInHours > runway ? `The order arrives after the current stock runs out (h+${po.etaInHours} vs ≈${runway.toFixed(0)} h): consider expediting too.` : "Arrives before the stock runs out."],
    impact: [
      { label: `${item.name} coverage`, baseline: round(runway, 1), proposed: round(after, 1), unit: "h", better: "higher" },
      { label: "Order cost", baseline: 0, proposed: po.cost, unit: "$", better: "lower" },
    ],
    affectedAssetIds: assetIds,
    actions: [
      {
        id: "A1",
        type: "place-order",
        title: `Place PO: ${fmt(po.qty)} × ${item.id}`,
        detail: `${po.supplier}, ETA h+${po.etaInHours}, $${fmt(po.cost)}`,
        assetIds,
        params: { itemId: item.id, qty: po.qty, etaInHours: po.etaInHours, cost: po.cost, supplier: po.supplier },
        reversible: true,
        rollback: "Cancel the purchase order before it arrives.",
      },
    ],
    confidence: { level: "medium", rationale: "Consumption is the current plan rate; lead time from the supplier master." },
    status: "pending",
    decision: null,
    execution: null,
  };
  addRecommendation(state, rec);
  appendAudit(state, nowISO, {
    category: "recommendation",
    actor,
    title: `${rec.id} proposed from supply chain intelligence — awaiting human approval`,
    detail: rec.title,
    severity: "warning",
    refs: { recommendationId: rec.id, assetIds: assetIds.slice(0, 6) },
  });
  return rec;
}
