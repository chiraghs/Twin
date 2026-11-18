/**
 * Experiments: run every candidate plan many times with the uncertain inputs varied, so plans are
 * compared on their spread of outcomes, not one deterministic run.
 *
 * Each replication draws one set of uncertain inputs (repair and maintenance durations, supplier
 * fill rate, order quantities) and applies the SAME draw to every plan (common random numbers), so
 * differences between plans come from the plans, not from luck. Seeded: same seed, same results.
 */
import { round } from "./math";
import { presetScenarios } from "./scenarios";
import { rankScenarios, simulateScenarios } from "./simulation";
import type { FactoryState, ScenarioDefinition, ScenarioParams } from "./types";

export interface ExperimentOptions {
  replications: number;
  seed: number;
  /** Relative spread of the uncertain inputs (0.15 = ±15 %-ish). */
  spread: number;
}

export interface Stat {
  mean: number;
  sd: number;
  /** 95 % confidence interval of the mean. */
  ci95: [number, number];
  min: number;
  max: number;
}

export interface PlanStats {
  scenarioId: string;
  name: string;
  kind: ScenarioDefinition["kind"];
  feasible: boolean;
  score: Stat;
  lateUnits: Stat;
  operatingCost: Stat;
  onTimeRate: Stat;
  /** Share of replications where the asset fails / any due order is late. */
  pFailure: number;
  pLate: number;
  /** Share of replications in which this plan ranked first. */
  pBest: number;
}

export interface ExperimentResult {
  targetAssetId: string;
  replications: number;
  seed: number;
  spread: number;
  plans: PlanStats[];
  /** The plan with the highest mean score among those that never fail the asset, else highest mean. */
  recommendedId: string | null;
  inputs: string[];
}

/** mulberry32: small, fast, seeded PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from two uniforms (Box–Muller). */
const normal = (u: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, u()))) * Math.cos(2 * Math.PI * u());

/** Two-sided 95 % t quantiles for small samples (df 1–30), then the normal value. */
const T95 = [12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.2, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.1, 2.09, 2.09, 2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05, 2.04];

export function stat(xs: number[]): Stat {
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / Math.max(1, n);
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const t = n > 1 ? (T95[n - 2] ?? 1.96) : 0;
  const half = n > 1 ? (t * sd) / Math.sqrt(n) : 0;
  const r = (v: number) => round(v, 2);
  return { mean: r(mean), sd: r(sd), ci95: [r(mean - half), r(mean + half)], min: r(Math.min(...xs)), max: r(Math.max(...xs)) };
}

/** One draw of the uncertain inputs, applied to a plan's parameters. */
function perturb(p: ScenarioParams, draw: Draw): ScenarioParams {
  return {
    ...p,
    unplannedRepairHours: round(p.unplannedRepairHours * draw.repair, 2),
    maintenanceDurationHours: round(p.maintenanceDurationHours * draw.maintenance, 2),
    inventoryAvailabilityPct: Object.fromEntries(Object.entries(draw.supply).map(([id, f]) => [id, round(Math.min(100, (p.inventoryAvailabilityPct[id] ?? 100) * f), 1)])),
    orderOverrides: Object.fromEntries(
      Object.entries(draw.demand).map(([id, f]) => {
        const base = p.orderOverrides[id] ?? {};
        return [id, { ...base, quantity: Math.max(1, Math.round((base.quantity ?? draw.baseQty[id]) * f)) }];
      }),
    ),
  };
}

interface Draw {
  repair: number;
  maintenance: number;
  supply: Record<string, number>;
  demand: Record<string, number>;
  baseQty: Record<string, number>;
}

