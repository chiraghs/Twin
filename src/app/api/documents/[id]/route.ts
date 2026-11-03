import { DomainError } from "@/domain/errors";
import { json, route } from "@/server/http";
import { readLocalDocument } from "@/server/documents";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const doc = readLocalDocument(id);
  if (!doc) throw new DomainError(`Document ${id} not found`, 404);
  return json(doc);
});
