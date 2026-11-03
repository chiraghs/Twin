import "server-only";
import { aiCapabilities, aiConfig, metaApiKey, modelLabel, recordAiCall, recordAiError, recordAiSuccess, type AiConfig } from "./config";
import { logAiCall } from "@/server/db/ai-log";

/**
 * One way to call Meta's Muse models: the Meta Model API Responses endpoint
 * (POST https://api.meta.ai/v1/responses). Supports images, structured JSON output
 * (text.format json_schema), client function tools (for the multi-agent copilot) and web search with
 * url_citation annotations (Twin Builder research). Every caller validates the output itself;
 * anything the API cannot do raises AiUnsupported instead of guessing.
 */

export interface Media {
  mimeType: string;
  /** Base64 data. */
  data: string;
}
export interface ChatTool {
  name: string;
  description?: string;
  /** JSON Schema of the arguments (an object schema). */
  parameters: Record<string, unknown>;
}
export type ChatPart =
  | { type: "text"; text: string }
  | { type: "media"; mimeType: string; data: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown };
export interface ChatMessage {
  role: "user" | "assistant";
  parts: ChatPart[];
}
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
export interface ChatRequest {
  system?: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  /** Force a JSON result matching this schema. */
  json?: { name: string; schema: Record<string, unknown> };
  webSearch?: boolean;
  maxOutputTokens?: number;
  /** Kept for callers; the Responses API controls sampling itself. */
  temperature?: number;
  /** Keep reasoning short (faster, cheaper). Muse models always reason; "none" is not allowed. */
  thinkingLow?: boolean;
  reasoningEffort?: ReasoningEffort;
  /** Override the configured model (e.g. Muse Wonder for briefings). */
  model?: string;
  timeoutMs: number;
}
export interface Citation {
  id: string;
  url: string;
  title: string;
}
export interface ChatResult {
  text: string;
  json?: unknown;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
  /** Web sources, numbered R1, R2… in order of first use. */
  citations: Citation[];
  /** `text` with [R#] markers after the passages each source supports. */
  markedText: string;
  queries: string[];
  /** Kept for the builder's research panel; Meta returns no search widget. */
  searchEntryPoint: string | null;
  /** The model that answered. */
  model?: string;
}

export class AiUnsupported extends Error {
  status = 415;
}

/* ───────────────────────────── shared helpers ───────────────────────────── */

const RETRYABLE = /\b(429|500|502|503|504|529)\b|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED|timed out|fetch failed|ECONNRESET/i;

export async function withRetry<T>(fn: () => Promise<T>, retries = 1): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = errorMessage(e);
      if (attempt >= retries || e instanceof AiUnsupported || !RETRYABLE.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, /429|RESOURCE_EXHAUSTED|overloaded|529/i.test(msg) ? 2000 : 300));
    }
  }
}

export const errorMessage = (e: unknown) => (e instanceof Error ? (e.name === "AbortError" || e.name === "TimeoutError" ? "timed out" : e.message) : String(e));

export async function metaPost(path: string, body: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  const cfg = aiConfig();
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${metaApiKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { message: text.slice(0, 300) } };
  }
  if (!res.ok) {
    const err = (data.error ?? {}) as { message?: string; type?: string; param?: string };
    throw new Error(`${res.status} ${err.message ?? err.type ?? res.statusText}${err.param ? ` (param: ${err.param})` : ""}`.slice(0, 400));
  }
  return data;
}

const dataUrl = (m: Media) => `data:${m.mimeType};base64,${m.data}`;
const isImage = (m: { mimeType: string }) => m.mimeType.startsWith("image/");

/** Number sources in order of first use. */
function citationBook() {
  const list: Citation[] = [];
  const byUrl = new Map<string, string>();
  const idFor = (url: string, title: string) => {
    if (!byUrl.has(url)) {
      if (list.length >= 15) return null;
      const id = `R${list.length + 1}`;
      byUrl.set(url, id);
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {
        /* keep the raw url */
      }
      list.push({ id, url, title: (title || host).slice(0, 200) });
    }
    return byUrl.get(url)!;
  };
  return { list, idFor };
}

