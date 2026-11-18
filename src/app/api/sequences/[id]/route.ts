import { DomainError } from "@/domain/errors";
import { json, route } from "@/server/http";
import { deleteSequence } from "@/server/db/sequences";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Delete a sequence. */
export const DELETE = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!deleteSequence(getState().profile.id, id)) throw new DomainError(`Sequence ${id} not found`, 404);
  return json({ deleted: id });
});
