import { fastForward } from "@/domain/commands";
import { json, nowISO, parseBody, route } from "@/server/http";
import { AdvanceSchema } from "@/server/schemas";
import { mutate } from "@/server/store";

export const POST = route(async (req: Request) => {
  const { hours } = await parseBody(req, AdvanceSchema);
  return json(
    mutate((s) => {
      fastForward(s, hours, nowISO());
      return s;
    }),
  );
});
