"use client";

import { create } from "zustand";
import { api } from "./api";

export type AdminMode = "passcode" | "open-local" | "locked";

interface AdminStore {
  admin: boolean;
  mode: AdminMode | null;
  loaded: boolean;
  load: () => Promise<void>;
  signIn: (passcode: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

/** Admin session state. The server is the authority: every admin API checks the session cookie itself. */
export const useAdmin = create<AdminStore>((set) => ({
  admin: false,
  mode: null,
  loaded: false,
  load: async () => {
    try {
      const d = await api<{ admin: boolean; mode: AdminMode }>("/api/admin/session");
      set({ admin: d.admin, mode: d.mode, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  signIn: async (passcode) => {
    try {
      const d = await api<{ admin?: boolean; mode?: AdminMode }>("/api/admin/session", { body: { passcode } });
      set({ admin: !!d.admin, mode: d.mode ?? null, loaded: true });
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Sign-in failed";
    }
  },
  signOut: async () => {
    try {
      const d = await api<{ admin?: boolean; mode?: AdminMode }>("/api/admin/session", { method: "DELETE" });
      set({ admin: !!d.admin, mode: d.mode ?? null });
    } catch {
      set({ admin: false });
    }
  },
}));
