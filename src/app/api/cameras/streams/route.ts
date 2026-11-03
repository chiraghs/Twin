import { setCameraStreams } from "@/domain/vision";
import { adminActor, requireAdmin } from "@/server/admin";
import { json, nowISO, parseBody, route } from "@/server/http";
import { CameraStreamsSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

/** Switch several cameras at once (CCTV control room). All-or-nothing: nothing changes if any entry is invalid. */
export const POST = route(async (req: Request) => {
  requireAdmin(req);
  const { streams, by } = await parseBody(req, CameraStreamsSchema);
  const actor = adminActor(by);
  const at = nowISO();
  mutate((s) => setCameraStreams(s, streams, actor, at));
  return json({ state: getState() });
});
