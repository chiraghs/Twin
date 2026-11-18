"use client";

import { create } from "zustand";
import type { SavedView, SavedViewKind, Vec3 } from "@/domain/views";
import { api } from "./api";

/**
 * Saved 3D viewpoints, plus a request channel the 3D view obeys: fly to a pose, focus an object.
 * Anything can drive the 3D view through it: the views menu, the camera wall, or the copilot.
 */
type RequestBody = { kind: "pose"; position: Vec3; target: Vec3 } | { kind: "focus"; id: string } | { kind: "reset" };
/** `source: "copilot"` requests also bring the user to the 3D twin if they are elsewhere. */
export type View3dRequest = RequestBody & { nonce: number; source: "user" | "copilot" };

interface View3dStore {
  /** Uploaded models per machine type: kind → version (upload time), for cache-busting. */
  models: Record<string, string>;
  modelsFor: string | null;
  loadModels: (facilityId: string, force?: boolean) => Promise<void>;
  /** Machines whose live panel is pinned in the 3D view (per facility). */
  pinned: Record<string, string[]>;
  togglePin: (facilityId: string, assetId: string) => void;
  facilityId: string | null;
  views: SavedView[];
  loaded: boolean;
  request: View3dRequest | null;
  load: (force?: boolean) => Promise<void>;
  save: (input: { name: string; kind: SavedViewKind; position: Vec3; target: Vec3; by: string }) => Promise<SavedView>;
  remove: (id: string) => Promise<void>;
  go: (r: RequestBody, source?: View3dRequest["source"]) => void;
  /** The 3D view calls this once it has acted on a request, so it isn't replayed on the next mount. */
  consume: (nonce: number) => void;
}

let nonce = 1;

const PIN_KEY = "twin-3d-pinned";
function storedPins(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(PIN_KEY) ?? "{}") as Record<string, string[]>;
  } catch {
    return {};
  }
}

export const useView3d = create<View3dStore>((set, get) => ({
  models: {},
  modelsFor: null,
  loadModels: async (facilityId, force = false) => {
    if (get().modelsFor === facilityId && !force) return;
    try {
      const r = await api<{ facilityId: string; models: { kind: string; uploadedAt: string }[] }>("/api/models");
      set({ modelsFor: r.facilityId, models: Object.fromEntries(r.models.map((m) => [m.kind, m.uploadedAt])) });
    } catch {
      set({ modelsFor: facilityId, models: {} });
    }
  },
  pinned: typeof window === "undefined" ? {} : storedPins(),
  togglePin: (facilityId, assetId) =>
    set((s) => {
      const cur = s.pinned[facilityId] ?? [];
      const next = { ...s.pinned, [facilityId]: cur.includes(assetId) ? cur.filter((x) => x !== assetId) : [...cur, assetId].slice(-6) };
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify(next));
      } catch {
        /* not remembered, still shown */
      }
      return { pinned: next };
    }),
  facilityId: null,
  views: [],
  loaded: false,
  request: null,
  load: async (force = false) => {
    if (get().loaded && !force) return;
    try {
      const r = await api<{ facilityId: string; views: SavedView[] }>("/api/views");
      set({ facilityId: r.facilityId, views: r.views, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  save: async (input) => {
    const r = await api<{ view: SavedView }>("/api/views", { body: input });
    set((s) => ({ views: [...s.views, r.view] }));
    return r.view;
  },
  remove: async (id) => {
    await api(`/api/views/${encodeURIComponent(id)}`, { method: "DELETE" });
    set((s) => ({ views: s.views.filter((v) => v.id !== id) }));
  },
  go: (r, source = "user") => set({ request: { ...r, nonce: nonce++, source } }),
  consume: (n) => set((s) => (s.request?.nonce === n ? { request: null } : s)),
}));
