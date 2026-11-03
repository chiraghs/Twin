import { json, route } from "@/server/http";
import { deleteFacility, getState } from "@/server/store";

export const dynamic = "force-dynamic";

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const ok = deleteFacility(id);
  if (!ok) {
    return json({ error: "Cannot delete the demo crisis facility." }, 400);
  }
  return json({ ok: true, activeState: getState() });
});
