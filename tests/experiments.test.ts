import { describe, expect, it } from "vitest";
import { rng, runExperiment, stat } from "@/domain/experiments";
import { crisis } from "./helpers";

describe("experiments under uncertainty", () => {
  it("is reproducible for a seed and different for another", () => {
    const s = crisis();
    const a = runExperiment(s, { targetAssetId: "A-ROB-03", replications: 8, seed: 11 });
    const b = runExperiment(s, { targetAssetId: "A-ROB-03", replications: 8, seed: 11 });
    const c = runExperiment(s, { targetAssetId: "A-ROB-03", replications: 8, seed: 12 });
    expect(JSON.stringify(a.plans)).toBe(JSON.stringify(b.plans));
    expect(JSON.stringify(a.plans)).not.toBe(JSON.stringify(c.plans));
  });

  it("reports intervals around the mean, odds that add up, and never recommends a plan that fails the asset", () => {
    const r = runExperiment(crisis(), { targetAssetId: "A-ROB-03", replications: 12, seed: 7 });
    for (const p of r.plans) {
      expect(p.score.ci95[0]).toBeLessThanOrEqual(p.score.mean);
      expect(p.score.ci95[1]).toBeGreaterThanOrEqual(p.score.mean);
      expect(p.pFailure).toBeGreaterThanOrEqual(0);
      expect(p.pFailure).toBeLessThanOrEqual(1);
    }
    expect(r.plans.reduce((s, p) => s + p.pBest, 0)).toBeCloseTo(1, 5);
    const cont = r.plans.find((p) => p.scenarioId === "continue")!;
    expect(cont.pFailure).toBe(1);
    expect(r.recommendedId).not.toBe("continue");
    expect(r.plans.find((p) => p.scenarioId === r.recommendedId)!.pFailure).toBe(0);
  });

  it("stat and rng behave", () => {
    const s = stat([1, 2, 3, 4, 5]);
    expect(s.mean).toBe(3);
    expect(s.ci95[0]).toBeLessThan(3);
    const u = rng(1);
    const xs = Array.from({ length: 1000 }, u);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
});
