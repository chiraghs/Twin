import { z } from "zod";
import { acknowledgeIncident } from "@/domain/commands";
import { json, nowISO, parseBody, route } from "@/server/http";
import { mutate } from "@/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const Schema = z.object({ by: z.string().trim().min(1).max(60).default("Operator") });

/** Acknowledge an open incident (audited). Returns the updated twin. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { by } = await parseBody(req, Schema);
  const at = nowISO();
  const state = mutate((s) => {
    acknowledgeIncident(s, id, by, at);
    return s;
  });
  return json({ state });
});
