import { describe, expect, it } from "vitest";
import { compileSpec } from "@/domain/builder/compile";
import type { BlueprintReading, Draft } from "@/domain/builder/draft";
import { refineSpec, runBuilder, type BuilderAi, type BuilderEvent, type BuilderInput } from "@/domain/builder/pipeline";
import type { TwinSpec } from "@/domain/builder/spec";
import { ANCHOR, NOW } from "./helpers";

const base: BuilderInput = { requirements: "", site: {}, templateId: null, blueprint: null, research: true };

async function run(input: Partial<BuilderInput>, ai: BuilderAi) {
  const events: BuilderEvent[] = [];
  for await (const e of runBuilder({ ...base, ...input }, ai)) events.push(e);
  const complete = events.find((e) => e.type === "complete") as Extract<BuilderEvent, { type: "complete" }>;
  return { events, spec: complete.spec, stages: events.filter((e): e is Extract<BuilderEvent, { type: "stage" }> => e.type === "stage" && e.status !== "running") };
}

const noAi: BuilderAi = {
  available: false,
  model: null,
  readBlueprint: async () => {
    throw new Error("unavailable");
  },
  research: async () => {
    throw new Error("unavailable");
  },
  draft: async () => {
    throw new Error("unavailable");
  },
  refine: async () => {
    throw new Error("unavailable");
  },
};

const reading: BlueprintReading = {
  legible: true,
  drawingKind: "floor plan",
  summary: "One bottling line with a filler, labeler and case packer.",
  siteName: "Riverside Bottling",
  industry: "Beverage",
  elements: [
    { id: "e1", label: "FILLER F-101", role: "machine", archetype: "filler", lineHint: "Line 1", box: [100, 100, 300, 250], confidence: 0.9 },
    { id: "e2", label: "LABELER L-102", role: "machine", archetype: "labeler", lineHint: "Line 1", box: [100, 300, 300, 420], confidence: 0.85 },
    { id: "e3", label: "CASE PACKER", role: "machine", archetype: "packager", lineHint: "Packing", box: [500, 100, 700, 300], confidence: 0.8 },
  ],
  flows: [{ from: "e1", to: "e2" }],
  notes: [],
};

const draft: Draft = {
  site: { name: "Riverside Bottling", industry: "Beverage", location: "", productionType: "PET bottling" },
  lines: [
    {
      name: "Line 1",
      role: "process",
      products: ["Water 1 L"],
      source: "blueprint",
      note: null,
      machines: [
        { name: "FILLER F-101", archetype: "filler", ratePerHour: 8000, source: "requirement", note: null, refs: [], blueprintElement: "e1" },
        { name: "LABELER L-102", archetype: "labeler", ratePerHour: null, source: "blueprint", note: null, refs: [], blueprintElement: "e2" },
        { name: "Bottle washer", archetype: "kiln-washer", ratePerHour: null, source: "reference", note: null, refs: ["R1", "R9"], blueprintElement: null },
        { name: "Capper", archetype: "filler", ratePerHour: null, source: "reference", note: null, refs: ["R9"], blueprintElement: null },
        { name: "Ghost conveyor", archetype: "conveyor", ratePerHour: null, source: "blueprint", note: null, refs: [], blueprintElement: "e99" },
      ],
    },
    { name: "Packing", role: "packing", products: [], source: "blueprint", note: null, machines: [{ name: "CASE PACKER", archetype: "packager", ratePerHour: null, source: "blueprint", note: null, refs: [], blueprintElement: "e3" }] },
  ],
  products: [{ name: "Water 1 L", unit: "bottles", ratePerHour: 7000, unitPrice: null, unitMaterialCost: null, source: "requirement", note: null, refs: [], materials: [{ material: "PET preform", qtyPerUnit: 1 }] }],
  materials: [],
  integrations: [{ target: "FILLER F-101", kind: "opcua", address: "ns=2;s=F101", note: null, source: "requirement" }],
  assumptions: ["Single shift."],
  questions: ["What is the case pack size?"],
};

const fakeAi = (overrides: Partial<BuilderAi> = {}): BuilderAi => ({
  available: true,
  model: "fake",
  readBlueprint: async () => reading,
  research: async () => ({ notes: "Fillers run 6,000–24,000 bph [R1].", references: [{ id: "R1", title: "Bottling line basics", url: "https://example.com/bottling" }], queries: ["bottling line layout"], searchEntryPoint: null }),
  draft: async () => structuredClone(draft),
  refine: async () => ({ explanation: "Added a palletizer.", ops: [{ op: "add_machine", lineId: "packing", name: "Palletizer", archetype: "palletizer" }, { op: "add_machine", lineId: "packing", name: "Teleporter", archetype: "teleporter" }] }),
  ...overrides,
});

