import { setLiveTelemetry } from "@/domain/commands";
import { json, nowISO, parseBody, route } from "@/server/http";
import { LiveSchema } from "@/server/schemas";
import { mutate } from "@/server/store";

export const POST = route(async (req: Request) => {
  const { enabled } = await parseBody(req, LiveSchema);
  return json(
    mutate((s) => {
      setLiveTelemetry(s, enabled, nowISO());
      return s;
    }),
  );
});
