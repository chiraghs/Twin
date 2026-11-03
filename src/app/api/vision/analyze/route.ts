import { DomainError } from "@/domain/errors";
import { getCamera } from "@/domain/vision";
import { json, route } from "@/server/http";
import { getState } from "@/server/store";
import { aiReview, parseFrames } from "@/server/vision/reviews";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Upload a short clip or image for the configured AI model to review (advisory; pending human
 * disposition). `frames` (comma-separated seconds) marks the image as a contact sheet of a clip.
 */
export const POST = route(async (req: Request) => {
  const form = await req.formData().catch(() => {
    throw new DomainError("Expected multipart form data with a 'file' field");
  });
  const file = form.get("file");
  const cameraId = (form.get("cameraId") as string | null) || null;
  if (!(file instanceof File)) throw new DomainError("Missing 'file'");
  const camera = cameraId ? getCamera(getState(), cameraId) : null;
  const frames = parseFrames(form.get("frames"));
  const out = await aiReview({ bytes: Buffer.from(await file.arrayBuffer()), mime: file.type || "application/octet-stream", fileName: file.name, camera, frames });
  if (!out.ok) return json({ error: out.error }, out.status);
  return json(out.value, 201);
});

