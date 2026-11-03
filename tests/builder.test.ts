import { describe, expect, it } from "vitest";
import { runAnalysisPipeline } from "@/domain/agents/pipeline";
import { compileSpec, planFromSpec } from "@/domain/builder/compile";
import type { TwinSpec } from "@/domain/builder/spec";
import { matchTemplate, TEMPLATES, templateById } from "@/domain/builder/templates";
import { validateSpec } from "@/domain/builder/validate";
import { computeKpis } from "@/domain/kpis";
import { computeQuality } from "@/domain/quality";
import { presetScenarios, pickFocusAsset } from "@/domain/scenarios";
import { simulateScenarios } from "@/domain/simulation";
import { advanceFactory } from "@/domain/telemetry";
import { ANCHOR, NOW } from "./helpers";

const compile = (spec: TwinSpec, seed = 7) => compileSpec(spec, ANCHOR, seed, NOW, "Test");
const clone = (id: string) => structuredClone(templateById(id)!.spec);

describe("twin templates", () => {
  it.each(TEMPLATES.map((t) => [t.id]))("%s validates, compiles and runs", (id) => {
    const v = validateSpec(clone(id));
    expect(v.issues.filter((i) => i.level !== "info")).toEqual([]); // templates must be clean starting points
    const s = compile(clone(id));
    expect(s.assets.length).toBe(v.spec!.lines.reduce((n, l) => n + l.machines.length, 0));
    expect(s.orders.length).toBeGreaterThan(0);
    advanceFactory(s, 6, { nowISO: NOW });
    const k = computeKpis(s);
    for (const v2 of [k.oee.oee, k.output.actual, k.energy.kwhPerUnit, k.scrap.rate]) expect(Number.isFinite(v2)).toBe(true);
    expect(k.output.actual).toBeGreaterThan(0);
    expect(s.production.filter((r) => r.hour >= 0).reduce((n, r) => n + r.goodUnits, 0)).toBeGreaterThan(0);
    const focus = pickFocusAsset(s);
    const results = simulateScenarios(s, presetScenarios(s, focus.id));
    expect(results.every((r) => Number.isFinite(r.metrics.totalOutput) && r.metrics.totalOutput > 0)).toBe(true);
    expect(s.twinSpec?.site.name).toBe(v.spec!.site.name);
    expect(s.audit[0].title).toContain("Twin Builder");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(compile(clone("beverage-bottling")))).toBe(JSON.stringify(compile(clone("beverage-bottling"))));
  });

  it("uses industry-appropriate defect classes", () => {
    const s = compile(clone("plastics-injection"));
    advanceFactory(s, 4, { nowISO: NOW });
    const types = computeQuality(s, 24).pareto.map((p) => p.type);
    expect(types.some((t) => /short shot|flash|sink/i.test(t))).toBe(true);
    expect(types.some((t) => /solder/i.test(t))).toBe(false);
    expect(s.cameras.find((c) => c.kind === "inspection" && c.lineId === "LINE-A")!.standard).not.toContain("IPC");
  });

  it("supports a rehearsal incident and the full agent analysis on a generated twin", async () => {
    const sp = clone("automotive-machining");
    sp.options.rehearsalIncident = true;
    const s = compile(sp);
    expect(s.incidents.filter((i) => i.status === "open")).toHaveLength(1);
    const gen = runAnalysisPipeline(structuredClone(s), { nowISO: () => NOW, pace: async () => {} });
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    expect(step.value.recommendation).toBeTruthy();
  });

  it("matches free text to a template without AI", () => {
    expect(matchTemplate("We bottle spring water and juice in PET")!.template.id).toBe("beverage-bottling");
    expect(matchTemplate("tablet compression and blister packing")!.template.id).toBe("pharma-osd");
    expect(matchTemplate("xyz")).toBeNull();
  });
});

describe("spec validation", () => {
  it("rejects specs the engine cannot run", () => {
    const sp = clone("food-bakery");
    sp.lines = sp.lines.filter((l) => l.role === "packing");
    expect(validateSpec(sp).ok).toBe(false);
    const two = clone("food-bakery");
    two.lines.push({ ...structuredClone(two.lines[1]), id: "packing-2" });
    expect(validateSpec(two).issues.some((i) => i.level === "error" && /one packing/i.test(i.message))).toBe(true);
    expect(validateSpec({ version: 1, lines: [] }).ok).toBe(false);
  });

  it("repairs references and reports what it changed", () => {
    const sp = clone("metal-welding");
    sp.lines[0].productIds = ["nope"];
    sp.products[0].materials.push({ materialId: "fasteners", qtyPerUnit: 8 });
    sp.integrations.push({ id: "c1", target: "ghost", kind: "opcua", address: "ns=2;s=Weld1", notes: null, prov: { source: "requirement" } });
    sp.lines[0].machines[0].prov.refs = ["R9"];
    const v = validateSpec(sp);
    expect(v.ok).toBe(true);
    expect(v.spec!.lines[0].productIds).toEqual(["seat-frame"]);
    expect(v.spec!.materials.some((m) => m.id === "fasteners")).toBe(true);
    expect(v.spec!.integrations).toHaveLength(0);
    expect(v.spec!.lines[0].machines[0].prov.refs).toEqual([]);
    expect(v.issues.filter((i) => i.level === "warning").length).toBeGreaterThanOrEqual(4);
  });

  it("flags bottlenecks and implausible rates", () => {
    const sp = clone("beverage-bottling");
    sp.lines[0].machines[2].ratePerHour = 3000; // labeler slower than the 10,000/h product rate
    sp.lines[0].machines[1].ratePerHour = 150000; // filler: probably the wrong unit
    const v = validateSpec(sp);
    expect(v.ok).toBe(true);
    expect(v.issues.some((i) => /limits Filling Line 1/.test(i.message))).toBe(true);
    expect(v.issues.some((i) => /Filler-capper monobloc: 150000\/h is outside the typical range/.test(i.message))).toBe(true);
    sp.lines[0].machines[1].ratePerHour = 900000; // beyond any plausible value: rejected outright
    expect(validateSpec(sp).ok).toBe(false);
  });

  it("maps planned data connections to engine ids", () => {
    const sp = clone("beverage-bottling");
    sp.integrations.push({ id: "c1", target: "filling-1-m2", kind: "opcua", address: "ns=3;s=Filler.Speed", notes: null, prov: { source: "requirement" } });
    const s = compile(sp);
    expect(s.dataPlan).toEqual([expect.objectContaining({ target: "A-FIL-02", targetName: "Filler-capper monobloc", kind: "opcua", status: "planned" })]);
    expect(s.profile.dataSource).toBe("cloud");
    expect(planFromSpec(sp).defaults.some((d) => /sample customer orders/.test(d))).toBe(true);
  });
});
