import { afterEach, describe, expect, it } from "vitest";
import { aiConfig, generateNarrative, ungroundedFigures } from "@/server/ai/provider";
import type { NarrativeInput } from "@/domain/narrative";

const input: NarrativeInput = {
  factory: "Test plant",
  asset: { id: "A-ROB-03", name: "Assembly Robot A3", failureMode: "Joint-4 gearbox bearing wear" },
  incident: "Rising vibration",
  agentSummaries: [{ agent: "Maintenance", summary: "Trip in 16 h", confidence: "high" }],
  scenarios: [
    { id: "continue", name: "Continue", score: 45.3, lateUnits: 746, ordersLate: 1, operatingCost: 58023, failureHour: 15.8, unplannedDowntime: 16, feasible: true },
    { id: "reroute", name: "Reroute", score: 81.5, lateUnits: 0, ordersLate: 0, operatingCost: 13668, failureHour: null, unplannedDowntime: 0, feasible: true },
  ],
  recommended: { id: "reroute", name: "Reroute", explanation: ["Line B covers ECU-200."], risks: ["Changeovers"], benefits: [] },
  conflicts: [],
};

describe("AI provider", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("accepts figures that trace to simulation outputs and flags invented ones", () => {
    expect(ungroundedFigures("Avoids 746 late units and saves about $58,023 vs $13,668; trip at h+15.8.", input)).toEqual([]);
    expect(ungroundedFigures("This plan saves $99,999 and 4,321 units.", input)).toEqual(["99999", "4321"]);
  });

  it("falls back to a deterministic, metric-only narrative without credentials", async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.MODEL_API_KEY;
    expect(aiConfig().provider).toBe("none");
    const n = await generateNarrative(input);
    expect(n.source).toBe("deterministic");
    expect(n.summary).toContain("Reroute");
    expect(ungroundedFigures(`${n.summary} ${n.rationale}`, input)).toEqual([]);
  });
});
