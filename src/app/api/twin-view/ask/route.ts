import { DomainError } from "@/domain/errors";
import { viewContext } from "@/domain/live";
import { llmGenerate } from "@/server/ai/llm";
import { json, route } from "@/server/http";
import { ensureFreshSettings } from "@/server/settings";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Ask the AI about what the 3D twin view shows. The browser sends a frame of the 3D view and a
 * question; the model sees the picture and the twin's actual state, and must take numbers from
 * the state, not from the picture. Read-only: nothing is stored or changed.
 */
export const POST = route(async (req: Request) => {
  const form = await req.formData();
  const image = form.get("image");
  const question = String(form.get("question") ?? "").trim().slice(0, 500) || "What am I looking at, and is anything wrong?";
  if (!(image instanceof File) || !/^image\/(jpeg|png|webp)$/.test(image.type) || image.size > 6 * 1024 * 1024) throw new DomainError("Send one JPEG, PNG or WebP frame under 6 MB.", 415);
  await ensureFreshSettings();
  const s = getState();
  const r = await llmGenerate({
    system: [
      "You look at a frame from the 3D view of an industrial digital twin and answer the operator's question.",
      "Colours: machines glow red when critical or down, amber on warning, blue/green when healthy; belts with stopped cartons are blocked; small vehicles are mobile robots.",
      "Use the twin state below for every id, status and number. Never read numbers off the picture or invent them. If the picture doesn't show something, say so.",
      "Answer in at most 5 short sentences or bullets.",
    ].join("\n"),
    prompt: `Twin state now:\n${viewContext(s)}\n\nQuestion: ${question}`,
    media: [{ mimeType: image.type, data: Buffer.from(await image.arrayBuffer()).toString("base64") }],
    thinkingLow: true,
    timeoutMs: 90_000,
  });
  return json({ answer: r.text.trim(), model: r.model, latencyMs: r.latencyMs });
});
