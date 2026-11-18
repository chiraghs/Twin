import { json, route } from "@/server/http";
import { listModels } from "@/server/db/models";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

/** Machine types that have an uploaded 3D model in the active twin. */
export const GET = route(async () => {
  const id = getState().profile.id;
  return json({ facilityId: id, models: listModels(id) });
});
