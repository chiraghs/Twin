import type { Narrative } from "./types";

/** Structured, metric-only input for narrative generation (LLM or deterministic). */
export interface NarrativeInput {
  factory: string;
  asset: { id: string; name: string; failureMode: string | null };
  incident: string | null;
  agentSummaries: { agent: string; summary: string; confidence: string }[];
  scenarios: {
    id: string;
    name: string;
    score: number;
    lateUnits: number;
    ordersLate: number;
    operatingCost: number;
    failureHour: number | null;
    unplannedDowntime: number;
    feasible: boolean;
  }[];
  recommended: { id: string; name: string; explanation: string[]; risks: string[]; benefits: string[] } | null;
  conflicts: string[];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Template narrative built only from computed metrics — used when no LLM is configured or it fails. */
export function deterministicNarrative(input: NarrativeInput, note?: string): Narrative {
  const rec = input.recommended;
  const sorted = [...input.scenarios].filter((s) => s.id !== "baseline");
  const cont = sorted.find((s) => s.id === "continue");
  const best = rec ? sorted.find((s) => s.id === rec.id) : sorted[0];
  const summary = rec && best
    ? `${input.asset.name} (${input.asset.id}) is degrading${input.asset.failureMode ? ` — likely ${input.asset.failureMode.toLowerCase()}` : ""}. ${cont?.failureHour != null ? `Left alone, the model predicts a protective trip at h+${cont.failureHour.toFixed(1)}` : "Left alone, risk keeps rising"}${cont && cont.lateUnits > 0 ? ` and ${fmt(cont.lateUnits)} late units` : ""}. Recommended: ${rec.name} (score ${best.score.toFixed(1)}), with ${best.lateUnits > 0 ? `${fmt(best.lateUnits)} late units` : "all due orders on time"} at ≈$${fmt(best.operatingCost)} estimated cost.`
    : `${input.asset.name} analysed; no feasible plan was found.`;
  const rationale = rec
    ? `The orchestrator compared ${sorted.length} operating plans against a healthy reference plan using one plant model. ${rec.explanation.slice(0, 2).join(" ")} Plans that run the asset to a predicted trip are ranked below plans that avoid it (asset-protection policy).`
    : "No plan satisfied the constraints.";
  const risks = rec ? rec.risks.slice(0, 4) : [];
  const operatorBriefing = rec
    ? `Shift lead: review ${rec.id === "reroute" ? "the line re-allocation and " : ""}the maintenance window for ${input.asset.id}. If approved, the twin will schedule the work order and update production allocations automatically (simulated execution).`
    : "Shift lead: continue monitoring.";
  return { source: "deterministic", summary, rationale, risks, operatorBriefing, note };
}
