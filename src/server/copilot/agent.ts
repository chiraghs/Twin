import "server-only";
import { checkGrounding } from "@/domain/tools/grounding";
import { callTwinTool, TWIN_TOOLS, type TwinToolName } from "@/domain/tools/twin-tools";
import { aiConfig, modelLabel, recordAiCall, recordAiError, recordAiSuccess, type AiConfig } from "@/server/ai/config";
import { chatOnce, errorMessage, withRetry, type ChatMessage, type ChatTool } from "@/server/ai/llm";
import { setting } from "@/server/settings";
import { serverToolStore } from "@/server/tools/store";
import { objectSchema } from "./schema";
import type { CopilotEvent } from "@/lib/contracts";

/**
 * Twin Copilot: a multi-agent system running natively on Meta's Muse Spark (Meta Model API,
 * Responses API function calling).
 *
 *   twin_copilot (coordinator)
 *     ├─ maintenance_analyst  → list_assets, diagnose_asset, list_incidents, get_latest_analysis
 *     ├─ quality_analyst      → get_quality, get_camera_view
 *     ├─ planning_analyst     → get_orders, get_inventory, run_what_if
 *     └─ get_plant_overview, search_audit, propose_plan (human confirmation gate)
 *
 * Specialists are exposed to the coordinator as tools; each runs its own tool loop. Every tool is
 * a deterministic Twin function; the model explains, it never computes the numbers. Answers are
 * checked for figures that cannot be traced to a tool result.
 */

export const ACTOR = "Twin Copilot (Muse Spark)";
const MAX_STEPS = 8;

export type { CopilotEvent };

interface AgentDef {
  name: string;
  description: string;
  instruction: string;
  tools: TwinToolName[];
  specialists?: AgentDef[];
}

const SPECIALIST_RULES = [
  "Use your tools to answer. Report only figures that appear in tool results, with their units; never estimate or invent numbers.",
  "Keep ids (asset, order, camera ids) exactly as the tools return them. Times are relative to now (h+N).",
  "The data comes from a deterministic plant model with simulated demo data; say 'estimate' for forecasts.",
  "Reply in at most 6 short bullet points for the coordinator. Do not address the end user.",
].join("\n");

const SPECIALISTS: AgentDef[] = [
  {
    name: "maintenance_analyst",
    description: "Diagnoses machine condition: health, vibration and temperature trends, time to alarm or trip, incidents and the last multi-agent analysis.",
    instruction: `You are the maintenance analyst for a factory digital twin. Find the machines at risk and explain their condition with evidence.\n${SPECIALIST_RULES}`,
    tools: ["list_assets", "diagnose_asset", "list_incidents", "get_latest_analysis"],
  },
  {
    name: "quality_analyst",
    description: "Explains inspection results: first-pass yield, reject rates, defect Pareto, camera views, and links between machine condition and rejects.",
    instruction: `You are the quality analyst. Explain what the inspection stations and cameras show and what is driving rejects.\n${SPECIALIST_RULES}`,
    tools: ["get_quality", "get_camera_view"],
  },
  {
    name: "planning_analyst",
    description: "Evaluates delivery risk and operating plans: customer orders, inventory coverage, and what-if simulation of maintenance, speed and reroute options.",
    instruction: `You are the planning analyst. Use what-if simulation to compare plans; state the ranking and the trade-offs in delivery, cost and risk.\n${SPECIALIST_RULES}`,
    tools: ["get_orders", "get_inventory", "run_what_if"],
  },
];

const COORDINATOR: AgentDef = {
  name: "twin_copilot",
  description: "Coordinator for the Twin industrial digital twin.",
  instruction: [
    "You are Twin Copilot, the operations assistant for an industrial digital twin. You coordinate three specialists (maintenance_analyst, quality_analyst, planning_analyst) and have your own tools.",
    "Ground every answer in tool results: call get_plant_overview for general questions and delegate to the specialists for diagnosis, quality and planning. Do not answer factual questions from memory.",
    "Report only figures that appear in tool or specialist results. Never invent or estimate numbers yourself. If something is unknown, say so.",
    "The twin runs on a deterministic plant model with simulated demo data. Forecasts are model estimates.",
    "You cannot control equipment, approve, execute or roll back anything. If the user explicitly asks to propose or submit a plan, call propose_plan; it pauses for the user's confirmation and then creates a pending recommendation that a person must approve in Approvals. Never call propose_plan unprompted.",
    "Answer concisely in plain language: a one-line answer first, then up to 5 bullets with the key evidence (with ids and units). Use h+N for times.",
  ].join("\n"),
  tools: ["get_plant_overview", "search_audit", "propose_plan"],
  specialists: SPECIALISTS,
};

