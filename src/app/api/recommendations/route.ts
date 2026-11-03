import { createRecommendationFromRun } from "@/domain/recommendations";
import { json, nowISO, parseBody, route } from "@/server/http";
import { CreateRecommendationSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => json({ recommendations: getState().recommendations }));

/** Operator-initiated recommendation from a stored scenario run. */
export const POST = route(async (req: Request) => {
  const { scenarioRunId, scenarioId } = await parseBody(req, CreateRecommendationSchema);
  const at = nowISO();
  const rec = mutate((s) => createRecommendationFromRun(s, scenarioRunId, scenarioId, at));
  return json({ recommendation: rec, state: getState() }, 201);
});
