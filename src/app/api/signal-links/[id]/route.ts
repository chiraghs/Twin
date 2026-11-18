import { DomainError } from "@/domain/errors";
import { json, route } from "@/server/http";
import { deleteLink } from "@/server/db/signal-links";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Remove a signal link. */
export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!deleteLink(getState().profile.id, id)) throw new DomainError(`Link ${id} not found`, 404);
  return json({ deleted: id });
});
