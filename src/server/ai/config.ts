import "server-only";
import { setting, type AiProviderId } from "@/server/settings";

/**
 * The AI platform Twin uses: Meta Model API (https://api.meta.ai/v1). Every AI feature goes
 * through this: agent briefings (Muse Wonder), the copilot, the Twin Builder and footage review
 * (Muse Spark), floor-plan and defect segmentation (SAM 3.1), image generation (Muse Image) and
 * speech-to-twin (Muse Voice Transcribe).
 */

export interface AiConfig {
  provider: AiProviderId | "none";
  /** Muse Spark: agents, copilot, builder, vision review. */
  model: string;
  /** Muse Wonder: the orchestrator's decision briefing. */
  reasoningModel: string;
  baseUrl: string;
  timeoutMs: number;
  missing: string[];
  /** Turned off in Integrations (AI_ENABLED=false). */
  disabled?: boolean;
}

export const META_MODELS = {
  agent: "muse-spark-1.3",
  reasoning: "muse-wonder-1.0",
  image: "muse-image-1.0",
  segmentation: "sam-3.1",
  transcribe: "muse-voice-transcribe-1.0",
} as const;

export const PROVIDER_NAME = "Meta Model API";

/** Base URL is deployment-only (never editable in the UI, so the key can't be sent elsewhere). */
export const metaBaseUrl = () => (process.env.META_API_BASE || "https://api.meta.ai/v1").replace(/\/+$/, "");
export const metaApiKey = () => setting("MODEL_API_KEY") ?? "";

export function aiConfig(): AiConfig {
  const timeoutMs = Math.max(Number(process.env.AI_TIMEOUT_MS || 60000), 15000);
  const base = { model: setting("META_MODEL") || META_MODELS.agent, reasoningModel: setting("META_REASONING_MODEL") || META_MODELS.reasoning, baseUrl: metaBaseUrl(), timeoutMs };
  if ((setting("AI_ENABLED") ?? "true").toLowerCase() === "false") return { ...base, provider: "none", missing: [], disabled: true };
  if (!metaApiKey()) return { ...base, provider: "none", missing: ["Meta Model API key (MODEL_API_KEY)"] };
  return { ...base, provider: "meta", missing: [] };
}

/** "muse-spark-1.3 via Meta Model API" — shown wherever AI output appears. */
export function modelLabel(cfg: AiConfig, model = cfg.model): string {
  return cfg.provider === "none" ? "none" : `${model} via ${PROVIDER_NAME}`;
}

/** What the platform can do; features that need more say so instead of failing. */
export function aiCapabilities(cfg: AiConfig = aiConfig()) {
  const on = cfg.provider !== "none";
  return {
    available: on,
    // Video goes through frames captured in the browser (contact sheet), which Muse Spark reads as an image.
    video: false,
    images: on,
    // PDFs would need the Files API; drawings are sent as images.
    pdf: false,
    // Responses API web_search with url_citation annotations.
    webSearch: on,
    segmentation: on,
    imageGeneration: on,
    transcription: on,
  };
}

type AiRuntime = { lastSuccessAt: string | null; lastError: string | null; lastLatencyMs: number | null; calls: number };
const g = globalThis as unknown as { __twinAi?: AiRuntime };
const runtime: AiRuntime = (g.__twinAi ??= { lastSuccessAt: null, lastError: null, lastLatencyMs: null, calls: 0 });

export function aiRuntime() {
  return { ...runtime };
}

/** Forget the last call's outcome (after the AI settings change, so the status reflects the new configuration). */
export function resetAiRuntime() {
  runtime.lastSuccessAt = null;
  runtime.lastError = null;
  runtime.lastLatencyMs = null;
}

export function recordAiCall() {
  runtime.calls++;
}
export function recordAiSuccess(latencyMs: number) {
  runtime.lastSuccessAt = new Date().toISOString();
  runtime.lastLatencyMs = latencyMs;
  runtime.lastError = null;
}
export function recordAiError(msg: string) {
  runtime.lastError = `${new Date().toISOString()} — ${msg}`.slice(0, 400);
}