export const parseJson = (text: string) => JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));

/** JSON Schema `type: ["string","null"]` → `anyOf`, for endpoints that reject type arrays. */
export function anyOfNullable(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(anyOfNullable);
  if (!s || typeof s !== "object") return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) out[k] = k === "type" ? v : anyOfNullable(v);
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    const { type: _t, enum: en, ...rest } = out;
    const branches = types.map((t) => (t === "null" ? { type: "null" } : { type: t, ...rest, ...(en ? { enum: (en as unknown[]).filter((x) => x !== null) } : {}) }));
    const keep = Object.fromEntries(Object.entries(rest).filter(([k]) => k === "description"));
    return { ...keep, anyOf: branches };
  }
  return out;
}

/* ───────────────────────────── Meta Model API (Responses) ───────────────────────────── */

function toResponsesInput(messages: ChatMessage[]) {
  const items: Record<string, unknown>[] = [];
  for (const m of messages) {
    const content: Record<string, unknown>[] = [];
    for (const p of m.parts) {
      if (p.type === "text") {
        if (p.text) content.push({ type: m.role === "user" ? "input_text" : "output_text", text: p.text });
      } else if (p.type === "media") {
        if (!isImage(p)) throw new AiUnsupported(`Send ${p.mimeType.startsWith("video/") ? "still frames" : "an image (PNG, JPEG or WebP)"} instead of ${p.mimeType}: Twin sends Muse Spark images.`);
        content.push({ type: "input_image", image_url: dataUrl(p) });
      } else if (p.type === "tool_call") items.push({ type: "function_call", call_id: p.id, name: p.name, arguments: JSON.stringify(p.args ?? {}) });
      else items.push({ type: "function_call_output", call_id: p.id, output: typeof p.result === "string" ? p.result : JSON.stringify(p.result ?? null) });
    }
    if (content.length) items.push({ role: m.role, content });
  }
  return items;
}

type ResponsesOutput = {
  output?: {
    type: string;
    content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string; end_index?: number }[] }[];
    call_id?: string;
    name?: string;
    arguments?: string;
    action?: { query?: string };
  }[];
  output_text?: string;
};

async function metaChat(cfg: AiConfig, req: ChatRequest): Promise<ChatResult> {
  const model = req.model || cfg.model;
  const tools: Record<string, unknown>[] = (req.tools ?? []).map((t) => ({ type: "function", name: t.name, description: t.description ?? "", parameters: t.parameters, strict: false }));
  if (req.webSearch) tools.push({ type: "web_search" });
  const body: Record<string, unknown> = { model, input: toResponsesInput(req.messages), max_output_tokens: Math.max(req.maxOutputTokens ?? 4096, 16) };
  if (req.system) body.instructions = req.system;
  if (tools.length) body.tools = tools;
  const effort = req.reasoningEffort ?? (req.thinkingLow ? "low" : undefined);
  if (effort) body.reasoning = { effort };
  if (req.json) body.text = { format: { type: "json_schema", name: req.json.name, schema: req.json.schema, strict: false } };

  let data: ResponsesOutput;
  try {
    data = (await metaPost("/responses", body, req.timeoutMs)) as ResponsesOutput;
  } catch (e) {
    // Some schema dialects reject `type: [..., "null"]`; retry once with anyOf.
    if (!req.json || !/\b400\b/.test(errorMessage(e)) || !/schema|type|format/i.test(errorMessage(e))) throw e;
    body.text = { format: { type: "json_schema", name: req.json.name, schema: anyOfNullable(req.json.schema), strict: false } };
    data = (await metaPost("/responses", body, req.timeoutMs)) as ResponsesOutput;
  }

  const book = citationBook();
  let text = "";
  let marked = "";
  const toolCalls: ChatResult["toolCalls"] = [];
  const queries: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type === "message") {
      for (const c of item.content ?? []) {
        if (c.type !== "output_text" || !c.text) continue;
        text += c.text;
        // Insert [R#] at the end of each cited span, last first so indices stay valid.
        let t = c.text;
        const marks = (c.annotations ?? [])
          .filter((a) => a.type === "url_citation" && a.url && a.end_index != null)
          .map((a) => ({ at: a.end_index!, id: book.idFor(a.url!, a.title ?? "") }))
          .filter((m): m is { at: number; id: string } => !!m.id)
          .sort((a, b) => b.at - a.at);
        for (const m of marks) t = `${t.slice(0, m.at)} [${m.id}]${t.slice(m.at)}`;
        marked += t;
      }
    } else if (item.type === "function_call" && item.name) {
      let args: Record<string, unknown> = {};
      try {
        args = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        /* malformed arguments: the tool layer reports the validation error */
      }
      toolCalls.push({ id: item.call_id ?? `call_${toolCalls.length}`, name: item.name, args });
    } else if (item.type === "web_search_call" && item.action?.query) queries.push(item.action.query);
  }
  if (!text && typeof data.output_text === "string") text = marked = data.output_text;
  return { text, json: req.json ? parseJson(text) : undefined, toolCalls, citations: book.list, markedText: marked, queries, searchEntryPoint: null, model };
}

