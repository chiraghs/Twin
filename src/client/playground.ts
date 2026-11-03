"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { serverStorage } from "./server-storage";
import { applyOps, type SpecOp } from "@/domain/builder/ops";
import { TwinSpecSchema, type Prov, type TwinSpec } from "@/domain/builder/spec";
import type { ValidationResult } from "@/domain/builder/validate";
import type { FactoryState } from "@/domain/types";
import { api } from "./api";
import { useFactory, useUi } from "./store";

export type PlaygroundSelection = { kind: "machine" | "line" | "fleet" | "rule" | "belt"; id: string } | null;

export interface PlaygroundTurn {
  role: "user" | "agent";
  text: string;
  applied?: string[];
  rejected?: string[];
}

interface PlaygroundStore {
  /** The sandbox copy being edited. Nothing here touches the live twin until Apply. */
  spec: TwinSpec | null;
  /** Where the draft started ("Live twin: …" or a template name). */
  source: string | null;
  dirty: boolean;
  past: TwinSpec[];
  future: TwinSpec[];
  selection: PlaygroundSelection;
  chat: PlaygroundTurn[];
  busy: { ai: boolean; apply: boolean };
  load: (spec: TwinSpec, source: string) => void;
  edit: (ops: SpecOp[], note?: string) => { applied: string[]; rejected: string[] };
  undo: () => void;
  redo: () => void;
  select: (s: PlaygroundSelection) => void;
  ask: (instruction: string) => Promise<void>;
  apply: () => Promise<boolean>;
}

const HISTORY = 60;
const userProv = (note: string): Prov => ({ source: "user", note, refs: [] });

export const usePlayground = create<PlaygroundStore>()(
  persist(
    (set, get) => ({
      spec: null,
      source: null,
      dirty: false,
      past: [],
      future: [],
      selection: null,
      chat: [],
      busy: { ai: false, apply: false },

      load: (spec, source) => set({ spec: structuredClone(spec), source, dirty: false, past: [], future: [], selection: null, chat: [] }),

      edit: (ops, note = "Edited in the playground.") => {
        const spec = get().spec;
        if (!spec || !ops.length) return { applied: [], rejected: [] };
        const r = applyOps(spec, ops, userProv(note));
        if (r.rejected.length) useFactory.getState().toast({ tone: "error", title: r.rejected[0].replace(/^\w+: /, "") });
        if (r.applied.length) set((s) => ({ spec: r.spec, past: [...s.past, spec].slice(-HISTORY), future: [], dirty: true }));
        return { applied: r.applied, rejected: r.rejected };
      },

      undo: () => {
        const { past, spec, future } = get();
        if (!past.length || !spec) return;
        set({ spec: past[past.length - 1], past: past.slice(0, -1), future: [spec, ...future].slice(0, HISTORY), dirty: true });
      },
      redo: () => {
        const { past, spec, future } = get();
        if (!future.length || !spec) return;
        set({ spec: future[0], future: future.slice(1), past: [...past, spec].slice(-HISTORY), dirty: true });
      },

      select: (selection) => set({ selection }),

      ask: async (instruction) => {
        const spec = get().spec;
        if (!spec) return;
        set((s) => ({ chat: [...s.chat, { role: "user", text: instruction }], busy: { ...s.busy, ai: true } }));
        try {
          const r = await api<{ spec: TwinSpec; applied: string[]; rejected: string[]; explanation: string; validation: ValidationResult }>("/api/builder/refine", { body: { spec, instruction } });
          set((s) => ({
            ...(r.applied.length ? { spec: r.spec, past: [...s.past, spec].slice(-HISTORY), future: [], dirty: true } : {}),
            chat: [...s.chat, { role: "agent", text: r.explanation || (r.applied.length ? "Done." : "No changes made."), applied: r.applied, rejected: r.rejected }],
          }));
        } catch (e) {
          set((s) => ({ chat: [...s.chat, { role: "agent", text: e instanceof Error ? e.message : String(e), rejected: [] }] }));
        } finally {
          set((s) => ({ busy: { ...s.busy, ai: false } }));
        }
      },

      apply: async () => {
        const spec = get().spec;
        if (!spec) return false;
        set((s) => ({ busy: { ...s.busy, apply: true } }));
        const r = await useFactory.getState().run(
          "playgroundApply",
          async () => {
            const state = await api<FactoryState>("/api/builder/build", { body: { spec, by: useUi.getState().operator } });
            useFactory.getState().apply(state);
            useUi.getState().clearHighlight();
            useUi.getState().resetLayout();
            return state;
          },
          (s) => `${s.profile.name}: playground layout applied (${s.assets.length} machines${s.rules?.length ? `, ${s.rules.length} rules` : ""})`,
        );
        set((s) => ({ busy: { ...s.busy, apply: false }, ...(r ? { dirty: false, source: `Live twin: ${r.profile.name}` } : {}) }));
        return !!r;
      },
    }),
    {
      name: "twin-playground",
      storage: createJSONStorage(() => serverStorage),
      version: 1,
      partialize: (s) => ({ spec: s.spec, source: s.source, dirty: s.dirty, chat: s.chat.slice(-20) }),
      // A draft saved by an older build is dropped rather than half-loaded.
      merge: (persisted, current) => {
        const p = persisted as Partial<PlaygroundStore> | undefined;
        const ok = p?.spec ? TwinSpecSchema.safeParse(p.spec).success : false;
        return ok ? { ...current, spec: p!.spec!, source: p!.source ?? null, dirty: !!p!.dirty, chat: p!.chat ?? [] } : current;
      },
    },
  ),
);
