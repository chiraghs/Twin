import { describe, expect, it } from "vitest";
import { injectFault, fastForward } from "@/domain/commands";
import { compileSpec } from "@/domain/builder/compile";
import { applyOps } from "@/domain/builder/ops";
import type { TwinSpec } from "@/domain/builder/spec";
import { templateById } from "@/domain/builder/templates";
import { validateSpec } from "@/domain/builder/validate";
import { simulateScenarios } from "@/domain/simulation";
import { presetScenarios } from "@/domain/scenarios";
import { advanceFactory } from "@/domain/telemetry";
import type { Directive } from "@/domain/types";
import { ANCHOR, NOW } from "./helpers";

const smt = () => structuredClone(templateById("electronics-smt")!.spec);
const user = { source: "user" as const, note: null, refs: [] };
const compile = (spec: TwinSpec) => compileSpec(spec, ANCHOR, 7, NOW, "Test");
const withRules = (spec: TwinSpec, ops: Parameters<typeof applyOps>[1]) => {
  const r = applyOps(spec, ops, user);
  expect(r.rejected).toEqual([]);
  return r.spec;
};
const ruleDirectives = (ds: Directive[]) => ds.filter((d) => d.ruleId);

describe("playground edits", () => {
  it("places, connects, splits and deletes machines; rules that lose their target go with it", () => {
    const spec = smt();
    const [printer, pnp] = [spec.lines[0].machines[1], spec.lines[0].machines[2]];
    let r = applyOps(spec, [{ op: "place_machine", machineId: printer.id, x: 12.345, y: -4, rot: 95 }], user);
    expect(r.spec.lines[0].machines[1].pos).toEqual({ x: 12.35, y: -4, rot: 90 });

    // Split Line 1 after the printer, then join the pick-and-place back on.
    r = applyOps(r.spec, [{ op: "disconnect", machineId: printer.id }], user);
    expect(r.spec.lines.map((l) => l.machines.length)).toEqual([2, 3, 5, 3]);
    expect(r.spec.lines[1].name).toBe("SMT Line 1 (part 2)");
    r = applyOps(r.spec, [{ op: "connect", machineId: printer.id, targetId: pnp.id }], user);
    expect(r.spec.lines[0].machines.map((m) => m.id)).toEqual([spec.lines[0].machines[0].id, printer.id, pnp.id]);

    // Deleting a line removes the rules and connections that pointed at it.
    r = applyOps(
      smt(),
      [
        { op: "add_rule", ruleKind: "connector", lineId: "smt-1", when: "upstream-stops", action: "divert", toLineId: "smt-2" },
        { op: "add_rule", ruleKind: "maintenance", machineId: "smt-2-m3", metric: "health", threshold: 60 },
        { op: "add_rule", ruleKind: "inventory", materialId: "pcb-blank" },
      ],
      user,
    );
    expect(r.spec.rules.map((x) => x.kind)).toEqual(["connector", "maintenance", "inventory"]);
    r = applyOps(r.spec, [{ op: "remove_line", lineId: "smt-2" }], user);
    expect(r.spec.rules.map((x) => x.kind)).toEqual(["inventory"]);
    expect(applyOps(r.spec, [{ op: "add_rule", ruleKind: "teleport" as never }], user).rejected[0]).toMatch(/Invalid operation/);
  });

  it("validation drops rules that can't work and explains why", () => {
    const spec = smt();
    spec.rules = [
      { id: "a", name: "Divert to packing", kind: "connector", enabled: true, lineId: "smt-1", when: "upstream-stops", action: "divert", toLineId: "test-pack", speedPct: null, bufferUnits: null, prov: user },
      { id: "b", name: "Unknown stock", kind: "inventory", enabled: true, materialId: "unobtainium", below: null, orderQty: null, prov: user },
      { id: "c", name: "Slow when packing stops", kind: "connector", enabled: true, lineId: "smt-1", when: "downstream-stops", action: "slow", toLineId: null, speedPct: null, bufferUnits: null, prov: user },
    ];
    const v = validateSpec(spec);
    expect(v.ok).toBe(true);
    expect(v.spec!.rules.map((r) => r.id)).toEqual(["c"]);
    expect(v.spec!.rules[0]).toMatchObject({ speedPct: 60 });
    expect(v.issues.filter((i) => i.path.startsWith("rules.")).map((i) => i.message)).toEqual([
      'Rule "Divert to packing" removed: only process lines can take over each other\'s work.',
      'Rule "Unknown stock" removed: material "unobtainium" doesn\'t exist.',
    ]);
  });
});

