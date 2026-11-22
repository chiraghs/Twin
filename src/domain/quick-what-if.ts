/**
 * A one-question what-if for voice and VR: "what if A-ROB-03 runs at 80 %?" or "what if we
 * maintain it now?". Runs the same deterministic scenario engine as the Simulator against the
 * "continue as is" plan and reports the difference in a sentence. Nothing in the plant changes.
 */
import { round } from "./math";
import { presetScenarios } from "./scenarios";
import { simulateScenarios } from "./simulation";
import type { FactoryState, ScenarioMetrics } from "./types";

export const SPEED_LIMITS = { min: 30, max: 110 } as const;

export interface QuickOutcome {
  output: number;
  failureHour: number | null;
  lateUnits: number;
  energyKwh: number;
  operatingCost: number;
}

export interface QuickWhatIf {
  assetId: string;
  change: string;
  horizonHours: number;
  /** The speed actually simulated (capped to the machine's range), when a speed was asked. */
  speedPct: number | null;
  capped: boolean;
  asIs: QuickOutcome;
  plan: QuickOutcome;
  /** For speech and the result board. */
  summary: string;
  better: boolean;
}

const outcome = (m: ScenarioMetrics): QuickOutcome => ({
  output: Math.round(m.totalOutput),
  failureHour: m.failureOccurs && m.failureHour !== null ? round(m.failureHour, 1) : null,
  lateUnits: Math.round(m.lateUnits),
  energyKwh: Math.round(m.energyKwh),
  operatingCost: Math.round(m.operatingCost),
});

const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US")}`;

export function quickWhatIf(state: FactoryState, assetId: string, change: { speedPct?: number; maintainNow?: boolean }): QuickWhatIf {
  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) throw new Error(`Unknown machine ${assetId}`);
  const presets = presetScenarios(state, assetId);
  const cont = presets.find((d) => d.id === "continue")!;
  let speedPct: number | null = null;
  let capped = false;
  let plan = presets.find((d) => d.id === "preventive")!;
  let label = `we maintain ${asset.id} now`;
  if (!change.maintainNow) {
    const asked = Math.round(change.speedPct ?? 100);
    speedPct = Math.max(SPEED_LIMITS.min, Math.min(SPEED_LIMITS.max, asked));
    capped = speedPct !== asked;
    label = `${asset.id} runs at ${speedPct}%`;
    plan = { ...cont, id: "custom", kind: "custom", name: `Run at ${speedPct}%`, params: { ...cont.params, targetSpeedPct: speedPct } };
  }
  const [a, p] = simulateScenarios(state, [cont, plan]);
  const asIs = outcome(a.metrics);
  const res = outcome(p.metrics);
  const h = cont.params.horizonHours;
  const parts: string[] = [];
  parts.push(`${res.output - asIs.output === 0 ? "Same output" : `${signed(res.output - asIs.output)} units`} over ${h} hours`);
  if (asIs.failureHour !== null && res.failureHour === null) parts.push(`avoids the trip expected at hour ${Math.round(asIs.failureHour)}`);
  else if (res.failureHour !== null && asIs.failureHour === null) parts.push(`but it trips at hour ${Math.round(res.failureHour)}`);
  else if (res.failureHour !== null && asIs.failureHour !== null && Math.round(res.failureHour) !== Math.round(asIs.failureHour))
    parts.push(`trip moves from hour ${Math.round(asIs.failureHour)} to hour ${Math.round(res.failureHour)}`);
  else if (res.failureHour !== null) parts.push(`still trips at hour ${Math.round(res.failureHour)}`);
  if (res.lateUnits !== asIs.lateUnits) parts.push(`${res.lateUnits.toLocaleString("en-US")} late units instead of ${asIs.lateUnits.toLocaleString("en-US")}`);
  const better = res.lateUnits < asIs.lateUnits || (res.lateUnits === asIs.lateUnits && (res.failureHour === null) > (asIs.failureHour === null)) || (res.lateUnits === asIs.lateUnits && res.operatingCost < asIs.operatingCost);
  const summary = `What if ${label}${capped ? ` (capped at the ${SPEED_LIMITS.max}% limit)` : ""}: ${parts.join(", ")}. Estimate from the plant model; nothing was changed.`;
  return { assetId, change: label, horizonHours: h, speedPct, capped, asIs, plan: res, summary, better };
}
