import { DomainError } from "@/domain/errors";
import { runBuilder, type BuilderInput } from "@/domain/builder/pipeline";
import { json, ndjsonResponse, route } from "@/server/http";
import { baseten } from "@/server/private-ai/baseten";
import { privateBuilderAi } from "@/server/private-ai/builder";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BLUEPRINT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Plant-Private Blueprint → Twin: reads the drawing and drafts the twin on Meta's open-weight
 * Muse Spark Open (Baseten), then runs the same deterministic validation as the Twin Builder.
 * Multipart: blueprint (PNG/JPEG/WebP ≤ 15 MB), requirements, name, industry, location.
 * Streams the pipeline's events as NDJSON. The drawing is not stored.
 */
export const POST = route(async (req: Request) => {
  if (!baseten.configured()) {
    return json({ error: "Plant-Private AI is not configured: set BASETEN_API_KEY in .env and restart the web app." }, 503);
  }
  const form = await req.formData().catch(() => {
    throw new DomainError("Expected multipart form data");
  });
  const text = (k: string, max: number) => String(form.get(k) ?? "").slice(0, max);
  const file = form.get("blueprint");
  if (!(file instanceof File) || file.size === 0) throw new DomainError("Upload a blueprint image (PNG, JPEG or WebP).");
  if (!BLUEPRINT_TYPES.has(file.type)) throw new DomainError(`Unsupported blueprint type ${file.type || "unknown"}. Use PNG, JPEG or WebP.`, 415);
  if (file.size > MAX_BYTES) throw new DomainError("Blueprint is larger than 15 MB.", 413);

  const input: BuilderInput = {
    requirements: text("requirements", 6000),
    site: { name: text("name", 80), industry: text("industry", 80), location: text("location", 80) },
    templateId: null,
    blueprint: { data: Buffer.from(await file.arrayBuffer()).toString("base64"), mimeType: file.type, fileName: file.name.slice(0, 160) },
    research: true, // reported as skipped: plant-private mode has no web research
  };
  return ndjsonResponse(() => runBuilder(input, privateBuilderAi()));
});
