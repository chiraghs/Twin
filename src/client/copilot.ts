"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { serverStorage } from "./server-storage";
import type { CopilotEvent } from "@/lib/contracts";
import { api } from "./api";
import { useFactory } from "./store";

export interface TraceStep {
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean | null;
}

export interface CopilotTurn {
  id: number;
  role: "user" | "copilot";
  text: string;
  trace: TraceStep[];
  grounding?: { figures: number; unverified: string[]; derived: string[] };
  confirm?: { callId: string; tool: string; args: Record<string, unknown>; decided: boolean | null };
  error?: string;
  pending?: boolean;
}

interface CopilotInfo {
  available: boolean;
  model: string | null;
  framework: string;
  agents: { name: string; role: string; tools: string[] }[];
}

interface CopilotStore {
  open: boolean;
  info: CopilotInfo | null;
  sessionId: string;
  turns: CopilotTurn[];
  busy: boolean;
  setOpen: (o: boolean) => void;
  loadInfo: () => Promise<void>;
  ask: (message: string) => Promise<void>;
  confirm: (turnId: number, confirmed: boolean) => Promise<void>;
  reset: () => void;
}

const newSession = () => `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let seq = 1;

export const useCopilot = create<CopilotStore>()(
  persist(
    (set, get) => {
      const update = (id: number, fn: (t: CopilotTurn) => CopilotTurn) => set((s) => ({ turns: s.turns.map((t) => (t.id === id ? fn(t) : t)) }));

      const stream = async (body: Record<string, unknown>) => {
        const id = seq++;
        set((s) => ({ busy: true, turns: [...s.turns, { id, role: "copilot", text: "", trace: [], pending: true }] }));
        let proposed = false;
        try {
          const res = await fetch("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: get().sessionId, ...body }), cache: "no-store" });
          if (!res.ok || !res.body) {
            const d = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new Error(d?.error ?? `Request failed (${res.status})`);
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          const handle = (e: CopilotEvent) => {
            if (e.type === "tool_call") update(id, (t) => ({ ...t, trace: [...t.trace, { agent: e.agent, tool: e.tool, args: e.args, ok: null }] }));
            else if (e.type === "tool_result") {
              if (e.tool === "propose_plan" && e.ok) proposed = true;
              update(id, (t) => {
                const trace = [...t.trace];
                const i = trace.findIndex((x) => x.tool === e.tool && x.ok === null);
                // After a confirmation, the runtime resumes with the tool's result only (its call was in the previous turn).
                if (i >= 0) trace[i] = { ...trace[i], ok: e.ok };
                else trace.push({ agent: e.agent, tool: e.tool, args: {}, ok: e.ok });
                return { ...t, trace };
              });
            } else if (e.type === "confirm") update(id, (t) => ({ ...t, confirm: { callId: e.callId, tool: e.tool, args: e.args, decided: null } }));
            else if (e.type === "answer") update(id, (t) => ({ ...t, text: e.text, grounding: e.grounding }));
            else if (e.type === "error") update(id, (t) => ({ ...t, error: e.message }));
          };
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, i).trim();
              buf = buf.slice(i + 1);
              if (line) handle(JSON.parse(line) as CopilotEvent);
            }
          }
        } catch (e) {
          update(id, (t) => ({ ...t, error: e instanceof Error ? e.message : String(e) }));
        } finally {
          update(id, (t) => ({ ...t, pending: false }));
          set({ busy: false });
          if (proposed) void useFactory.getState().load();
        }
      };

      return {
        open: false,
        info: null,
        sessionId: newSession(),
        turns: [],
        busy: false,
        setOpen: (o) => set({ open: o }),
        loadInfo: async () => {
          try {
            set({ info: await api<CopilotInfo>("/api/copilot") });
          } catch {
            /* shown as unavailable */
          }
        },
        ask: async (message) => {
          if (get().busy || !message.trim()) return;
          set((s) => ({ turns: [...s.turns, { id: seq++, role: "user", text: message.trim(), trace: [] }] }));
          await stream({ message: message.trim() });
        },
        confirm: async (turnId, confirmed) => {
          const turn = get().turns.find((t) => t.id === turnId);
          if (!turn?.confirm || turn.confirm.decided !== null || get().busy) return;
          update(turnId, (t) => ({ ...t, confirm: { ...t.confirm!, decided: confirmed } }));
          await stream({ confirm: { callId: turn.confirm.callId, confirmed } });
        },
        reset: () => set({ sessionId: newSession(), turns: [] }),
      };
    },
    {
      name: "twin-copilot",
      storage: createJSONStorage(() => serverStorage),
      version: 1,
      partialize: (s) => ({ sessionId: s.sessionId, turns: s.turns.slice(-30).map((t) => ({ ...t, pending: false })) }),
      onRehydrateStorage: () => (s) => {
        if (s) seq = Math.max(1, ...s.turns.map((t) => t.id + 1));
      },
    },
  ),
);
