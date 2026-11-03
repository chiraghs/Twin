import { rollbackRecommendation } from "@/domain/actions";
import { json, nowISO, parseBody, route } from "@/server/http";
import { mirrorDecision } from "@/server/integrations/status";
import { DecisionSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { by } = await parseBody(req, DecisionSchema);
  const recommendation = mutate((s) => rollbackRecommendation(s, id, by, nowISO()));
  void mirrorDecision(recommendation, getState().profile.id);
  return json({ recommendation, state: getState() });
});
