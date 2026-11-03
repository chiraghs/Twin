/**
 * Maintenance rules from the playground. Inventory and connector rules act inside the plant model
 * (world.ts); maintenance rules work on measured condition, so they run after each live step and
 * create a PENDING preventive-maintenance proposal. A person still approves it in Approvals.
 */
import { appendAudit } from "./audit";
import { nextId } from "./ids";
import { addRecommendation, buildRecommendation } from "./recommendations";
import { addScenarioRun, presetScenarios } from "./scenarios";
import { rankScenarios, simulateScenarios } from "./simulation";
import type { Asset, FactoryState, PlantRule, ScenarioRun } from "./types";

type MaintenanceRule = Extract<PlantRule, { kind: "maintenance" }>;

const breached = (r: MaintenanceRule, a: Asset) => (r.metric === "health" ? a.healthScore < r.threshold : a.signal.vibration > r.threshold);
/** Re-arm only once the reading is clearly back on the safe side, so noise can't fire the rule twice. */
const cleared = (r: MaintenanceRule, a: Asset) => (r.metric === "health" ? a.healthScore >= r.threshold + 5 : a.signal.vibration <= r.threshold * 0.9);

export function runMaintenanceRules(state: FactoryState, nowISO: string) {
  const rules = (state.rules ?? []).filter((r): r is MaintenanceRule => r.kind === "maintenance" && r.enabled);
  if (!rules.length) return;
  const rt = (state.ruleRuntime ??= { seq: 0, rules: {} });
  for (const r of rules) {
    const st = (rt.rules[r.id] ??= { active: false, directiveIds: [], fired: 0, lastFiredHour: null });
    const tripped = new Set(st.assets ?? []);
    for (const a of state.assets) {
      if (r.assetId && a.id !== r.assetId) continue;
      if (tripped.has(a.id)) {
        if (cleared(r, a)) tripped.delete(a.id);
        continue;
      }
      if (!breached(r, a)) continue;
      tripped.add(a.id);
      // A stopped machine is already being repaired, and an existing plan isn't duplicated.
      if (a.mode !== "running") continue;
      const planned =
        state.directives.some((d) => d.kind === "maintenance" && d.assetId === a.id && (d.status === "scheduled" || d.status === "active")) ||
        state.recommendations.some((x) => x.status === "pending" && x.affectedAssetIds[0] === a.id);
      if (planned) continue;
      st.fired += 1;
      st.lastFiredHour = state.clock.hour;
      propose(state, r, a, nowISO);
    }
    st.assets = [...tripped];
    st.active = tripped.size > 0;
  }
}

function propose(state: FactoryState, r: MaintenanceRule, a: Asset, nowISO: string) {
  const reading = r.metric === "health" ? `health ${a.healthScore.toFixed(0)} < ${r.threshold}` : `vibration ${a.signal.vibration.toFixed(1)} mm/s > ${r.threshold}`;
  try {
    const results = simulateScenarios(state, presetScenarios(state, a.id));
    const ranking = rankScenarios(results);
    const chosen = results.find((x) => x.definition.id === "preventive");
    if (!chosen?.feasible) throw new Error(chosen?.infeasibleReason ?? "no preventive plan for this machine");
    const run: ScenarioRun = { id: nextId(state, "RUN", 500), createdHour: state.clock.hour, at: nowISO, source: "rule", targetAssetId: a.id, results, baselineId: "baseline", recommendedId: ranking[0]?.scenarioId ?? null, ranking };
    addScenarioRun(state, run);
    const rec = addRecommendation(state, buildRecommendation(state, run, "preventive", { source: "rule", analysisId: null, nowISO }));
    appendAudit(state, nowISO, {
      category: "recommendation",
      actor: "Automation rule",
      title: `${rec.id} proposed by rule "${r.name}" — awaiting human approval`,
      detail: `${a.name}: ${reading}. ${rec.title}. Nothing changes until a person approves it.`,
      severity: "warning",
      refs: { recommendationId: rec.id, scenarioRunId: run.id, assetIds: [a.id] },
    });
  } catch (e) {
    appendAudit(state, nowISO, {
      category: "action",
      actor: "Automation rule",
      title: `Rule "${r.name}" fired on ${a.id} but could not propose maintenance`,
      detail: `${a.name}: ${reading}. ${e instanceof Error ? e.message : String(e)}`,
      severity: "warning",
      refs: { assetIds: [a.id] },
    });
  }
}
