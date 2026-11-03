"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { serverStorage } from "./server-storage";
import type { BlueprintReading, ResearchResult } from "@/domain/builder/draft";
import { applyOps, type SpecOp } from "@/domain/builder/ops";
import type { BuilderEvent, BuilderStage } from "@/domain/builder/pipeline";
import type { TwinSpec } from "@/domain/builder/spec";
import { validateSpec, type ValidationResult } from "@/domain/builder/validate";
import type { FactoryState } from "@/domain/types";
import { ApiError, api } from "./api";
import { useFactory, useUi } from "./store";

export interface BuilderMeta {
  ai: { available: boolean; provider: string; model: string | null; missing: string[] };
  templates: { id: string; name: string; industry: string; description: string; spec: TwinSpec }[];
  archetypes: { kind: string; name: string; covers: string; rateRange: [number, number] }[];
  integrationKinds: string[];
}

type StageState = { status: "pending" | "running" | "done" | "skipped" | "error"; summary?: string };
const STAGES: BuilderStage[] = ["read", "research", "draft", "validate"];
const freshStages = (): Record<BuilderStage, StageState> => Object.fromEntries(STAGES.map((s) => [s, { status: "pending" }])) as Record<BuilderStage, StageState>;

export interface ChatTurn {
  role: "user" | "agent";
  text: string;
  applied?: string[];
  rejected?: string[];
}

interface BuilderStore {
  meta: BuilderMeta | null;
  input: { requirements: string; name: string; industry: string; location: string; templateId: string | null; research: boolean };
  blueprint: { url: string | null; fileName: string; mimeType: string } | null;
  phase: "start" | "running" | "review";
  stages: Record<BuilderStage, StageState>;
  reading: BlueprintReading | null;
  research: ResearchResult | null;
  spec: TwinSpec | null;
  mode: "ai" | "template" | null;
  validation: ValidationResult | null;
  chat: ChatTurn[];
  busy: { draft: boolean; refine: boolean; build: boolean };
  error: string | null;
  loadMeta: () => Promise<void>;
  setInput: (patch: Partial<BuilderStore["input"]>) => void;
  setBlueprint: (b: BuilderStore["blueprint"]) => void;
  start: (file: File | null) => Promise<void>;
  edit: (ops: SpecOp[]) => string[];
  refine: (instruction: string) => Promise<void>;
  build: () => Promise<boolean>;
  restart: () => void;
}

const empty = { phase: "start" as const, stages: freshStages(), reading: null, research: null, spec: null, mode: null, validation: null, chat: [], error: null };