const twinTool = (name: TwinToolName): ChatTool => {
  const t = TWIN_TOOLS.find((x) => x.name === name)!;
  return { name: t.name, description: t.description, parameters: objectSchema(t.shape) };
};
const specialistTool = (a: AgentDef): ChatTool => ({
  name: a.name,
  description: a.description,
  parameters: { type: "object", properties: { request: { type: "string", description: "What the specialist should find out." } }, required: ["request"] },
});
const needsConfirmation = (name: string) => TWIN_TOOLS.find((t) => t.name === name)?.effect === "propose";

function preview(v: unknown) {
  const s = JSON.stringify(v) ?? "";
  return s.length > 240 ? `${s.slice(0, 240)}…` : s;
}

interface PendingConfirmation {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}
interface Session {
  messages: ChatMessage[];
  pending: PendingConfirmation | null;
  evidence: unknown[];
  busy: boolean;
}

const g = globalThis as unknown as { __twinCopilot?: { config: string; sessions: Map<string, Session> } };

function sessions(cfg: AiConfig) {
  const config = [cfg.provider, cfg.model, cfg.baseUrl, (setting("MODEL_API_KEY") ?? "").slice(-6)].join("|");
  // Start conversations over when the AI settings change in Integrations.
  if (!g.__twinCopilot || g.__twinCopilot.config !== config) g.__twinCopilot = { config, sessions: new Map() };
  return g.__twinCopilot.sessions;
}

export function copilotInfo() {
  const cfg = aiConfig();
  return {
    available: cfg.provider !== "none",
    model: cfg.provider === "none" ? null : modelLabel(cfg),
    framework: "Twin agent runtime on Meta Model API (Muse Spark function calling)",
    agents: [
      { name: "twin_copilot", role: "Coordinator", tools: ["get_plant_overview", "search_audit", "propose_plan (needs your confirmation)"] },
      ...SPECIALISTS.map((s) => ({ name: s.name, role: s.description.split(":")[0], tools: s.tools })),
    ],
  };
}

type Emit = (e: CopilotEvent) => void;

async function modelTurn(cfg: AiConfig, agent: AgentDef, messages: ChatMessage[]) {
  const tools = [...agent.tools.map(twinTool), ...(agent.specialists ?? []).map(specialistTool)];
  const started = Date.now();
  recordAiCall();
  try {
    const r = await withRetry(() => chatOnce(cfg, { system: agent.instruction, messages, tools, maxOutputTokens: 4096, thinkingLow: true, timeoutMs: cfg.timeoutMs }));
    recordAiSuccess(Date.now() - started);
    return r;
  } catch (e) {
    recordAiError(errorMessage(e));
    throw e;
  }
}

