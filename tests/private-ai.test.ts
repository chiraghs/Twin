import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Never write test calls into the developer's AI call log (.data/twin.db).
vi.mock("@/server/db/ai-log", () => ({ logAiCall: vi.fn() }));
import { z } from "zod";
import { runBuilder, type BuilderEvent } from "@/domain/builder/pipeline";
import { extractJson, openJson } from "@/server/private-ai/baseten";
import { privateBuilderAi } from "@/server/private-ai/builder";

/** Recorded-style Baseten chat completion replies, served in order; captures the requests. */
function fakeBaseten(replies: string[]) {
  const requests: { url: string; auth: string; body: { model: string; messages: { role: string; content: unknown }[] } }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, auth: String((init.headers as Record<string, string>).authorization), body: JSON.parse(String(init.body)) });
      const content = replies[Math.min(requests.length - 1, replies.length - 1)];
      return new Response(JSON.stringify({ model: "meta-models/muse-spark-open-1026", choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }), { status: 200 });
    }),
  );
  return requests;
}

const READING = {
  legible: true,
  drawingKind: "floor plan",
  summary: "One bottling line from filler to labeler, ending in a packing area.",
  siteName: "Riverside Bottling",
  industry: "beverage",
  elements: [
    { id: "e1", label: "Filler F-1", role: "machine", archetype: "filler", lineHint: "Line 1", box: [100, 100, 300, 300], confidence: 0.9 },
    { id: "e2", label: "Labeler L-1", role: "machine", archetype: "labeler", lineHint: "Line 1", box: [100, 400, 300, 600], confidence: 0.85 },
    { id: "e3", label: "Office", role: "office", archetype: "none", lineHint: null, box: [700, 700, 900, 900], confidence: 0.6 },
  ],
  flows: [{ from: "e1", to: "e2" }],
  notes: [],
};

const DRAFT = {
  site: { name: "Riverside Bottling", industry: "beverage", location: "", productionType: "bottling" },
  lines: [
    {
      name: "Line 1", role: "process", products: ["Water 500 ml"], source: "blueprint", note: null,
      machines: [
        { name: "Filler F-1", archetype: "filler", ratePerHour: null, source: "blueprint", note: null, refs: [], blueprintElement: "e1" },
        { name: "Labeler L-1", archetype: "labeler", ratePerHour: null, source: "blueprint", note: null, refs: [], blueprintElement: "e2" },
      ],
    },
    {
      name: "Packing", role: "packing", products: ["Water 500 ml"], source: "default", note: null,
      machines: [{ name: "Case packer", archetype: "packager", ratePerHour: null, source: "default", note: null, refs: [], blueprintElement: null }],
    },
  ],
  products: [{ name: "Water 500 ml", unit: "bottles", ratePerHour: null, unitPrice: null, unitMaterialCost: null, source: "requirement", note: null, refs: [], materials: [] }],
  materials: [],
  integrations: [],
  mobileRobots: [],
  assumptions: ["Line rate not stated; default used."],
  questions: ["What is the target output per hour?"],
};

describe("Plant-Private AI (Muse Spark Open on Baseten)", () => {
  beforeEach(() => {
    vi.stubEnv("BASETEN_API_KEY", "bt-test-key-0123456789");
    vi.stubEnv("BASETEN_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("extracts the JSON object from reasoning text and code fences", () => {
    expect(extractJson('<think>let me see {not json}</think>\nHere:\n```json\n{"a": 1, "b": {"c": [2]}}\n```')).toEqual({ a: 1, b: { c: [2] } });
    expect(() => extractJson("no json here")).toThrow(/no JSON/);
  });

  it("calls the OpenAI-compatible endpoint with the open-weight model and a bearer key, and retries once with the validation errors", async () => {
    const requests = fakeBaseten(['{"count": "three"}', '{"count": 3}']);
    const out = await openJson(z.object({ count: z.number() }), { system: "s", user: "u", images: [{ mimeType: "image/png", data: "AAAA" }], shape: '{"count": 0}', maxTokens: 50, timeoutMs: 1000, purpose: "test" });
    expect(out.value.count).toBe(3);
    expect(out.attempts).toBe(2);
    expect(requests[0].url).toBe("https://inference.baseten.co/v1/chat/completions");
    expect(requests[0].auth).toBe("Bearer bt-test-key-0123456789");
    expect(requests[0].body.model).toBe("meta-models/muse-spark-open-1026");
    // First turn carries the image; the repair turn lists the problem and does not resend the image.
    expect(JSON.stringify(requests[0].body.messages)).toContain("data:image/png;base64,AAAA");
    const repair = requests[1].body.messages[requests[1].body.messages.length - 1];
    expect(String(repair.content)).toMatch(/count/);
    expect(JSON.stringify(requests[1].body.messages)).not.toContain("data:image/png");
  });

  it("gives up after one retry with a clear error", async () => {
    fakeBaseten(["sorry, I cannot", "still no"]);
    await expect(openJson(z.object({ x: z.number() }), { system: "s", user: "u", shape: "{}", maxTokens: 50, timeoutMs: 1000, purpose: "test" })).rejects.toThrow(/did not return valid JSON/);
  });

  it("is unavailable without a key", () => {
    vi.stubEnv("BASETEN_API_KEY", "");
    expect(privateBuilderAi().available).toBe(false);
  });

  it("runs blueprint → reading → draft → validated spec on the open-weight model, with no web research", async () => {
    const requests = fakeBaseten(["```json\n" + JSON.stringify(READING) + "\n```", JSON.stringify(DRAFT)]);
    const events: BuilderEvent[] = [];
    const input = { requirements: "Bottled water plant", site: { name: "", industry: "beverage", location: "" }, templateId: null, blueprint: { data: "AAAA", mimeType: "image/png", fileName: "plan.png" }, research: true };
    for await (const e of runBuilder(input, privateBuilderAi())) events.push(e);

    expect(requests).toHaveLength(2); // reading + draft; nothing else is called
    expect(events.find((e) => e.type === "stage" && e.stage === "research")).toMatchObject({ status: "skipped", summary: expect.stringMatching(/Plant-private/) });
    const reading = events.find((e) => e.type === "reading");
    expect(reading && reading.type === "reading" && reading.reading.elements.find((x) => x.id === "e3")?.archetype).toBeNull();
    const draft = events.find((e) => e.type === "draft");
    expect(draft && draft.type === "draft" && draft.mode).toBe("ai");
    const validation = events.find((e) => e.type === "validation");
    expect(validation && validation.type === "validation" && validation.result.ok).toBe(true);
    const spec = draft && draft.type === "draft" ? draft.spec : null;
    const filler = spec?.lines[0].machines.find((m) => m.name === "Filler F-1");
    expect(filler?.prov.source).toBe("blueprint");
    expect(filler?.box).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  });
});
