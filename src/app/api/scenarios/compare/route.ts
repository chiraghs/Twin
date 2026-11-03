import { pickFocusAsset, presetScenarios } from "@/domain/scenarios";
import { rankScenarios, simulateScenarios } from "@/domain/simulation";
import type { ScenarioDefinition } from "@/domain/types";
import { json, parseBody, route } from "@/server/http";
import { ScenarioRunSchema } from "@/server/schemas";
import { getState } from "@/server/store";

/** Stateless comparison — nothing is persisted. */
export const POST = route(async (req: Request) => {
  const body = await parseBody(req, ScenarioRunSchema);
  const s = getState();
  const target = body.targetAssetId ?? body.definitions?.[0]?.params.targetAssetId ?? pickFocusAsset(s).id;
  const defs = (body.definitions as ScenarioDefinition[] | undefined) ?? presetScenarios(s, target);
  const results = simulateScenarios(s, defs);
  return json({ results, ranking: rankScenarios(results) });
});