function drawInputs(state: FactoryState, u: () => number, spread: number): Draw {
  const clampF = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const open = state.orders.filter((o) => o.completedHour === null);
  return {
    // Repairs run long more often than short (right-skewed); maintenance a little either way.
    repair: clampF(Math.exp(normal(u) * spread * 1.3), 0.6, 2.2),
    maintenance: clampF(1 + normal(u) * spread * 0.8, 0.7, 1.6),
    // Supplier fill rate: usually complete, sometimes short.
    supply: Object.fromEntries(state.inventory.map((i) => [i.id, clampF(1 - Math.abs(normal(u)) * spread * 0.5, 0.6, 1)])),
    demand: Object.fromEntries(open.map((o) => [o.id, clampF(1 + normal(u) * spread * 0.5, 0.75, 1.3)])),
    baseQty: Object.fromEntries(open.map((o) => [o.id, o.quantity])),
  };
}

/** Run the experiment: every plan × every replication. */
export function runExperiment(state: FactoryState, input: { targetAssetId?: string; definitions?: ScenarioDefinition[] } & Partial<ExperimentOptions>): ExperimentResult {
  const opts: ExperimentOptions = { replications: Math.min(60, Math.max(3, input.replications ?? 20)), seed: input.seed ?? 7, spread: Math.min(0.5, Math.max(0, input.spread ?? 0.2)) };
  const target = input.targetAssetId ?? input.definitions?.[0]?.params.targetAssetId ?? state.assets[0].id;
  const defs = (input.definitions ?? presetScenarios(state, target)).filter((d) => d.kind !== "baseline");
  const u = rng(opts.seed);
  const samples = new Map(defs.map((d) => [d.id, { score: [] as number[], late: [] as number[], cost: [] as number[], onTime: [] as number[], fail: 0, anyLate: 0, best: 0, feasible: true }]));
  for (let r = 0; r < opts.replications; r++) {
    const draw = drawInputs(state, u, opts.spread);
    const varied = defs.map((d) => ({ ...d, params: perturb(d.params, draw) }));
    const results = simulateScenarios(state, varied);
    const ranking = rankScenarios(results);
    for (const res of results) {
      const s = samples.get(res.definition.id)!;
      const m = res.metrics;
      s.feasible &&= res.feasible;
      s.score.push(res.feasible ? m.score : 0);
      s.late.push(m.lateUnits);
      s.cost.push(m.operatingCost);
      s.onTime.push(m.onTimeRate * 100);
      if (m.failureOccurs) s.fail++;
      if (m.ordersLate > 0) s.anyLate++;
    }
    if (ranking[0]) samples.get(ranking[0].scenarioId)!.best++;
  }
  const n = opts.replications;
  const plans: PlanStats[] = defs.map((d) => {
    const s = samples.get(d.id)!;
    return {
      scenarioId: d.id,
      name: d.name,
      kind: d.kind,
      feasible: s.feasible,
      score: stat(s.score),
      lateUnits: stat(s.late),
      operatingCost: stat(s.cost),
      onTimeRate: stat(s.onTime),
      pFailure: round(s.fail / n, 3),
      pLate: round(s.anyLate / n, 3),
      pBest: round(s.best / n, 3),
    };
  });
  const safe = plans.filter((p) => p.feasible && p.pFailure === 0);
  const pool = safe.length ? safe : plans.filter((p) => p.feasible);
  const recommendedId = pool.sort((a, b) => b.score.mean - a.score.mean)[0]?.scenarioId ?? null;
  return {
    targetAssetId: target,
    replications: n,
    seed: opts.seed,
    spread: opts.spread,
    plans: plans.sort((a, b) => b.score.mean - a.score.mean),
    recommendedId,
    inputs: [
      `Unplanned repair duration × log-normal (median 1, spread ${Math.round(opts.spread * 130)} %)`,
      `Planned maintenance duration × normal (±${Math.round(opts.spread * 80)} %)`,
      `Supplier fill rate per material: complete or short by up to ${Math.round(opts.spread * 50 * 2)} %`,
      `Open order quantities × normal (±${Math.round(opts.spread * 50)} %)`,
      "The same draw is applied to every plan in a replication (common random numbers).",
    ],
  };
}
