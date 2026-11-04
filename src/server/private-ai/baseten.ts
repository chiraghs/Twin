import "server-only";
import type { ZodType } from "zod";
import { logAiCall } from "@/server/db/ai-log";

/**
 * Plant-Private AI: Meta's open-weight Muse Spark Open, served by Baseten's OpenAI-compatible
 * Model APIs (POST {base}/chat/completions, Authorization: Bearer BASETEN_API_KEY).
 *
 * Muse Spark Open has no enforced structured output on Baseten, so JSON is requested in the prompt
 * (with a shape example), extracted, validated with zod, and retried once with the validation
 * errors before giving up. Configuration comes from `.env` only: BASETEN_API_KEY, BASETEN_MODEL,
 * BASETEN_BASE_URL (optional).
 */

export const DEFAULT_MODEL = "meta-models/muse-spark-open-1026";
export const DEFAULT_BASE = "https://inference.baseten.co/v1";

export const baseten = {
  apiKey: () => (process.env.BASETEN_API_KEY ?? "").trim(),
  model: () => (process.env.BASETEN_MODEL ?? "").trim() || DEFAULT_MODEL,
  baseUrl: () => ((process.env.BASETEN_BASE_URL ?? "").trim() || DEFAULT_BASE).replace(/\/+$/, ""),
  configured: () => baseten.apiKey().length > 0,
  label: () => `${baseten.model().split("/").pop()} · Baseten`,
};

export class OpenModelError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export interface OpenImage {
  mimeType: string;
  /** Base64 data. */
  data: string;
}

export interface OpenChatRequest {
  system: string;
  user: string;
  images?: OpenImage[];
  maxTokens: number;
  timeoutMs: number;
  purpose: string;
  /** Earlier turns (used for the JSON repair retry). */
  history?: { role: "user" | "assistant"; content: string }[];
}

export interface OpenChatResult {
  text: string;
  model: string;
  latencyMs: number;
  usage: { promptTokens: number; completionTokens: number } | null;
}

type ChatResponse = {
  model?: string;
  choices?: { message?: { content?: string | { type: string; text?: string }[] | null; reasoning_content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
};

/** One chat completion on the open-weight model. Logs every call to `ai_calls` (component web). */
export async function openChat(req: OpenChatRequest): Promise<OpenChatResult> {
  if (!baseten.configured()) throw new OpenModelError("Plant-Private AI is not configured: set BASETEN_API_KEY in .env and restart.", 503);
  const model = baseten.model();
  const userContent = req.images?.length
    ? [{ type: "text", text: req.user }, ...req.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mimeType};base64,${i.data}` } }))]
    : req.user;
  const body = {
    model,
    messages: [{ role: "system", content: req.system }, ...(req.history ?? []).map((h) => ({ role: h.role, content: h.content })), { role: "user", content: userContent }],
    max_tokens: req.maxTokens,
    temperature: 0.2,
  };
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${baseten.baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${baseten.apiKey()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timed out" : e instanceof Error ? e.message : String(e);
    logAiCall(model, `private: ${req.purpose}`, false, Date.now() - started, msg);
    throw new OpenModelError(`Baseten request failed: ${msg}`);
  }
  const raw = await res.text();
  let data: ChatResponse = {};
  try {
    data = raw ? (JSON.parse(raw) as ChatResponse) : {};
  } catch {
    data = { error: raw.slice(0, 300) };
  }
  const latencyMs = Date.now() - started;
  if (!res.ok) {
    const msg = typeof data.error === "string" ? data.error : (data.error?.message ?? res.statusText);
    logAiCall(model, `private: ${req.purpose}`, false, latencyMs, `${res.status} ${msg}`);
    throw new OpenModelError(`Baseten ${res.status}: ${msg}`.slice(0, 300), res.status === 401 || res.status === 403 ? 502 : 502);
  }
  const content = data.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : "";
  logAiCall(model, `private: ${req.purpose}`, true, latencyMs, `${data.usage?.prompt_tokens ?? "?"} in / ${data.usage?.completion_tokens ?? "?"} out`);
  return {
    text,
    model: data.model ?? model,
    latencyMs,
    usage: data.usage ? { promptTokens: data.usage.prompt_tokens ?? 0, completionTokens: data.usage.completion_tokens ?? 0 } : null,
  };
}

/** The JSON object in a model reply: drops reasoning blocks and code fences, takes the outermost {…}. */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const issuesOf = (e: unknown) => {
  const z = e as { issues?: { path: (string | number)[]; message: string }[] };
  return z.issues ? z.issues.slice(0, 12).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) : [e instanceof Error ? e.message : String(e)];
};

/**
 * Ask for JSON matching `schema` (described to the model by `shape`), validate it, and retry once
 * with the problems listed. `prepare` can normalise harmless differences before validation.
 */
export async function openJson<T>(
  schema: ZodType<T>,
  req: Omit<OpenChatRequest, "history"> & { shape: string; prepare?: (raw: unknown) => unknown },
): Promise<{ value: T; attempts: number; model: string; latencyMs: number }> {
  const system = `${req.system}\n\nReply with ONE JSON object only (no prose, no code fences), exactly in this shape:\n${req.shape}`;
  let history: OpenChatRequest["history"] = [];
  let latency = 0;
  let lastProblems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await openChat({ ...req, system, history });
    latency += r.latencyMs;
    try {
      const raw = extractJson(r.text);
      const value = schema.parse(req.prepare ? req.prepare(raw) : raw);
      return { value, attempts: attempt, model: r.model, latencyMs: latency };
    } catch (e) {
      lastProblems = issuesOf(e);
      history = [
        { role: "user", content: req.user.slice(0, 4000) },
        { role: "assistant", content: r.text.slice(0, 6000) },
      ];
      // The repair turn only fixes the JSON, so the images are not sent again.
      req = { ...req, images: undefined, user: `Your JSON did not match the required shape. Fix these problems and reply with the corrected JSON object only:\n- ${lastProblems.join("\n- ")}` };
    }
  }
  throw new OpenModelError(`Muse Spark Open did not return valid JSON after a retry: ${lastProblems.slice(0, 3).join("; ")}`);
}
