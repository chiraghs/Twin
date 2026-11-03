import { z } from "zod";
import { validateSpec } from "@/domain/builder/validate";
import { json, parseBody, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Deterministic validation and normalisation of a spec (no AI). */
export const POST = route(async (req: Request) => {
  const { spec } = await parseBody(req, z.object({ spec: z.unknown() }));
  return json(validateSpec(spec));
});
