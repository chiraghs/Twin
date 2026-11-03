import { describe, expect, it } from "vitest";
import { callTwinTool, TWIN_TOOLS, type ToolStore } from "@/domain/tools/twin-tools";
import type { FactoryState } from "@/domain/types";
import { crisis, NOW } from "./helpers";

const storeFor = (s: FactoryState): ToolStore => ({ get: () => s, mutate: (fn) => fn(s), now: () => NOW });

describe("twin tools", () => {
  it("every read tool runs on the crisis factory without changing it", () => {
    const s = crisis();
    const before = JSON.stringify(s);
    for (const t of TWIN_TOOLS.filter((x) => x.effect === "read")) {
      const args = t.name === "diagnose_asset" ? { assetId: "A-ROB-03" } : {};
      const out = callTwinTool(storeFor(s), t.name, args, "Test");
      expect(JSON.stringify(out).length).toBeGreaterThan(10);
    }
    expect(JSON.stringify(s)).toBe(before);
  });

  it("returns the engine's numbers (what-if matches the crisis forecast)", () => {
    const s = crisis();
    const out = callTwinTool(storeFor(s), "run_what_if", {}, "Test") as { recommendedPlanId: string; plans: { id: string; lateUnits: number; failureOccurs: boolean }[] };
    expect(out.recommendedPlanId).toBe("reroute");
    const cont = out.plans.find((p) => p.id === "continue")!;
    expect(cont.failureOccurs).toBe(true);
    expect(cont.lateUnits).toBeGreaterThan(500);
    expect(out.plans.find((p) => p.id === "reroute")!.lateUnits).toBe(0);
  });

  it("evaluates a custom plan alongside the presets", () => {
    const out = callTwinTool(storeFor(crisis()), "run_what_if", { maintenanceStartHour: 4, targetSpeedPct: 80 }, "Test") as { plans: { id: string; name: string }[] };
    expect(out.plans.find((p) => p.id === "custom")!.name).toContain("maintenance at h+4");
  });

  it("propose_plan only creates a pending recommendation and audits who proposed it", () => {
    const s = crisis();
    const out = callTwinTool(storeFor(s), "propose_plan", { plan: "reroute", reason: "Protect ORD-1042" }, "Twin Copilot") as { recommendationId: string; status: string };
    const rec = s.recommendations.find((r) => r.id === out.recommendationId)!;
    expect(rec.status).toBe("pending");
    expect(out.status).toMatch(/must approve/);
    expect(s.directives.filter((d) => d.status === "active")).toHaveLength(0);
    expect(s.audit[0]).toMatchObject({ category: "recommendation", actor: "Twin Copilot" });
  });

  it("rejects unknown tools, unknown assets and invalid arguments", () => {
    const st = storeFor(crisis());
    expect(() => callTwinTool(st, "approve_recommendation", {}, "x")).toThrow(/Unknown tool/);
    expect(() => callTwinTool(st, "diagnose_asset", { assetId: "NOPE" }, "x")).toThrow(/Unknown asset/);
    expect(() => callTwinTool(st, "run_what_if", { targetSpeedPct: 500 }, "x")).toThrow(/Invalid arguments/);
    expect(() => callTwinTool(st, "list_assets", { bogus: 1 }, "x")).toThrow(/Invalid arguments/);
  });

  it("has no tool that can approve, execute or command equipment", () => {
    for (const t of TWIN_TOOLS) expect(t.name).not.toMatch(/approve|execute|reject|rollback|fault|reset|command|write/);
    expect(TWIN_TOOLS.filter((t) => t.effect !== "read").map((t) => t.name)).toEqual(["propose_plan"]);
  });
});

describe("answer grounding", async () => {
  const { checkGrounding, extractFigures } = await import("@/domain/tools/grounding");
  it("ignores identifiers and small counts, keeps real figures", () => {
    expect(extractFigures("ORD-1042 on LINE-A and A-ROB-03: 3 lines, 718 late units, 82.3 score, $13,661, 12.5%, 13.7K").map((f) => f.raw)).toEqual(["718", "82.3", "$13,661", "12.5%", "13.7K"]);
  });
  it("traces figures to tool results within the stated precision", () => {
    const sources = [{ lateUnits: 718, score: 82.31, cost: 13660.7, onTime: 0.125, note: "trip at h+16.5" }];
    expect(checkGrounding("718 late units, score 82.3, $13,661, 12.5% on time, trip at h+16.5, about 13.7K", sources).unverified).toEqual([]);
    expect(checkGrounding("It saves $25,000 and 940 units", sources).unverified).toEqual(["$25,000", "940"]);
    const diff = checkGrounding("Rerouting saves $44,015 versus continuing", [{ continueCost: 57676, rerouteCost: 13661 }]);
    expect(diff).toMatchObject({ unverified: [], derived: ["$44,015"] });
  });
});
