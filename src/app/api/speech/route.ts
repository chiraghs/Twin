import { DomainError } from "@/domain/errors";
import { aiConfig, META_MODELS } from "@/server/ai/config";
import { transcribeWav } from "@/server/ai/meta-media";
import { json, route } from "@/server/http";
import { ensureFreshSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const MAX_BYTES = 10 * 1024 * 1024;

/** Muse Voice Transcribe: multipart `audio` (WAV, recorded and encoded in the browser) → text. */
export const POST = route(async (req: Request) => {
  await ensureFreshSettings();
  if (aiConfig().provider === "none") throw new DomainError("Speech input needs the Meta Model API key (Integrations).", 503);
  const form = await req.formData().catch(() => {
    throw new DomainError("Expected multipart form data");
  });
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) throw new DomainError("No audio received");
  if (!/^audio\/(wav|x-wav|wave)$/.test(audio.type)) throw new DomainError(`Send WAV audio (got ${audio.type || "unknown"})`, 415);
  if (audio.size > MAX_BYTES) throw new DomainError("Recording is too long (10 MB max).", 413);
  const text = await transcribeWav(audio).catch((e: unknown) => {
    throw new DomainError(`Muse Voice Transcribe failed: ${e instanceof Error ? e.message : String(e)}`, 502);
  });
  return json({ text, model: META_MODELS.transcribe });
});