export const useBuilder = create<BuilderStore>()(
  persist(
    (set, get) => ({
      meta: null,
      input: { requirements: "", name: "", industry: "", location: "", templateId: null, research: true },
      blueprint: null,
      ...empty,
      busy: { draft: false, refine: false, build: false },

      loadMeta: async () => {
        try {
          set({ meta: await api<BuilderMeta>("/api/builder") });
        } catch (e) {
          set({ error: e instanceof Error ? e.message : String(e) });
        }
      },
      setInput: (patch) => set((s) => ({ input: { ...s.input, ...patch } })),
      setBlueprint: (b) => {
        const old = get().blueprint?.url;
        if (old && old !== b?.url) URL.revokeObjectURL(old);
        set({ blueprint: b });
      },

      start: async (file) => {
        const { input } = get();
        set({ ...empty, phase: "running", stages: freshStages(), busy: { ...get().busy, draft: true } });
        const form = new FormData();
        for (const [k, v] of Object.entries(input)) if (v !== null && k !== "research") form.append(k, String(v));
        form.append("research", input.research ? "true" : "false");
        if (file) form.append("blueprint", file);
        try {
          const res = await fetch("/api/builder/draft", { method: "POST", body: form, cache: "no-store" });
          if (!res.ok || !res.body) {
            const d = (await res.json().catch(() => null)) as { error?: string } | null;
            throw new ApiError(d?.error ?? `Request failed (${res.status})`, res.status);
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          const handle = (e: BuilderEvent) => {
            switch (e.type) {
              case "stage":
                set((s) => ({ stages: { ...s.stages, [e.stage]: { status: e.status, summary: e.summary ?? s.stages[e.stage].summary } } }));
                break;
              case "reading":
                set({ reading: e.reading });
                break;
              case "research":
                set({ research: e.research });
                break;
              case "draft":
                set({ spec: e.spec, mode: e.mode });
                break;
              case "validation":
                set({ validation: e.result, spec: e.result.spec ?? get().spec });
                break;
              case "error":
                set({ error: e.message });
                break;
              case "complete":
                set({ phase: e.spec ? "review" : "start" });
                break;
            }
          };
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, i).trim();
              buf = buf.slice(i + 1);
              if (line) handle(JSON.parse(line) as BuilderEvent);
            }
          }
          if (!get().spec) set({ phase: "start", error: get().error ?? Object.values(get().stages).find((s) => s.status === "error")?.summary ?? "The agent could not draft a twin." });
        } catch (e) {
          set({ phase: "start", error: e instanceof Error ? e.message : String(e) });
        } finally {
          set((s) => ({ busy: { ...s.busy, draft: false } }));
        }
      },

      edit: (ops) => {
        const spec = get().spec;
        if (!spec) return ["No spec to edit"];
        const r = applyOps(spec, ops, { source: "user", note: "Edited in the review screen.", refs: [] });
        const v = validateSpec(r.spec);
        set({ spec: v.spec ?? r.spec, validation: v });
        if (r.rejected.length) useFactory.getState().toast({ tone: "error", title: r.rejected[0] });
        return r.rejected;
      },

      refine: async (instruction) => {
        const spec = get().spec;
        if (!spec) return;
        set((s) => ({ chat: [...s.chat, { role: "user", text: instruction }], busy: { ...s.busy, refine: true } }));
        try {
          const r = await api<{ spec: TwinSpec; applied: string[]; rejected: string[]; explanation: string; validation: ValidationResult }>("/api/builder/refine", { body: { spec, instruction } });
          set((s) => ({ spec: r.spec, validation: r.validation, chat: [...s.chat, { role: "agent", text: r.explanation || (r.applied.length ? "Done." : "No changes made."), applied: r.applied, rejected: r.rejected }] }));
        } catch (e) {
          set((s) => ({ chat: [...s.chat, { role: "agent", text: e instanceof Error ? e.message : String(e), rejected: [] }] }));
        } finally {
          set((s) => ({ busy: { ...s.busy, refine: false } }));
        }
      },

      build: async () => {
        const spec = get().spec;
        if (!spec) return false;
        set((s) => ({ busy: { ...s.busy, build: true } }));
        const r = await useFactory.getState().run(
          "buildTwin",
          async () => {
            const state = await api<FactoryState>("/api/builder/build", { body: { spec, by: useUi.getState().operator } });
            useFactory.getState().apply(state);
            useUi.getState().clearHighlight();
            useUi.getState().resetLayout();
            return state;
          },
          (s) => `${s.profile.name}: twin built with ${s.assets.length} machines`,
        );
        set((s) => ({ busy: { ...s.busy, build: false } }));
        return !!r;
      },

      restart: () => {
        get().setBlueprint(null);
        set({ ...empty, stages: freshStages() });
      },
    }),
    {
      name: "twin-builder",
      storage: createJSONStorage(() => serverStorage),
      version: 1,
      // The blueprint file itself is never persisted (object URLs don't survive a reload).
      partialize: (s) => ({ input: s.input, phase: s.phase === "running" ? "start" : s.phase, stages: s.stages, reading: s.reading, research: s.research, spec: s.spec, mode: s.mode, validation: s.validation, chat: s.chat, blueprint: s.blueprint ? { ...s.blueprint, url: null } : null }),
    },
  ),
);
