import { z } from "zod";
import { runExperiment } from "@/domain/experiments";
import type { ScenarioDefinition } from "@/domain/types";
import { json, parseBody, route } from "@/server/http";
import { ScenarioDefinitionSchema } from "@/server/schemas";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

const Schema = z.object({
  targetAssetId: z.string().min(1).optional(),
  definitions: z.array(ScenarioDefinitionSchema).min(1).max(8).optional(),
  replications: z.number().int().min(3).max(60).default(20),
  seed: z.number().int().min(0).max(2 ** 31).default(7),
  spread: z.number().min(0).max(0.5).default(0.2),
});

/** Run every plan many times with the uncertain inputs varied (read-only; nothing is stored). */
export const POST = route(async (req: Request) => {
  const body = await parseBody(req, Schema);
  return json(runExperiment(getState(), { ...body, definitions: body.definitions as ScenarioDefinition[] | undefined }));
});