/* ───────────────────────────── entry points ───────────────────────────── */

/** One model turn (no retry, no bookkeeping). */
export function chatOnce(cfg: AiConfig, req: ChatRequest): Promise<ChatResult> {
  if (cfg.provider !== "meta") throw new Error("Meta Model API is not configured.");
  return metaChat(cfg, req);
}

export interface GenerateRequest {
  system?: string;
  prompt: string;
  media?: Media[];
  json?: { name: string; schema: Record<string, unknown> };
  webSearch?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  thinkingLow?: boolean;
  reasoningEffort?: ReasoningEffort;
  /** "reasoning" uses Muse Wonder (META_REASONING_MODEL); default is Muse Spark (META_MODEL). */
  tier?: "agent" | "reasoning";
  timeoutMs?: number;
}

/**
 * A single prompt (with optional images) to Meta Model API, with one retry on transient errors
 * and status bookkeeping for the Integrations page.
 */
export async function llmGenerate(req: GenerateRequest): Promise<ChatResult & { model: string; latencyMs: number }> {
  const cfg = aiConfig();
  if (cfg.provider === "none") throw new Error(cfg.disabled ? "AI is turned off in Integrations." : `AI is not configured: ${cfg.missing.join(", ")}.`);
  const caps = aiCapabilities(cfg);
  if (req.webSearch && !caps.webSearch) throw new AiUnsupported(`Web search isn't available with ${modelLabel(cfg)}.`);
  const model = req.tier === "reasoning" ? cfg.reasoningModel : cfg.model;
  const timeoutMs = Math.max(req.timeoutMs ?? cfg.timeoutMs, cfg.timeoutMs);
  const started = Date.now();
  recordAiCall();
  try {
    const r = await withRetry(() =>
      chatOnce(cfg, {
        system: req.system,
        messages: [{ role: "user", parts: [...(req.media ?? []).map((m) => ({ type: "media" as const, ...m })), { type: "text" as const, text: req.prompt }] }],
        json: req.json,
        webSearch: req.webSearch,
        maxOutputTokens: req.maxOutputTokens,
        thinkingLow: req.thinkingLow,
        reasoningEffort: req.reasoningEffort,
        model,
        timeoutMs,
      }),
    );
    const latencyMs = Date.now() - started;
    recordAiSuccess(latencyMs);
    logAiCall(model, req.json?.name ?? (req.webSearch ? "web research" : "generate"), true, latencyMs);
    return { ...r, model: modelLabel(cfg, model), latencyMs };
  } catch (e) {
    const msg = errorMessage(e);
    if (!(e instanceof AiUnsupported)) recordAiError(msg);
    logAiCall(model, req.json?.name ?? (req.webSearch ? "web research" : "generate"), false, Date.now() - started, msg);
    throw e instanceof AiUnsupported ? e : new Error(msg);
  }
}
