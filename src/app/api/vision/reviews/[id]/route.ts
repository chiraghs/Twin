import { dispositionReview } from "@/domain/vision";
import { json, nowISO, parseBody, route } from "@/server/http";
import { DispositionSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

/** Human disposition of a visual review (confirm or dismiss the findings). */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { disposition, note, by } = await parseBody(req, DispositionSchema);
  const review = mutate((s) => dispositionReview(s, id, disposition, note, by, nowISO()));
  return json({ review, state: getState() });
});