describe("Twin Builder without AI", () => {
  it("starts from a chosen template and says it could not read the blueprint", async () => {
    const r = await run({ templateId: "food-bakery", blueprint: { data: "", mimeType: "image/png", fileName: "plan.png" }, site: { name: "Acme Bakery" } }, noAi);
    expect(r.stages.find((s) => s.stage === "read")!.status).toBe("skipped");
    expect(r.stages.find((s) => s.stage === "research")!.status).toBe("skipped");
    expect(r.spec!.site.name).toBe("Acme Bakery");
    expect(r.spec!.assumptions[0]).toMatch(/AI is turned off.*industrial bakery/is);
    expect(r.stages.find((s) => s.stage === "validate")!.status).toBe("done");
  });

  it("matches requirements to a template by keyword, or asks for one", async () => {
    expect((await run({ requirements: "We machine gear shafts on CNC lathes" }, noAi)).spec!.lines[0].name).toBe("Machining Cell 1");
    const none = await run({ requirements: "something entirely different" }, noAi);
    expect(none.spec).toBeNull();
    expect(none.stages.find((s) => s.stage === "draft")!.status).toBe("error");
  });
});

describe("Twin Builder with AI (recorded responses)", () => {
  it("links blueprint elements, filters citations and catches unsupported machine types", async () => {
    const r = await run({ requirements: "Bottling, 8000 bph filler, OPC UA on the filler", blueprint: { data: "AA==", mimeType: "image/png", fileName: "plan.png" } }, fakeAi());
    expect(r.events.some((e) => e.type === "reading")).toBe(true);
    const spec = r.spec!;
    const line = spec.lines.find((l) => l.role === "process")!;
    const [filler, labeler, washer, capper, ghost] = line.machines;
    expect(filler.box).toEqual({ x: 0.1, y: 0.1, w: 0.15, h: 0.2 });
    expect(labeler.prov.source).toBe("blueprint");
    expect(washer.archetype).toBe("workstation");
    expect(spec.assumptions.some((a) => a.includes("kiln-washer"))).toBe(true);
    expect(washer.prov).toMatchObject({ source: "reference", refs: ["R1"] });
    expect(capper.prov.source).toBe("default"); // claimed a reference it could not cite
    expect(ghost.prov.source).toBe("default"); // claimed the blueprint but no such element
    expect(spec.references.map((x) => x.id)).toEqual(["R1"]);
    expect(spec.integrations[0]).toMatchObject({ target: filler.id, kind: "opcua" });
    expect(spec.questions[0]).toMatchObject({ id: "q1", answer: null });
    expect(r.stages.find((s) => s.stage === "validate")!.status).toBe("done");
    const state = compileSpec(spec, ANCHOR, 3, NOW, "Test");
    expect(state.dataPlan![0]).toMatchObject({ kind: "opcua", targetName: "FILLER F-101" });
  });

  it("falls back to a template when the draft call fails", async () => {
    const r = await run({ requirements: "PET bottling line" }, fakeAi({ draft: async () => Promise.reject(new Error("quota exceeded")) }));
    expect(r.stages.find((s) => s.stage === "draft")!.summary).toMatch(/AI draft failed \(quota exceeded\).*Beverage/);
    expect(r.spec!.lines[0].name).toBe("Filling Line 1");
  });

  it("keeps going when research fails", async () => {
    const r = await run({ requirements: "PET bottling line" }, fakeAi({ research: async () => Promise.reject(new Error("search unavailable")) }));
    expect(r.stages.find((s) => s.stage === "research")!.status).toBe("error");
    expect(r.spec!.references).toEqual([]);
  });

  it("applies chat edits as validated operations and rejects invalid ones", async () => {
    const r = await run({ requirements: "PET bottling line" }, fakeAi());
    const out = await refineSpec(r.spec as TwinSpec, "add a palletizer at the end", fakeAi());
    expect(out.applied).toEqual(["Added Palletizer to Packing"]);
    expect(out.rejected[0]).toMatch(/teleporter/);
    const added = out.spec.lines.find((l) => l.id === "packing")!.machines.at(-1)!;
    expect(added.prov.source).toBe("requirement");
    expect(out.validation.ok).toBe(true);
  });
});

describe("edit operations", () => {
  it("replaces the placeholder machine when a new line gets its first real machine", async () => {
    const { applyOps } = await import("@/domain/builder/ops");
    const { templateById } = await import("@/domain/builder/templates");
    const spec = structuredClone(templateById("beverage-bottling")!.spec);
    const r = applyOps(
      spec,
      [
        { op: "add_line", name: "Line 3", role: "process" },
        { op: "add_machine", lineId: "line-3", name: "Can filler", archetype: "filler", position: 0 },
        { op: "add_machine", lineId: "line-3", name: "Seamer", archetype: "filler", position: 1 },
      ],
      { source: "requirement" },
    );
    expect(r.rejected).toEqual([]);
    expect(r.spec.lines.find((l) => l.id === "line-3")!.machines.map((m) => m.name)).toEqual(["Can filler", "Seamer"]);
  });
});
