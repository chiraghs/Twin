import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Meta Model API adapter against recorded Responses API shapes (no network): configuration,
 * structured JSON, images, web search with url_citation annotations, the schema-dialect retry,
 * the Muse Wonder → Muse Spark briefing fallback and the ADK model adapter the copilot runs on.
 */

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };
type Reply = unknown | { __status: number; body: unknown };
let calls: Call[] = [];
let replies: Reply[] = [];
let dir = "";

function mockFetch() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
      const next = (replies.shift() ?? {}) as { __status?: number; body?: unknown };
      const status = next.__status ?? 200;
      return new Response(JSON.stringify(next.__status ? next.body : next), { status, headers: { "content-type": "application/json" } });
    }),
  );
}

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const settings = await import("@/server/settings");
  settings.__resetSettingsForTests();
  return { ...(await import("@/server/ai/config")), ...(await import("@/server/ai/llm")) };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "twin-ai-"));
  vi.stubEnv("TWIN_DATA_DIR", dir);
  vi.stubEnv("MODEL_API_KEY", "");
  vi.stubEnv("META_API_BASE", "");
  mockFetch();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

const KEY = "meta-test-0123456789abcdefghijklmnop";
const schema = { type: "object", properties: { summary: { type: "string" }, note: { type: ["string", "null"] } }, required: ["summary", "note"] };
const message = (text: string, annotations: unknown[] = []) => ({ type: "message", content: [{ type: "output_text", text, annotations }] });

describe("Meta Model API configuration", () => {
  it("needs the key, uses Muse defaults and can be turned off", async () => {
    let m = await load({});
    expect(m.aiConfig()).toMatchObject({ provider: "none", missing: ["Meta Model API key (MODEL_API_KEY)"] });
    m = await load({ MODEL_API_KEY: KEY });
    expect(m.aiConfig()).toMatchObject({ provider: "meta", model: "muse-spark-1.3", reasoningModel: "muse-wonder-1.0", baseUrl: "https://api.meta.ai/v1" });
    expect(m.modelLabel(m.aiConfig())).toBe("muse-spark-1.3 via Meta Model API");
    expect(m.aiCapabilities()).toMatchObject({ available: true, images: true, webSearch: true, video: false, pdf: false });
    m = await load({ MODEL_API_KEY: KEY, META_MODEL: "muse-spark-1.2", AI_ENABLED: "false" });
    expect(m.aiConfig()).toMatchObject({ provider: "none", disabled: true, model: "muse-spark-1.2" });
  });
});

describe("Meta Model API (Responses)", () => {
  it("returns structured JSON with images, the bearer key and low reasoning effort", async () => {
    const m = await load({ MODEL_API_KEY: KEY });
    replies = [{ output: [{ type: "reasoning", summary: [] }, message('{"summary":"All lines running.","note":null}')] }];
    const r = await m.llmGenerate({ prompt: "Summarise.", media: [{ mimeType: "image/png", data: "AAAA" }], json: { name: "briefing", schema }, thinkingLow: true });
    expect(r.json).toEqual({ summary: "All lines running.", note: null });
    expect(r.model).toBe("muse-spark-1.3 via Meta Model API");
    const { url, body, headers } = calls[0];
    expect(url).toBe("https://api.meta.ai/v1/responses");
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect((body.text as { format: { type: string; name: string } }).format).toMatchObject({ type: "json_schema", name: "briefing" });
    const input = body.input as { content: { type: string; image_url?: string }[] }[];
    expect(input[0].content[0]).toEqual({ type: "input_image", image_url: "data:image/png;base64,AAAA" });
  });

  it("uses Muse Wonder for the reasoning tier", async () => {
    const m = await load({ MODEL_API_KEY: KEY });
    replies = [{ output: [message('{"summary":"x","note":null}')] }];
    const r = await m.llmGenerate({ prompt: "Brief.", json: { name: "briefing", schema }, tier: "reasoning" });
    expect(calls[0].body.model).toBe("muse-wonder-1.0");
    expect(r.model).toBe("muse-wonder-1.0 via Meta Model API");
  });

  it("cites web sources from url_citation annotations and refuses video and PDFs", async () => {
    const m = await load({ MODEL_API_KEY: KEY });
    replies = [{ output: [{ type: "web_search_call", action: { query: "bakery line" } }, message("Ovens bake 2 t/h.", [{ type: "url_citation", url: "https://example.com/b", title: "Ovens", start_index: 0, end_index: 16 }])] }];
    const s = await m.llmGenerate({ prompt: "Research.", webSearch: true });
    expect(s.markedText).toBe("Ovens bake 2 t/h [R1].");
    expect(s.citations).toEqual([{ id: "R1", url: "https://example.com/b", title: "Ovens" }]);
    expect(s.queries).toEqual(["bakery line"]);
    expect(calls[0].body.tools).toEqual([{ type: "web_search" }]);
    await expect(m.llmGenerate({ prompt: "Watch.", media: [{ mimeType: "video/mp4", data: "CCCC" }] })).rejects.toBeInstanceOf(m.AiUnsupported);
    await expect(m.llmGenerate({ prompt: "Read.", media: [{ mimeType: "application/pdf", data: "AA" }] })).rejects.toBeInstanceOf(m.AiUnsupported);
  });

  it("retries once with anyOf when the schema dialect is rejected", async () => {
    const m = await load({ MODEL_API_KEY: KEY });
    replies = [{ __status: 400, body: { error: { message: "invalid schema: type must be a string", param: "text.format.schema" } } }, { output: [message('{"summary":"ok","note":"n"}')] }];
    const r = await m.llmGenerate({ prompt: "Summarise.", json: { name: "briefing", schema } });
    expect(r.json).toEqual({ summary: "ok", note: "n" });
    expect(calls).toHaveLength(2);
    const retried = (calls[1].body.text as { format: { schema: { properties: { note: unknown } } } }).format.schema.properties.note;
    expect(retried).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });
});

