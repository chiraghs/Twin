import { z } from "zod";
import { assetSignals } from "./live";
import type { FactoryState } from "./types";

/**
 * Commissioning sequences: ordered steps that drive the twin, e.g. a line start-up
 * ("start the infeed, wait until it runs, then start press and robot together, wait for
 * throughput"). Steps run one after another; a parallel step runs its branches at the same time
 * and finishes when all of them have. Commands act on the twin only, through the same audited
 * actions as the commissioning page.
 */

export type SeqCommand = "start" | "stop" | "speed";
export type SeqOp = ">" | ">=" | "<" | "<=" | "=";

export type SeqStep =
  | { id: string; kind: "command"; assetId: string; command: SeqCommand; value?: number }
  | { id: string; kind: "wait"; signalId: string; op: SeqOp; value: number | boolean; timeoutS: number }
  | { id: string; kind: "delay"; seconds: number }
  | { id: string; kind: "parallel"; branches: SeqStep[][] };

export interface Sequence {
  id: string;
  facilityId: string;
  name: string;
  steps: SeqStep[];
  updatedAt: string;
  updatedBy: string;
}

const Id = z.string().min(1).max(40);
const Leaf = z.discriminatedUnion("kind", [
  z.object({ id: Id, kind: z.literal("command"), assetId: z.string().min(1).max(40), command: z.enum(["start", "stop", "speed"]), value: z.number().min(30).max(110).optional() }),
  z.object({ id: Id, kind: z.literal("wait"), signalId: z.string().min(3).max(80), op: z.enum([">", ">=", "<", "<=", "="]), value: z.union([z.number().finite(), z.boolean()]), timeoutS: z.number().min(1).max(3600) }),
  z.object({ id: Id, kind: z.literal("delay"), seconds: z.number().min(0).max(3600) }),
]);
/** One level of parallel branches (branches hold plain steps), up to 4 branches of 20 steps. */
export const SeqStepSchema = z.union([Leaf, z.object({ id: Id, kind: z.literal("parallel"), branches: z.array(z.array(Leaf).max(20)).min(2).max(4) })]);
export const StepsSchema = z.array(SeqStepSchema).max(40);

/** Check that every machine and signal a sequence uses exists in this twin. */
export function validateSequence(state: FactoryState, steps: SeqStep[]): string[] {
  const problems: string[] = [];
  const signalIds = new Set(state.assets.flatMap((a) => assetSignals(state, a).map((s) => s.id)));
  const assetIds = new Set(state.assets.map((a) => a.id));
  const visit = (s: SeqStep) => {
    if (s.kind === "command" && !assetIds.has(s.assetId)) problems.push(`Step ${s.id}: unknown machine ${s.assetId}`);
    if (s.kind === "command" && s.command === "speed" && s.value === undefined) problems.push(`Step ${s.id}: set a speed`);
    if (s.kind === "wait" && !signalIds.has(s.signalId)) problems.push(`Step ${s.id}: unknown signal ${s.signalId}`);
    if (s.kind === "parallel") s.branches.flat().forEach(visit);
  };
  steps.forEach(visit);
  return problems;
}

/** Current value of a twin signal (`<assetId>.<Signal>`), or undefined if it doesn't exist. */
export function signalValue(state: FactoryState, signalId: string): number | boolean | undefined {
  const asset = state.assets.find((a) => signalId.startsWith(`${a.id}.`));
  return asset ? assetSignals(state, asset).find((s) => s.id === signalId)?.value : undefined;
}

export function conditionHolds(v: number | boolean | undefined, op: SeqOp, target: number | boolean): boolean {
  if (v === undefined) return false;
  if (typeof v === "boolean" || typeof target === "boolean") return op === "=" && Boolean(v) === Boolean(target);
  switch (op) {
    case ">":
      return v > target;
    case ">=":
      return v >= target;
    case "<":
      return v < target;
    case "<=":
      return v <= target;
    default:
      return Math.abs(v - target) < 1e-6;
  }
}

export function describeStep(s: SeqStep): string {
  if (s.kind === "command") return s.command === "speed" ? `Set ${s.assetId} speed to ${s.value}%` : `${s.command === "start" ? "Start" : "Stop"} ${s.assetId}`;
  if (s.kind === "wait") return `Wait until ${s.signalId} ${s.op} ${String(s.value)} (timeout ${s.timeoutS} s)`;
  if (s.kind === "delay") return `Wait ${s.seconds} s`;
  return `In parallel: ${s.branches.map((b) => b.map(describeStep).join(", then ") || "nothing").join(" | ")}`;
}

/* ─────────────────────────── runner ─────────────────────────── */

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface RunnerDeps {
  getState: () => FactoryState;
  command: (assetId: string, command: SeqCommand, value?: number) => Promise<void>;
  /** Resolve after `ms` (or earlier when aborted). */
  sleep: (ms: number) => Promise<void>;
  onStatus: (stepId: string, status: StepStatus, note?: string) => void;
  signal?: AbortSignal;
  /** How often waits re-check the signal. */
  pollMs?: number;
  /** Clock for timeouts (ms); defaults to Date.now. */
  now?: () => number;
}

export class SequenceError extends Error {}

/** Run steps one after another; parallel steps run their branches concurrently. Throws on the first failure. */
export async function runSequence(steps: SeqStep[], deps: RunnerDeps): Promise<void> {
  const now = deps.now ?? Date.now;
  const poll = deps.pollMs ?? 500;
  const aborted = () => deps.signal?.aborted ?? false;

  const runStep = async (s: SeqStep): Promise<void> => {
    if (aborted()) throw new SequenceError("Stopped");
    deps.onStatus(s.id, "running");
    try {
      if (s.kind === "command") await deps.command(s.assetId, s.command, s.value);
      else if (s.kind === "delay") await deps.sleep(s.seconds * 1000);
      else if (s.kind === "wait") {
        const until = now() + s.timeoutS * 1000;
        while (!conditionHolds(signalValue(deps.getState(), s.signalId), s.op, s.value)) {
          if (aborted()) throw new SequenceError("Stopped");
          if (now() >= until) throw new SequenceError(`Timed out after ${s.timeoutS} s waiting for ${s.signalId} ${s.op} ${String(s.value)}`);
          await deps.sleep(poll);
        }
      } else await Promise.all(s.branches.map((b) => runList(b)));
      if (aborted()) throw new SequenceError("Stopped");
      deps.onStatus(s.id, "done");
    } catch (e) {
      deps.onStatus(s.id, "failed", e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const runList = async (list: SeqStep[]) => {
    for (const s of list) await runStep(s);
  };
  await runList(steps);
}

/** Every step id in order (parallel branches flattened), for status tables. */
export function allStepIds(steps: SeqStep[]): string[] {
  return steps.flatMap((s) => (s.kind === "parallel" ? [s.id, ...s.branches.flat().map((b) => b.id)] : [s.id]));
}

/** A sensible first sequence for a line: start each machine in flow order, waiting for each to run. */
export function lineStartupTemplate(state: FactoryState, lineId: string): SeqStep[] {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return [];
  const steps: SeqStep[] = [];
  line.assetIds.forEach((id, i) => {
    steps.push({ id: `s${i * 2 + 1}`, kind: "command", assetId: id, command: "start" });
    steps.push({ id: `s${i * 2 + 2}`, kind: "wait", signalId: `${id}.Running`, op: "=", value: true, timeoutS: 30 });
  });
  return steps;
}
