import { describe, expect, it } from "vitest";
import { injectFault, updateAsset } from "@/domain/commands";
import { conditionHolds, describeStep, lineStartupTemplate, runSequence, StepsSchema, validateSequence, type SeqStep, type StepStatus } from "@/domain/sequences";
import type { FactoryState } from "@/domain/types";
import { crisis, NOW } from "./helpers";

function harness(s: FactoryState) {
  const log: string[] = [];
  const status: Record<string, StepStatus> = {};
  let clock = 0;
  return {
    log,
    status,
    deps: {
      getState: () => s,
      command: async (assetId: string, command: "start" | "stop" | "speed", value?: number) => {
        log.push(`${command}:${assetId}${value !== undefined ? `:${value}` : ""}`);
        if (command === "stop") injectFault(s, { assetId, mode: "failure", severity: 100 }, NOW);
        else if (command === "start") injectFault(s, { assetId, mode: "restore", severity: 0 }, NOW);
        else updateAsset(s, assetId, { speedPct: value }, NOW);
      },
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
      onStatus: (id: string, st: StepStatus) => {
        status[id] = st;
      },
      pollMs: 500,
    },
  };
}

describe("sequences", () => {
  it("validates steps against the twin", () => {
    const s = crisis();
    expect(validateSequence(s, lineStartupTemplate(s, s.lines[0].id))).toEqual([]);
    expect(validateSequence(s, [{ id: "x", kind: "wait", signalId: "NOPE.Running", op: "=", value: true, timeoutS: 5 }])[0]).toMatch(/unknown signal/);
    expect(StepsSchema.safeParse([{ id: "p", kind: "parallel", branches: [[{ id: "a", kind: "delay", seconds: 1 }]] }]).success).toBe(false);
  });

  it("runs serial and parallel steps, waits on signals and drives the twin", async () => {
    const s = crisis();
    const [a, b] = s.lines[0].assetIds;
    const h = harness(s);
    const steps: SeqStep[] = [
      { id: "s1", kind: "command", assetId: a, command: "stop" },
      { id: "s2", kind: "wait", signalId: `${a}.Running`, op: "=", value: false, timeoutS: 5 },
      { id: "p", kind: "parallel", branches: [[{ id: "b1", kind: "command", assetId: a, command: "start" }], [{ id: "c1", kind: "delay", seconds: 2 }, { id: "c2", kind: "command", assetId: b, command: "speed", value: 80 }]] },
      { id: "s3", kind: "wait", signalId: `${a}.Running`, op: "=", value: true, timeoutS: 5 },
    ];
    await runSequence(steps, h.deps);
    expect(h.log).toEqual([`stop:${a}`, `start:${a}`, `speed:${b}:80`]);
    expect(Object.values(h.status).every((x) => x === "done")).toBe(true);
    expect(s.assets.find((x) => x.id === b)!.speedPct).toBe(80);
    expect(describeStep(steps[2])).toMatch(/In parallel/);
  });

  it("fails a wait that times out and stops there", async () => {
    const s = crisis();
    const a = s.lines[0].assetIds[0];
    const h = harness(s);
    const steps: SeqStep[] = [
      { id: "w", kind: "wait", signalId: `${a}.Running`, op: "=", value: false, timeoutS: 3 },
      { id: "after", kind: "command", assetId: a, command: "stop" },
    ];
    await expect(runSequence(steps, h.deps)).rejects.toThrow(/Timed out after 3 s/);
    expect(h.status.w).toBe("failed");
    expect(h.status.after).toBeUndefined();
    expect(h.log).toEqual([]);
  });

  it("compares values", () => {
    expect(conditionHolds(5, ">", 4)).toBe(true);
    expect(conditionHolds(5, "<=", 4)).toBe(false);
    expect(conditionHolds(true, "=", true)).toBe(true);
    expect(conditionHolds(undefined, "=", true)).toBe(false);
  });
});
