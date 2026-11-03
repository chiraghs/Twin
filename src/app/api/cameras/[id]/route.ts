import { setCameraStream } from "@/domain/vision";
import { adminActor, requireAdmin } from "@/server/admin";
import { json, nowISO, parseBody, route } from "@/server/http";
import { CameraStreamSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

/** Choose a camera's source: the twin feed, a reference footage clip, or an HLS / MP4 / MJPEG gateway (admin). */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  requireAdmin(req);
  const { id } = await params;
  const { kind, url, clipId, by } = await parseBody(req, CameraStreamSchema);
  const camera = mutate((s) => setCameraStream(s, id, { kind, url, clipId }, adminActor(by), nowISO()));
  return json({ camera, state: getState() });
});
