import { DomainError } from "@/domain/errors";
import { runBuilder, type BuilderInput } from "@/domain/builder/pipeline";
import { builderAi } from "@/server/builder/ai";
import { ndjsonResponse, route } from "@/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BLUEPRINT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Twin Builder agent run. Multipart fields: requirements, name, industry, location, templateId,
 * research ("false" to skip), and an optional `blueprint` (PNG, JPEG or WebP ≤ 15 MB).
 * Streams each stage's real output as NDJSON. The blueprint is not stored.
 */
export const POST = route(async (req: Request) => {
  const form = await req.formData().catch(() => {
    throw new DomainError("Expected multipart form data");
  });
  const text = (k: string, max: number) => String(form.get(k) ?? "").slice(0, max);
  const file = form.get("blueprint");
  let blueprint: BuilderInput["blueprint"] = null;
  if (file instanceof File && file.size > 0) {
    if (!BLUEPRINT_TYPES.has(file.type)) throw new DomainError(`Unsupported blueprint type ${file.type || "unknown"}. Use PNG, JPEG or WebP.`, 415);
    if (file.size > MAX_BYTES) throw new DomainError("Blueprint is larger than 15 MB.", 413);
    blueprint = { data: Buffer.from(await file.arrayBuffer()).toString("base64"), mimeType: file.type, fileName: file.name.slice(0, 160) };
  }
  const input: BuilderInput = {
    requirements: text("requirements", 6000),
    site: { name: text("name", 80), industry: text("industry", 80), location: text("location", 80) },
    templateId: text("templateId", 60) || null,
    blueprint,
    research: text("research", 8) !== "false",
  };
  if (!input.requirements.trim() && !blueprint && !input.templateId && !input.site.industry?.trim()) {
    throw new DomainError("Describe your factory, upload a blueprint or pick a template.");
  }

  return ndjsonResponse(() => runBuilder(input, builderAi()));
});
