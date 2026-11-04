import { dispositionReview } from "@/domain/vision";
import { json, nowISO, parseBody, route } from "@/server/http";
import { backendFetch } from "@/server/intelligence";
import { DispositionSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

/** Human disposition of a visual review (confirm or dismiss the findings). AOI reviews also update the backend's detector precision. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const { disposition, note, by } = await parseBody(req, DispositionSchema);
  const review = mutate((s) => dispositionReview(s, id, disposition, note, by, nowISO()));
  if (review.source === "aoi" && review.externalId) {
    const facility = getState().profile.id;
    await backendFetch(`twin/${encodeURIComponent(facility)}/inspections/${encodeURIComponent(review.externalId)}/disposition`, {
      method: "POST",
      json: { action: disposition === "confirmed" ? "confirm" : "dismiss", auditor: by || "Operator" },
    }).catch((e) => console.warn("[aoi] disposition not sent to the backend:", e instanceof Error ? e.message : e));
  }
  return json({ review, state: getState() });
});
