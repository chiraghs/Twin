import { buildFactory, defaultAnchor, newFactorySeed } from "@/domain/seed";
import { json, nowISO, parseBody, route } from "@/server/http";
import { BlueprintSchema } from "@/server/schemas";
import { getState, replaceState } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => json(getState()));

export const POST = route(async (req: Request) => {
  const bp = await parseBody(req, BlueprintSchema);
  const state = buildFactory({ ...bp, isDemo: false }, defaultAnchor(), newFactorySeed());
  state.audit[0] = { ...state.audit[0], at: nowISO() };
  return json(replaceState(state), 201);
});
