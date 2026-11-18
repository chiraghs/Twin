import { z } from "zod";
import { json, nowISO, parseBody, route } from "@/server/http";
import { listViews, saveView } from "@/server/db/views";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

/** Saved 3D viewpoints and virtual cameras of the active twin. */
export const GET = route(async () => {
  const id = getState().profile.id;
  return json({ facilityId: id, views: listViews(id) });
});

const Vec = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const SaveSchema = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(["view", "camera"]).default("view"),
  position: Vec,
  target: Vec,
  by: z.string().trim().min(1).max(60).default("Operator"),
});

/** Save the current 3D viewpoint as a view (bookmark) or a virtual camera (live feed on the wall). */
export const POST = route(async (req: Request) => {
  const { by, ...input } = await parseBody(req, SaveSchema);
  return json({ view: saveView(getState().profile.id, input, by, nowISO()) }, 201);
});