describe("Copilot runtime on Muse Spark", () => {
  async function runTurn(input: { sessionId: string; message?: string; confirm?: { callId: string; confirmed: boolean } }) {
    const { runCopilot } = await import("@/server/copilot/agent");
    const events = [];
    for await (const e of runCopilot(input)) events.push(e);
    return events;
  }
  const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });

  it("delegates to a specialist, runs deterministic tools and checks the answer's figures", async () => {
    await load({ MODEL_API_KEY: KEY });
    replies = [
      { output: [call("c1", "maintenance_analyst", { request: "Which machine is most at risk?" })] }, // coordinator
      { output: [call("s1", "list_assets", {})] }, // specialist
      { output: [message("- A-ROB-03 is the most at-risk asset.")] }, // specialist answer
      { output: [message("A-ROB-03 is most at risk.")] }, // coordinator answer
    ];
    const events = await runTurn({ sessionId: "session-test-01", message: "Which machine is most at risk?" });
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("start");
    expect(events.filter((e) => e.type === "tool_call").map((e) => (e as { tool: string }).tool)).toEqual(["maintenance_analyst", "list_assets"]);
    expect(events.find((e) => e.type === "answer")).toMatchObject({ text: "A-ROB-03 is most at risk." });
    expect(types.at(-1)).toBe("done");
    // coordinator sees its own tools plus the three specialists as function tools
    const tools = (calls[0].body.tools as { name: string }[]).map((t) => t.name);
    expect(tools).toEqual(["get_plant_overview", "search_audit", "propose_plan", "maintenance_analyst", "quality_analyst", "planning_analyst"]);
    expect(calls[1].body.instructions).toMatch(/maintenance analyst/);
    // the tool result is sent back as a function_call_output paired with its call id
    const input = calls[2].body.input as { type?: string; call_id?: string }[];
    expect(input.some((i) => i.type === "function_call_output" && i.call_id === "s1")).toBe(true);
  });

  it("pauses propose_plan for the person's confirmation and resumes after it", async () => {
    await load({ MODEL_API_KEY: KEY });
    replies = [{ output: [call("p1", "propose_plan", { scenarioId: "reroute", rationale: "Protect the order." })] }];
    const first = await runTurn({ sessionId: "session-test-02", message: "Propose the reroute plan for approval" });
    expect(first.find((e) => e.type === "confirm")).toMatchObject({ callId: "p1", tool: "propose_plan" });
    expect(first.some((e) => e.type === "answer")).toBe(false);

    replies = [{ output: [message("Nothing was created, as you declined.")] }];
    const second = await runTurn({ sessionId: "session-test-02", confirm: { callId: "p1", confirmed: false } });
    expect(second.find((e) => e.type === "answer")).toMatchObject({ text: "Nothing was created, as you declined." });
    const input = calls.at(-1)!.body.input as { type?: string; call_id?: string; output?: string }[];
    expect(input.find((i) => i.type === "function_call_output" && i.call_id === "p1")?.output).toMatch(/declined/);
  });
});
