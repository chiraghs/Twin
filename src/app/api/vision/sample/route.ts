import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { aiConfig, META_MODELS } from "@/server/ai/config";
import { generateImage } from "@/server/ai/meta-media";
import { json, route } from "@/server/http";
import { ensureFreshSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

const Body = z.object({ defect: z.string().trim().max(60).default(""), subject: z.string().trim().min(3).max(120).default("printed circuit board assembly") });

/**
 * Muse Image renders a synthetic inspection-camera photo (labelled synthetic in the UI) so the
 * visual review can be demonstrated without a line camera. It is never treated as plant evidence.
 */
export const POST = route(async (req: Request) => {
  await ensureFreshSettings();
  if (aiConfig().provider === "none") throw new DomainError("Test photos need the Meta Model API key (Integrations).", 503);
  const { defect, subject } = Body.parse(await req.json().catch(() => ({})));
  const prompt = `Close-up top-down industrial inspection camera photo of a ${subject} on a conveyor, neutral background, even diffuse lighting, sharp focus, ${
    defect ? `with one clearly visible ${defect}` : "in perfect condition with no defects"
  }. Photorealistic, no text, no watermark.`;
  const img = await generateImage(prompt, { size: "1024x1024", format: "png" }).catch((e: unknown) => {
    throw new DomainError(`Muse Image failed: ${e instanceof Error ? e.message : String(e)}`, 502);
  });
  return json({ image: `data:${img.mimeType};base64,${img.data}`, mimeType: img.mimeType, model: META_MODELS.image }, 201);
});
