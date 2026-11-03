import { appendAudit } from "./audit";
import { DomainError } from "./errors";
import { nextId } from "./ids";
import { calibrateAsset, findRerouteLine, MAINTENANCE_HOURS_BY_KIND, primaryProductOf, rankScenarios, simulateScenarios } from "./simulation";
import type { FactoryState, ScenarioDefinition, ScenarioParams, ScenarioRun } from "./types";

export interface SharedAssumptions {
  horizonHours: number;
  unplannedRepairHours: number;
  energyPricePerKwh: number;
  idlePowerFactor: number;
  inventoryAvailabilityPct: Record<string, number>;
  expediteItemIds: string[];
  orderOverrides: ScenarioParams["orderOverrides"];
}

export function defaultAssumptions(state: FactoryState): SharedAssumptions {
  return {
    horizonHours: 48,
    unplannedRepairHours: state.costModel.unplannedRepairHours,
    energyPricePerKwh: state.costModel.energyPricePerKwh,
    idlePowerFactor: state.costModel.idlePowerFactor,
    inventoryAvailabilityPct: {},
    expediteItemIds: [],
    orderOverrides: {},
  };
}

/** Pick the incident focus: the open-incident asset with the lowest health, else the lowest-health asset. */
export function pickFocusAsset(state: FactoryState) {
  const incidentAssets = state.incidents.filter((i) => i.status !== "resolved").map((i) => i.assetId);
  const pool = state.assets.filter((a) => incidentAssets.includes(a.id));
  const candidates = pool.length ? pool : state.assets;
  return [...candidates].sort((a, b) => {
    const ra = a.mode === "down" ? -1 : a.healthScore;
    const rb = b.mode === "down" ? -1 : b.healthScore;
    return ra - rb;
  })[0];
}

export function maintenanceHoursFor(state: FactoryState, assetId: string) {
  const a = state.assets.find((x) => x.id === assetId);
  return a ? (MAINTENANCE_HOURS_BY_KIND[a.kind] ?? 4) : 4;
}

/** Baseline reference + the three alternative operating plans for a target asset. */
export function presetScenarios(state: FactoryState, targetAssetId: string, shared?: Partial<SharedAssumptions>): ScenarioDefinition[] {
  const s = { ...defaultAssumptions(state), ...shared };
  const asset = state.assets.find((a) => a.id === targetAssetId);
  const maint = maintenanceHoursFor(state, targetAssetId);
  const altLine = findRerouteLine(state, targetAssetId);
  const product = asset ? primaryProductOf(state, asset.lineId) : null;
  const changeover = altLine?.capabilities.find((c) => c.productId === product)?.changeoverHours ?? 0.75;
  const cal = calibrateAsset(state, targetAssetId);
  const name = asset?.name ?? targetAssetId;
  const base: Omit<ScenarioParams, "targetSpeedPct" | "maintenanceStartHour" | "reroute"> = {
    horizonHours: s.horizonHours,
    targetAssetId,
    maintenanceDurationHours: maint,
    unplannedRepairHours: s.unplannedRepairHours,
    inventoryAvailabilityPct: { ...s.inventoryAvailabilityPct },
    expediteItemIds: [...s.expediteItemIds],
    orderOverrides: { ...s.orderOverrides },
    energyPricePerKwh: s.energyPricePerKwh,
    idlePowerFactor: s.idlePowerFactor,
  };
  const noReroute = { enabled: false, toLineId: altLine?.id ?? null, sharePct: 100, startHour: 0, durationHours: maint + changeover };
  const ttf = cal?.hoursToTrip;
  return [
    {
      id: "baseline",
      kind: "baseline",
      name: "Reference plan",
      description: `Production plan as scheduled, assuming ${name} were healthy. Used as the comparison baseline.`,
      params: { ...base, targetSpeedPct: 100, maintenanceStartHour: null, reroute: { ...noReroute }, assumeHealthy: true },
    },
    {
      id: "continue",
      kind: "continue",
      name: "Continue production",
      description: `Keep ${name} running at full speed with no intervention${ttf ? ` (calibrated time-to-trip ≈ ${ttf.toFixed(0)} h)` : ""}.`,
      params: { ...base, targetSpeedPct: 100, maintenanceStartHour: null, reroute: { ...noReroute } },
    },
    {
      id: "preventive",
      kind: "preventive",
      name: "Stop for preventive maintenance",
      description: `Stop ${name} now for a ${maint} h planned maintenance window; Line output pauses during the work.`,
      params: { ...base, targetSpeedPct: 100, maintenanceStartHour: 0.25, reroute: { ...noReroute } },
    },
    {
      id: "reroute",
      kind: "reroute",
      name: altLine ? `Reroute to ${altLine.name.replace("Assembly ", "")} + maintain` : "Reroute + maintain",
      description: altLine
        ? `Shift ${product} to ${altLine.name} first, then service ${name} while the alternate line covers the critical order.`
        : `No qualified alternate line exists for ${product ?? "this product"} — rerouting is not available.`,
      params: {
        ...base,
        targetSpeedPct: 100,
        maintenanceStartHour: changeover,
        reroute: { enabled: true, toLineId: altLine?.id ?? null, sharePct: 100, startHour: 0, durationHours: changeover + maint },
      },
    },
  ];
}

