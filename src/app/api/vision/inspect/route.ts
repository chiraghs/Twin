import { DomainError } from "@/domain/errors";
import { getCamera } from "@/domain/vision";
import { json, route } from "@/server/http";
import { visionService } from "@/server/integrations/vision-service";
import { getState } from "@/server/store";
import { opencvInspect } from "@/server/vision/reviews";
import { ensureFreshSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"]);
const MB = 1024 * 1024;
const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  bmp: "image/bmp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
};

/** Browsers report some types inconsistently (e.g. "video/avi" or "" for .avi); fall back to the extension. */
function normalised(f: File): File {
  if (IMAGE_TYPES.has(f.type) || VIDEO_TYPES.has(f.type)) return f;
  const type = BY_EXTENSION[f.name.split(".").pop()?.toLowerCase() ?? ""];
  return type ? new File([f], f.name, { type }) : f;
}

/**
 * Machine-vision check on the Python vision service (OpenCV). Multipart fields: `file` (image or
 * video), optional `reference` (golden image, images only) and `cameraId`. The result is stored as
 * a visual review pending human disposition.
 */
export const POST = route(async (req: Request) => {
  await ensureFreshSettings();
  if (!visionService.configured()) {
    return json({ error: "The vision service is not configured. Set its URL in Integrations → Vision service (or VISION_SERVICE_URL); see docs/python-services-plan.md." }, 503);
  }
  const form = await req.formData().catch(() => {
    throw new DomainError("Expected multipart form data with a 'file' field");
  });
  const rawFile = form.get("file");
  const rawReference = form.get("reference");
  const file = rawFile instanceof File ? normalised(rawFile) : rawFile;
  const reference = rawReference instanceof File ? normalised(rawReference) : rawReference;
  const cameraId = (form.get("cameraId") as string | null) || null;
  if (!(file instanceof File)) throw new DomainError("Missing 'file'");
  const camera = cameraId ? getCamera(getState(), cameraId) : null;

  const kind = IMAGE_TYPES.has(file.type) ? "image" : VIDEO_TYPES.has(file.type) ? "video" : null;
  if (!kind) return json({ error: `Unsupported file type ${file.type || "unknown"}. Use JPEG, PNG, WebP, BMP, MP4, WebM, MOV or AVI.` }, 415);
  if (file.size > (kind === "image" ? 15 : 30) * MB) return json({ error: `File is larger than ${kind === "image" ? 15 : 30} MB.` }, 413);
  if (reference instanceof File && reference.size > 0) {
    if (kind !== "image") throw new DomainError("A golden reference can only be used with an image");
    if (!IMAGE_TYPES.has(reference.type)) return json({ error: `Unsupported reference type ${reference.type}.` }, 415);
    if (reference.size > 15 * MB) return json({ error: "Reference image is larger than 15 MB." }, 413);
  }
  const out = await opencvInspect({ kind, file, reference: reference instanceof File && reference.size > 0 ? reference : null, camera });
  if (!out.ok) return json({ error: out.error }, out.status);
  return json(out.value, 201);
});
