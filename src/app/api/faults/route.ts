import { injectFault } from "@/domain/commands";
import { json, nowISO, parseBody, route } from "@/server/http";
import { FaultSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

export const POST = route(async (req: Request) => {
  const input = await parseBody(req, FaultSchema);
  mutate((s) => injectFault(s, input, nowISO()));
  return json(getState());
});
