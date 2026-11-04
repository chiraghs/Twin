import { commitAnalysis, runAnalysisPipeline, type PipelineEvent } from "@/domain/agents/pipeline";
import type { FactoryState } from "@/domain/types";
import { generateNarrative } from "@/server/ai/provider";
import { json, ndjsonResponse, nowISO, route } from "@/server/http";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const g = globalThis as unknown as { __twinAnalysis?: { running: boolean } };
const lock = (g.__twinAnalysis ??= { running: false });

type AnalyzeEvent = PipelineEvent | { type: "committed"; state: unknown } | { type: "discarded"; reason: string };

/**
 * Runs the multi-agent investigation on a snapshot of the factory and streams every
 * intermediate result as NDJSON. The final bundle is committed to the live state.
 */
export const POST = route(async (req: Request) => {
  if (lock.running) return json({ error: "An analysis is already running" }, 409);
  const fast = new URL(req.url).searchParams.get("fast") === "1";
  const snapshot = structuredClone(getState());
  lock.running = true;
  return ndjsonResponse(analysis(snapshot, fast));
});

/** The pipeline's events, then the commit (skipped if the factory was reset meanwhile). Releases the lock when done. */
async function* analysis(snapshot: FactoryState, fast: boolean): AsyncGenerator<AnalyzeEvent> {
  try {
    const gen = runAnalysisPipeline(snapshot, {
      nowISO,
      pace: (ms) => (fast ? Promise.resolve() : new Promise((r) => setTimeout(r, ms))),
      narrate: generateNarrative,
    });
    let step = await gen.next();
    while (!step.done) {
      yield step.value;
      step = await gen.next();
    }
    const bundle = step.value;
    const live = getState();
    if (live.profile.id !== snapshot.profile.id || live.clock.tick < snapshot.clock.tick) {
      yield { type: "discarded", reason: "Factory was reset during analysis; results were not committed." };
    } else {
      mutate((s) => commitAnalysis(s, bundle, nowISO()));
      yield { type: "committed", state: getState() };
    }
  } finally {
    lock.running = false;
  }
}
