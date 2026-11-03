import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { aiConfig, META_MODELS } from "@/server/ai/config";
import { generateImage } from "@/server/ai/meta-media";
import { json, route } from "@/server/http";
import { ensureFreshSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

const Body = z.object({ description: z.string().trim().min(10).max(2000) });

/**
 * Muse Image draws a top-down floor plan from a plain-language description. The browser then
 * hands the drawing to the Twin Builder like any uploaded blueprint, so Muse Spark and SAM 3.1
 * read it back into a twin: describe → draw → segment → twin.
 */
export const POST = route(async (req: Request) => {
  await ensureFreshSettings();
  if (aiConfig().provider === "none") throw new DomainError("Floor-plan generation needs the Meta Model API key (Integrations).", 503);
  const { description } = Body.parse(await req.json());
  const prompt = [
    "Top-down 2D CAD floor plan of a factory production area. Clean technical drawing on a white background with thin dark lines.",
    "Draw every machine as a distinct rectangular footprint with its name written inside in clear capital letters.",
    "Show conveyors as long narrow rectangles and material flow with arrows. Include storage racks and a shipping dock if mentioned.",
    "No people, no perspective, no shading, no photographic texture, no extra text outside the labels.",
    `Plant: ${description}`,
  ].join(" ");
  const img = await generateImage(prompt, { size: "1792x1024", format: "png" }).catch((e: unknown) => {
    throw new DomainError(`Muse Image failed: ${e instanceof Error ? e.message : String(e)}`, 502);
  });
  return json({ image: `data:${img.mimeType};base64,${img.data}`, mimeType: img.mimeType, model: META_MODELS.image, prompt }, 201);
});
