import { describe, expect, it } from "vitest";
import { compileSpec } from "@/domain/builder/compile";
import { specFromDraft, type Draft } from "@/domain/builder/draft";
import { applyOps } from "@/domain/builder/ops";
import { runBuilder, type BuilderAi, type BuilderEvent, type BuilderInput } from "@/domain/builder/pipeline";
import { robotsFromRequirements } from "@/domain/builder/robots";
import type { TwinSpec } from "@/domain/builder/spec";
import { templateById } from "@/domain/builder/templates";
import { validateSpec } from "@/domain/builder/validate";
import { amrFleet } from "@/domain/intralogistics";
import { advanceFactory } from "@/domain/telemetry";
import { ANCHOR, demo, NOW } from "./helpers";

const bottling = () => structuredClone(templateById("beverage-bottling")!.spec);
const user = { source: "user" as const, note: null, refs: [] };
const compile = (spec: TwinSpec) => compileSpec(spec, ANCHOR, 7, NOW, "Test");

async function run(input: Partial<BuilderInput>, ai: BuilderAi) {
  const events: BuilderEvent[] = [];
  for await (const e of runBuilder({ requirements: "", site: {}, templateId: null, blueprint: null, research: false, ...input }, ai)) events.push(e);
  return (events.find((e) => e.type === "complete") as Extract<BuilderEvent, { type: "complete" }>).spec;
}
const unavailable = async () => {
  throw new Error("unavailable");
};
const noAi: BuilderAi = { available: false, model: null, readBlueprint: unavailable, research: unavailable, draft: unavailable, refine: unavailable };

