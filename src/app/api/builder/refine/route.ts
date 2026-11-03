import { z } from "zod";
import { refineSpec } from "@/domain/builder/pipeline";
import { builderAi } from "@/server/builder/ai";
import { json, parseBody, route } from "@/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z.object({ spec: z.unknown(), instruction: z.string().trim().min(2).max(2000) });

/** Chat refinement: the AI proposes edit operations; they are applied and validated in code. */
export const POST = route(async (req: Request) => {
  const { spec, instruction } = await parseBody(req, Body);
  const ai = builderAi();
  if (!ai.available) return json({ error: `Chat edits need an AI provider, which ${ai.model === null ? "is switched off or not configured" : "is unavailable"} on this server. You can still edit everything directly.` }, 503);
  const { validateSpec } = await import("@/domain/builder/validate");
  const v = validateSpec(spec);
  if (!v.spec) return json({ error: "The current spec is invalid", issues: v.issues.map((i) => `${i.path}: ${i.message}`) }, 400);
  try {
    return json(await refineSpec(v.spec, instruction, ai));
  } catch (e) {
    return json({ error: `The agent could not apply that: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` }, 502);
  }
});
