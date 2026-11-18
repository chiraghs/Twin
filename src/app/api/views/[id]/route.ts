import { DomainError } from "@/domain/errors";
import { json, route } from "@/server/http";
import { deleteView } from "@/server/db/views";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Delete a saved view or virtual camera. */
export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!deleteView(getState().profile.id, id)) throw new DomainError(`View ${id} not found`, 404);
  return json({ deleted: id });
});