describe("mobile robots in the Twin Builder", () => {
  it("reads robot fleets from free-text requirements: type, count, move and line", () => {
    const spec = bottling();
    const fleets = robotsFromRequirements(
      "We bottle water. 3 AMRs bring preforms and caps from the warehouse to Line 1. Two AGVs carry pallets to the shipping dock; an automated forklift loads the trucks.",
      spec,
    );
    expect(fleets.map((f) => [f.robotType, f.count, f.mission])).toEqual([
      ["amr", 3, "kitting"],
      ["agv", 2, "finished-goods"],
      ["forklift-agv", 1, "finished-goods"],
    ]);
    expect(fleets[0].lineId).toBe(spec.lines.find((l) => l.role === "process")!.id);
    expect(fleets.every((f) => f.prov.source === "requirement" && /Read from your requirements/.test(f.prov.note ?? ""))).toBe(true);
    expect(robotsFromRequirements("A PET bottling line with a case packer.", spec)).toEqual([]);
  });

  it("adds, edits and removes fleets through the same operations as chat edits", () => {
    const spec = bottling();
    const line = spec.lines.find((l) => l.role === "process")!;
    let r = applyOps(spec, [{ op: "add_robot_fleet", mission: "kitting", robotType: "amr", lineId: line.id, count: 2 }], user);
    expect(r.rejected).toEqual([]);
    const fleet = r.spec.mobileRobots[0];
    expect(fleet).toMatchObject({ robotType: "amr", mission: "kitting", lineId: line.id, count: 2 });
    r = applyOps(r.spec, [{ op: "update_robot_fleet", fleetId: fleet.id, count: 4, robotType: "tugger" }, { op: "add_robot_fleet", mission: "teleport" }], user);
    expect(r.spec.mobileRobots[0]).toMatchObject({ count: 4, robotType: "tugger" });
    expect(r.rejected[0]).toMatch(/not a supported move/);
    r = applyOps(r.spec, [{ op: "remove_robot_fleet", fleetId: fleet.id }], user);
    expect(r.spec.mobileRobots).toEqual([]);
  });

  it("validation points each fleet at a line that suits its move", () => {
    const spec = bottling();
    const packing = spec.lines.find((l) => l.role === "packing")!;
    const process = spec.lines.find((l) => l.role === "process")!;
    spec.mobileRobots = [
      { id: "k", name: "Kitting AMRs", robotType: "amr", mission: "kitting", lineId: packing.id, count: 2, unitsPerTrip: null, speedMps: null, trigger: { kind: "output" as const, everyMinutes: null }, route: [], prov: user },
      { id: "fg", name: "Pallet AGVs", robotType: "agv", mission: "finished-goods", lineId: process.id, count: 1, unitsPerTrip: null, speedMps: null, trigger: { kind: "output" as const, everyMinutes: null }, route: [], prov: user },
    ];
    const v = validateSpec(spec);
    expect(v.ok).toBe(true);
    expect(v.spec!.mobileRobots.find((f) => f.id === "k")!.lineId).toBe(process.id);
    expect(v.spec!.mobileRobots.find((f) => f.id === "fg")!.lineId).toBe(packing.id);
    // A transfer to packing needs a packing line.
    const noPacking = bottling();
    noPacking.lines = noPacking.lines.filter((l) => l.role === "process");
    noPacking.mobileRobots = [{ id: "t", name: "Transfer AMRs", robotType: "amr", mission: "line-transfer", lineId: null, count: 1, unitsPerTrip: null, speedMps: null, trigger: { kind: "output" as const, everyMinutes: null }, route: [], prov: user }];
    const v2 = validateSpec(noPacking);
    expect(v2.spec!.mobileRobots).toEqual([]);
    expect(v2.issues.some((i) => /needs a packing line/.test(i.message))).toBe(true);
    // Too many robots is an error the person must fix.
    const many = bottling();
    many.mobileRobots = [1, 2, 3].map((i) => ({ id: `f${i}`, name: `Fleet ${i}`, robotType: "amr" as const, mission: "kitting" as const, lineId: process.id, count: 12, unitsPerTrip: null, speedMps: null, trigger: { kind: "output" as const, everyMinutes: null }, route: [], prov: user }));
    expect(validateSpec(many).ok).toBe(false);
  });

  it("builds exactly the requested robots into the twin; their trips follow line output", () => {
    const spec = bottling();
    const process = spec.lines.find((l) => l.role === "process")!;
    spec.mobileRobots = [
      { id: "k", name: "Kitting AMRs", robotType: "amr", mission: "kitting", lineId: process.id, count: 3, unitsPerTrip: 50, speedMps: null, trigger: { kind: "output" as const, everyMinutes: null }, route: [], prov: user },
      { id: "fg", name: "Pallet forklift", robotType: "forklift-agv", mission: "finished-goods", lineId: null, count: 1, unitsPerTrip: null, speedMps: 1.4, trigger: { kind: "output" as const, everyMinutes: null }, route: [], prov: user },
    ];
    const s = compile(spec);
    expect(s.mobileRobots!.map((r) => r.id)).toEqual(["AMR-A1", "AMR-A2", "AMR-A3", "AGF-B1"]);
    expect(s.audit[0].detail).toMatch(/4 mobile robot/);
    advanceFactory(s, 2, { nowISO: NOW });
    const fleet = amrFleet(s);
    expect(fleet).toHaveLength(4);
    const kit = fleet.filter((a) => a.fleetId === "k");
    const rate = kit[0].lineRate;
    expect(rate).toBeGreaterThan(0);
    // Three robots share the line's kitting trips.
    expect(kit[0].tripsPerHour).toBeCloseTo(rate / 50 / 3, 1);
    expect(fleet.find((a) => a.id === "AGF-B1")).toMatchObject({ robotType: "forklift-agv", speedMps: 1.4, unitsPerTrip: 120, configured: true });
  });

  it("a twin built without robots has none; the demo plant keeps its derived fleet", () => {
    const s = compile(bottling());
    expect(s.mobileRobots).toBeUndefined();
    expect(amrFleet(s)).toEqual([]);
    expect(amrFleet(demo()).length).toBeGreaterThan(0);
  });

  it("template mode reads robots from the requirements and says how", async () => {
    const spec = await run({ requirements: "PET bottling. We run 2 AMRs for kitting on Line 1 and an AGV to the dock." }, noAi);
    expect(spec!.mobileRobots.map((f) => [f.robotType, f.count, f.mission])).toEqual([
      ["amr", 2, "kitting"],
      ["agv", 1, "finished-goods"],
    ]);
    expect(spec!.assumptions[0]).toMatch(/mobile robot fleet\(s\) were read from your requirements/);
  });

  it("maps robots from an AI draft, and never silently drops robots the owner asked for", async () => {
    const tpl = bottling();
    const draft: Draft = {
      site: { name: "Riverside", industry: "Beverage", location: "", productionType: "PET bottling" },
      lines: tpl.lines.map((l) => ({ name: l.name, role: l.role, products: l.role === "process" ? ["Water"] : [], source: "requirement", note: null, machines: l.machines.map((m) => ({ name: m.name, archetype: m.archetype, ratePerHour: null, source: "requirement", note: null, refs: [], blueprintElement: null })) })),
      products: [{ name: "Water", unit: "bottles", ratePerHour: null, unitPrice: null, unitMaterialCost: null, source: "requirement", note: null, refs: [], materials: [] }],
      materials: [],
      integrations: [],
      mobileRobots: [
        { name: "Kitting AMRs", robotType: "amr", mission: "kitting", line: tpl.lines[0].name, count: 4, unitsPerTrip: null, source: "requirement", note: null },
        { name: "Drones", robotType: "drone", mission: "inventory-scan", line: null, count: 2, unitsPerTrip: null, source: "requirement", note: null },
      ],
      assumptions: [],
      questions: [],
    };
    const spec = specFromDraft(draft, { reading: null, references: [], blueprintFile: null, userSite: {} });
    expect(spec.mobileRobots).toHaveLength(1);
    expect(spec.mobileRobots[0]).toMatchObject({ count: 4, mission: "kitting", lineId: spec.lines[0].id });
    expect(spec.assumptions.some((a) => /inventory-scan.*not model/.test(a))).toBe(true);

    // The model forgot the robots: they are added from the requirements, and the spec says so.
    const forgetful: BuilderAi = { ...noAi, available: true, model: "fake", draft: async () => ({ ...structuredClone(draft), mobileRobots: [] }) };
    const out = await run({ requirements: "Bottling plant with 2 AMRs feeding caps to the filler line." }, forgetful);
    expect(out!.mobileRobots).toHaveLength(1);
    expect(out!.mobileRobots[0].count).toBe(2);
    expect(out!.assumptions.some((a) => /left out the mobile robots/.test(a))).toBe(true);
  });

  it("skips web research, with the reason, when the AI provider has no web search", async () => {
    const tpl = bottling();
    const draft: Draft = {
      site: { name: "Plant", industry: "Beverage", location: "", productionType: "" },
      lines: tpl.lines.map((l) => ({ name: l.name, role: l.role, products: l.role === "process" ? ["Water"] : [], source: "requirement", note: null, machines: l.machines.map((m) => ({ name: m.name, archetype: m.archetype, ratePerHour: null, source: "requirement", note: null, refs: [], blueprintElement: null })) })),
      products: [{ name: "Water", unit: "bottles", ratePerHour: null, unitPrice: null, unitMaterialCost: null, source: "requirement", note: null, refs: [], materials: [] }],
      materials: [],
      integrations: [],
      assumptions: [],
      questions: [],
    };
    const local: BuilderAi = { ...noAi, available: true, model: "llama3.3 via localhost:11434", researchUnavailable: "Web research needs a provider with web search.", draft: async () => structuredClone(draft) };
    const events: BuilderEvent[] = [];
    for await (const e of runBuilder({ requirements: "Bottling", site: {}, templateId: null, blueprint: null, research: true }, local)) events.push(e);
    const research = events.find((e): e is Extract<BuilderEvent, { type: "stage" }> => e.type === "stage" && e.stage === "research" && e.status !== "running")!;
    expect(research).toMatchObject({ status: "skipped", summary: "Web research needs a provider with web search." });
  });
});
