import "server-only";
import { aiConfig, META_MODELS, metaApiKey, recordAiCall, recordAiError, recordAiSuccess } from "./config";
import { errorMessage, metaPost, withRetry } from "./llm";

/**
 * Meta Model API media models beyond chat:
 *   SAM 3.1                  promptable segmentation (boxes + masks) via the Responses endpoint
 *   Muse Image               image generation via /images/generations
 *   Muse Voice Transcribe    speech-to-text via /asr/transcribe (WAV)
 */

export interface SegmentBox {
  /** Pixel corners in the source image. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Source image size in pixels. */
  w: number;
  h: number;
  confidence: number | null;
}

const BOX_RE = /<\|box;x1=(-?[\d.]+);y1=(-?[\d.]+);x2=(-?[\d.]+);y2=(-?[\d.]+);w=(\d+);h=(\d+)(?:;c=([\d.]+))?\|>/g;

/** Parse SAM 3.1 special-token output: one `<|box;…|>` (then a mask token) per matched object. */
export function parseSamBoxes(text: string): SegmentBox[] {
  const out: SegmentBox[] = [];
  for (const m of text.matchAll(BOX_RE)) {
    out.push({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], w: +m[5], h: +m[6], confidence: m[7] ? +m[7] : null });
  }
  return out;
}

/** Pixel box → [ymin, xmin, ymax, xmax] on a 0–1000 grid (the builder's convention). */
export const toGrid = (b: SegmentBox): [number, number, number, number] => [
  Math.round((b.y1 / b.h) * 1000),
  Math.round((b.x1 / b.w) * 1000),
  Math.round((b.y2 / b.h) * 1000),
  Math.round((b.x2 / b.w) * 1000),
];

function responseText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") return data.output_text;
  let text = "";
  for (const item of (data.output as { content?: { type?: string; text?: string }[] }[] | undefined) ?? []) {
    for (const c of item.content ?? []) if (typeof c.text === "string") text += c.text;
  }
  return text;
}

function ensureOn() {
  const cfg = aiConfig();
  if (cfg.provider === "none") throw new Error(cfg.disabled ? "AI is turned off in Integrations." : `Meta Model API is not configured: ${cfg.missing.join(", ")}.`);
  return cfg;
}

async function tracked<T>(fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  recordAiCall();
  try {
    const r = await withRetry(fn);
    recordAiSuccess(Date.now() - started);
    return r;
  } catch (e) {
    recordAiError(errorMessage(e));
    throw new Error(errorMessage(e));
  }
}

/** Segment every instance of one concept ("machine", "scratch") in an image with SAM 3.1. */
export async function segmentImage(image: { mimeType: string; data: string }, concept: string, timeoutMs = 60_000): Promise<SegmentBox[]> {
  ensureOn();
  return tracked(async () => {
    const data = await metaPost(
      "/responses",
      {
        model: META_MODELS.segmentation,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept.slice(0, 60) }, { type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}` }] }],
      },
      timeoutMs,
    );
    return parseSamBoxes(responseText(data));
  });
}

/** Generate one image with Muse Image. Returns base64 data and its mime type. */
export async function generateImage(prompt: string, opts: { size?: string; format?: "png" | "jpeg" | "webp" } = {}): Promise<{ data: string; mimeType: string }> {
  ensureOn();
  return tracked(async () => {
    const data = await metaPost("/images/generations", { model: META_MODELS.image, prompt: prompt.slice(0, 3800), n: 1, size: opts.size ?? "1792x1024", output_format: opts.format ?? "png" }, 120_000);
    const first = (data.data as { b64_json?: string }[] | undefined)?.[0];
    if (!first?.b64_json) throw new Error("Muse Image returned no image.");
    return { data: first.b64_json, mimeType: `image/${String(data.output_format ?? opts.format ?? "png")}` };
  });
}

/** Transcribe a WAV clip with Muse Voice Transcribe (push-to-talk). */
export async function transcribeWav(wav: Blob, timeoutMs = 60_000): Promise<string> {
  const cfg = ensureOn();
  return tracked(async () => {
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({ model: META_MODELS.transcribe, audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }));
    form.append("audio", wav, "speech.wav");
    const res = await fetch(`${cfg.baseUrl}/asr/transcribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${metaApiKey()}`, accept: "text/plain" },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
    // text/plain: one turn per line (possibly "speaker:text" in diarization mode).
    return text
      .split(/\r?\n/)
      .map((l) => l.replace(/^(?:[A-Z]|unknown):/, "").trim())
      .filter(Boolean)
      .join(" ");
  });
}