/** Execute one deterministic Twin tool and record its result as grounding evidence. */
function runTool(name: string, args: Record<string, unknown>, evidence: unknown[]) {
  try {
    const result = callTwinTool(serverToolStore, name as TwinToolName, args, ACTOR);
    evidence.push(result);
    return { result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run an agent's tool loop until it answers in text, or pauses for a confirmation (coordinator only).
 * Returns the final text, or null when paused.
 */
async function runAgent(cfg: AiConfig, agent: AgentDef, messages: ChatMessage[], emit: Emit, session: Session | null, evidence: unknown[]): Promise<string | null> {
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await modelTurn(cfg, agent, messages);
    messages.push({ role: "assistant", parts: [...(r.text ? [{ type: "text" as const, text: r.text }] : []), ...r.toolCalls.map((c) => ({ type: "tool_call" as const, ...c }))] });
    if (!r.toolCalls.length) return r.text;

    const results: ChatMessage["parts"] = [];
    let paused: PendingConfirmation | null = null;
    for (const call of r.toolCalls) {
      if (paused) {
        results.push({ type: "tool_result", id: call.id, name: call.name, result: { skipped: true, message: "Waiting for the user's confirmation first." } });
        continue;
      }
      const specialist = agent.specialists?.find((s) => s.name === call.name);
      if (specialist) {
        emit({ type: "tool_call", agent: agent.name, tool: call.name, args: call.args });
        const request = String(call.args.request ?? "");
        const text = await runAgent(cfg, specialist, [{ role: "user", parts: [{ type: "text", text: request || "Report what you find." }] }], emit, null, evidence);
        emit({ type: "tool_result", agent: agent.name, tool: call.name, ok: !!text, preview: preview(text ?? "") });
        results.push({ type: "tool_result", id: call.id, name: call.name, result: text ?? "No result." });
      } else if (needsConfirmation(call.name) && session) {
        // Pause: the person must confirm before a recommendation is created.
        paused = { callId: call.id, name: call.name, args: call.args };
      } else if (!agent.tools.includes(call.name as TwinToolName) || needsConfirmation(call.name)) {
        results.push({ type: "tool_result", id: call.id, name: call.name, result: { error: `Tool ${call.name} is not available to ${agent.name}.` } });
      } else {
        emit({ type: "tool_call", agent: agent.name, tool: call.name, args: call.args });
        const out = runTool(call.name, call.args, evidence);
        emit({ type: "tool_result", agent: agent.name, tool: call.name, ok: !("error" in out), preview: preview(out) });
        results.push({ type: "tool_result", id: call.id, name: call.name, result: out });
      }
    }
    if (paused && session) {
      if (results.length) messages.push({ role: "user", parts: results });
      session.pending = paused;
      emit({ type: "confirm", callId: paused.callId, tool: paused.name, args: paused.args, hint: "Create a pending recommendation for a person to approve?" });
      return null;
    }
    messages.push({ role: "user", parts: results });
  }
  return "I couldn't finish within the step limit. Please ask a narrower question.";
}

export type CopilotInput = { sessionId: string; message?: string; confirm?: { callId: string; confirmed: boolean } };

/** Run one copilot turn and stream its events. */
export async function* runCopilot(input: CopilotInput): AsyncGenerator<CopilotEvent> {
  const cfg = aiConfig();
  if (cfg.provider === "none") {
    yield { type: "error", message: "The copilot needs Meta Model API, which is turned off or not configured on this server (Integrations → Meta Model API). The MCP tools still work without it." };
    return;
  }
  const all = sessions(cfg);
  let session = all.get(input.sessionId);
  if (!session) {
    session = { messages: [], pending: null, evidence: [], busy: false };
    all.set(input.sessionId, session);
    if (all.size > 200) all.delete(all.keys().next().value!);
  }
  if (session.busy) {
    yield { type: "error", message: "The copilot is still answering your previous message." };
    return;
  }
  session.busy = true;

  const queue: CopilotEvent[] = [];
  let wake = null as (() => void) | null;
  const emit: Emit = (e) => {
    queue.push(e);
    wake?.();
  };
  let finished = false;
  const s = session;

  const work = (async () => {
    try {
      emit({ type: "start", sessionId: input.sessionId });
      if (input.confirm) {
        const p = s.pending;
        if (!p || p.callId !== input.confirm.callId) throw new Error("There is no pending confirmation with that id.");
        s.pending = null;
        let result: unknown;
        if (input.confirm.confirmed) {
          emit({ type: "tool_call", agent: COORDINATOR.name, tool: p.name, args: p.args });
          result = runTool(p.name, p.args, s.evidence);
          emit({ type: "tool_result", agent: COORDINATOR.name, tool: p.name, ok: !("error" in (result as object)), preview: preview(result) });
        } else result = { declined: true, message: "The user declined; nothing was created." };
        s.messages.push({ role: "user", parts: [{ type: "tool_result", id: p.callId, name: p.name, result }] });
      } else {
        if (s.pending) {
          s.messages.push({ role: "user", parts: [{ type: "tool_result", id: s.pending.callId, name: s.pending.name, result: { declined: true, message: "The user moved on without confirming." } }] });
          s.pending = null;
        }
        s.evidence.push(input.message);
        s.messages.push({ role: "user", parts: [{ type: "text", text: input.message ?? "" }] });
      }
      const answer = await runAgent(cfg, COORDINATOR, s.messages, emit, s, s.evidence);
      if (s.messages.length > 60) s.messages.splice(0, s.messages.length - 60);
      if (s.evidence.length > 400) s.evidence.splice(0, s.evidence.length - 400);
      if (answer) emit({ type: "answer", text: answer, grounding: checkGrounding(answer, s.evidence) });
    } catch (e) {
      emit({ type: "error", message: e instanceof Error ? e.message.slice(0, 400) : String(e) });
    } finally {
      finished = true;
      wake?.();
    }
  })();

  try {
    while (!finished || queue.length) {
      if (!queue.length) await new Promise<void>((r) => (wake = r));
      wake = null;
      while (queue.length) yield queue.shift()!;
    }
    await work;
    yield { type: "done" };
  } finally {
    s.busy = false;
  }
}
