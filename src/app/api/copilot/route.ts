import { z } from "zod";
import { copilotInfo, runCopilot } from "@/server/copilot/agent";
import { json, ndjsonResponse, parseBody, route } from "@/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = route(() => json(copilotInfo()));

const Body = z
  .object({
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    message: z.string().trim().min(1).max(2000).optional(),
    confirm: z.object({ callId: z.string().min(1).max(200), confirmed: z.boolean() }).optional(),
  })
  .refine((b) => !!b.message !== !!b.confirm, "Send either a message or a confirmation");

/** One copilot turn (multi-agent on Muse Spark), streamed as NDJSON: tool calls, results, confirmations, answer. */
export const POST = route(async (req: Request) => {
  const body = await parseBody(req, Body);
  return ndjsonResponse(runCopilot(body));
});
