import { connectNodes } from "@/domain/commands";
import { json, nowISO, parseBody, route } from "@/server/http";
import { ConnectionSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

export const POST = route(async (req: Request) => {
  const { source, target } = await parseBody(req, ConnectionSchema);
  const connection = mutate((s) => connectNodes(s, source, target, nowISO()));
  return json({ connection, state: getState() }, 201);
});
