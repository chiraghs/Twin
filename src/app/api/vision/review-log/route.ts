import { reviewInspectionLog } from "@/domain/vision";
import { json, nowISO, parseBody, route } from "@/server/http";
import { ReviewLogSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

/** Deterministic review of a simulated inspection camera's recent units. */
export const POST = route(async (req: Request) => {
  const { cameraId } = await parseBody(req, ReviewLogSchema);
  const review = mutate((s) => reviewInspectionLog(s, cameraId, nowISO()));
  return json({ review, state: getState() }, 201);
});
