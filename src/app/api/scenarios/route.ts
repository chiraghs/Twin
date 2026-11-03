import { runOperatorScenarios } from "@/domain/scenarios";
import type { ScenarioDefinition } from "@/domain/types";
import { json, nowISO, parseBody, route } from "@/server/http";
import { mirrorScenarioRun } from "@/server/integrations/status";
import { ScenarioRunSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => json({ runs: getState().scenarioRuns }));

/** Run (and by default persist) a scenario comparison. Calculations are recomputed server-side. */
export const POST = route(async (req: Request) => {
  const body = await parseBody(req, ScenarioRunSchema);
  const at = nowISO();
  const run = mutate((s) => runOperatorScenarios(s, { ...body, definitions: body.definitions as ScenarioDefinition[] | undefined }, at));
  if (body.persist) void mirrorScenarioRun(run, getState().profile.id);
  return json({ run, state: getState() });
});