describe("automation rules in the plant model", () => {
  it("inventory: orders whole lots once stock plus open orders falls below the trigger", () => {
    const spec = withRules(smt(), [{ op: "add_rule", ruleKind: "inventory", materialId: "pcb-blank", below: 1_000_000, orderQty: 5000 }]);
    const s = compile(spec);
    const item = s.inventory.find((i) => i.name === "PCB blank")!;
    const position = item.onHand + item.inbound.reduce((a, x) => a + x.qty, 0);
    const hour = s.clock.hour;
    advanceFactory(s, 0.25, { nowISO: NOW });
    const po = s.inventory.find((i) => i.id === item.id)!.inbound.find((x) => x.poId === "PO-R1")!;
    expect(po.qty).toBe(5000 * Math.ceil((1_000_000 - position) / 5000));
    // Ordered on the first step of the quarter hour; arrives one lead time later.
    expect(po.etaHour).toBeGreaterThan(hour + item.leadTimeHours);
    expect(po.etaHour).toBeLessThanOrEqual(hour + 0.25 + item.leadTimeHours);
    // One order covers the gap, so the next steps don't order again.
    advanceFactory(s, 1, { nowISO: NOW });
    expect(s.inventory.find((i) => i.id === item.id)!.inbound.filter((x) => x.poId.startsWith("PO-R"))).toHaveLength(1);
    expect(s.audit.some((a) => a.actor === "Automation rule" && /ordered .* PCB blank \(PO-R1/.test(a.title))).toBe(true);
  });

  it("connector: when a line stops, the other line takes over its work and hands it back after the repair", () => {
    const spec = withRules(smt(), [{ op: "add_rule", ruleKind: "connector", lineId: "smt-1", when: "upstream-stops", action: "divert", toLineId: "smt-2" }]);
    spec.options.linesInterchangeable = true;
    const s = compile(spec);
    const own = { ...s.lines[1].allocation };
    injectFault(s, { assetId: s.lines[0].assetIds[2], mode: "failure", severity: 100 }, NOW);
    advanceFactory(s, 0.5, { nowISO: NOW });
    const [d] = ruleDirectives(s.directives);
    expect(d).toMatchObject({ kind: "allocation", lineId: "LINE-B", status: "active" });
    expect(Object.keys(s.lines[1].allocation).sort()).toEqual(Object.keys({ ...own, ...s.lines[0].allocation }).sort());
    advanceFactory(s, s.costModel.unplannedRepairHours + 1, { nowISO: NOW });
    expect(s.directives.find((x) => x.id === d.id)!.status).toBe("completed");
    expect(s.lines[1].allocation).toEqual(own);
    expect(s.audit.some((a) => /condition cleared; lines return to their own work/.test(a.title))).toBe(true);
  });

  it("connector: pauses a line while the buffer before packing is full, then resumes it", () => {
    const spec = withRules(smt(), [{ op: "add_rule", ruleKind: "connector", lineId: "smt-1", when: "buffer-full", action: "pause", bufferUnits: 40 }]);
    const s = compile(spec);
    injectFault(s, { assetId: s.lines[2].assetIds[0], mode: "failure", severity: 100 }, NOW);
    let paused = false;
    for (let i = 0; i < 12 && !paused; i++) {
      advanceFactory(s, 0.25, { nowISO: NOW });
      paused = s.lines[0].state === "idle";
    }
    expect(paused).toBe(true);
    expect(s.assets.filter((a) => a.lineId === "LINE-A").every((a) => a.speedPct === 0)).toBe(true);
    // Line B has no rule and keeps running.
    expect(s.lines[1].state).not.toBe("idle");
    // Line B filled the buffer while packing was down; Line A resumes once it drains to 80% of the limit.
    for (let i = 0; i < 40 && s.lines[0].state === "idle"; i++) advanceFactory(s, 1, { nowISO: NOW });
    expect(s.lines[2].state).not.toBe("down");
    expect(Object.values(s.lines[2].buffer).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(32 + 1e-6);
    expect(s.assets.filter((a) => a.lineId === "LINE-A").every((a) => a.speedPct === 100)).toBe(true);
    expect(ruleDirectives(s.directives).every((d) => d.status === "completed" || d.status === "cancelled")).toBe(true);
  });

  it("maintenance: proposes preventive maintenance once per crossing; a person still approves it", () => {
    const spec = smt();
    const s0 = compile(spec);
    const robot = s0.assets.find((a) => a.lineId === "LINE-A" && a.kind === "robot")!;
    const machineId = spec.lines[0].machines[2].id;
    const s = compile(withRules(spec, [{ op: "add_rule", ruleKind: "maintenance", machineId, metric: "vibration", threshold: robot.baseline.vibration + 0.5 }]));
    injectFault(s, { assetId: robot.id, mode: "bearing-wear", severity: 60 }, NOW);
    fastForward(s, 1, NOW);
    const recs = s.recommendations.filter((r) => r.source === "rule");
    expect(recs).toHaveLength(1);
    expect(recs[0].status).toBe("pending");
    expect(recs[0].affectedAssetIds[0]).toBe(robot.id);
    expect(s.directives.some((d) => d.kind === "maintenance" && d.assetId === robot.id)).toBe(false);
    fastForward(s, 1, NOW);
    expect(s.recommendations.filter((r) => r.source === "rule")).toHaveLength(1);
  });

  it("What-If simulations run the same rules", () => {
    const spec = withRules(smt(), [{ op: "add_rule", ruleKind: "inventory", materialId: "component-kit", below: 1_000_000, orderQty: 1000 }]);
    const s = compile(spec);
    const results = simulateScenarios(s, presetScenarios(s, s.assets[2].id));
    expect(results.every((r) => r.feasible || r.infeasibleReason)).toBe(true);
    // The live plant is untouched by the simulation.
    expect(s.ruleRuntime).toEqual({ seq: 0, rules: {} });
  });
});
