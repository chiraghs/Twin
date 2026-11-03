import { cameraView } from "@/domain/quality";
import { json, route } from "@/server/http";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => {
  const s = getState();
  return json({ cameras: s.cameras.map((c) => ({ ...c, view: cameraView(s, c) })) });
});