/** Apply shared assumptions to an existing set of definitions (used by the workbench). */
export function applyShared(defs: ScenarioDefinition[], shared: SharedAssumptions): ScenarioDefinition[] {
  return defs.map((d) => ({
    ...d,
    params: {
      ...d.params,
      horizonHours: shared.horizonHours,
      unplannedRepairHours: shared.unplannedRepairHours,
      energyPricePerKwh: shared.energyPricePerKwh,
      idlePowerFactor: shared.idlePowerFactor,
      inventoryAvailabilityPct: { ...shared.inventoryAvailabilityPct },
      expediteItemIds: [...shared.expediteItemIds],
      orderOverrides: { ...shared.orderOverrides },
    },
  }));
}

/** Keep recent scenario runs; strip hourly series from older runs to bound state size. */
export function addScenarioRun(live: FactoryState, run: ScenarioRun) {
  live.scenarioRuns.unshift(run);
  live.scenarioRuns = live.scenarioRuns.slice(0, 8).map((r, i) => (i < 3 ? r : { ...r, results: r.results.map((x) => ({ ...x, hourly: [] })) }));
}

export interface OperatorScenarioInput {
  /** Asset to plan around; defaults to the first definition's target, then the incident focus. */
  targetAssetId?: string;
  /** Plans to compare; defaults to the preset plans for the target. */
  definitions?: ScenarioDefinition[];
  /** Store the run (and audit it); otherwise it is a preview with id "PREVIEW". */
  persist: boolean;
}

/** Run (and by default store) an operator's scenario comparison. Every figure is recomputed here. */
export function runOperatorScenarios(state: FactoryState, input: OperatorScenarioInput, nowISO: string): ScenarioRun {
  const target = input.targetAssetId ?? input.definitions?.[0]?.params.targetAssetId ?? pickFocusAsset(state).id;
  if (!state.assets.some((a) => a.id === target)) throw new DomainError(`Unknown asset ${target}`, 404);
  const defs = input.definitions ?? presetScenarios(state, target);
  const results = simulateScenarios(state, defs);
  const ranking = rankScenarios(results);
  const run: ScenarioRun = {
    id: input.persist ? nextId(state, "RUN", 500) : "PREVIEW",
    createdHour: state.clock.hour,
    at: nowISO,
    source: "operator",
    targetAssetId: target,
    results,
    baselineId: results.find((x) => x.definition.kind === "baseline")?.definition.id ?? results[0].definition.id,
    recommendedId: ranking[0]?.scenarioId ?? null,
    ranking,
  };
  if (input.persist) {
    addScenarioRun(state, run);
    appendAudit(state, nowISO, {
      category: "scenario",
      actor: "Operator",
      title: `Scenario run ${run.id}: ${results.length} scenarios for ${target}`,
      detail: ranking.map((x) => `${results.find((y) => y.definition.id === x.scenarioId)?.definition.name} ${x.score.toFixed(1)}`).join(" · "),
      severity: "info",
      refs: { scenarioRunId: run.id, assetIds: [target] },
    });
  }
  return run;
}
