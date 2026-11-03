import { logCameraView } from "@/domain/vision";
import { json, nowISO, parseBody, route } from "@/server/http";
import { CameraViewSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

/** Record that someone opened a live view (access accountability for workplace video). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { by } = await parseBody(req, CameraViewSchema);
  mutate((s) => logCameraView(s, id, by, nowISO()));
  return json({ ok: true, state: getState() });
});
