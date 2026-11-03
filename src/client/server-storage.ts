"use client";

import type { StateStorage } from "zustand/middleware";

/**
 * Zustand persistence backed by the server (SQLite `client_preferences`, per browser) with
 * localStorage as an offline cache. Reads prefer the server copy; a value that only exists
 * locally (saved by an earlier build) is uploaded once. Writes go to both, the server debounced.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const local = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage unavailable */
    }
  },
};

async function put(name: string, raw: string) {
  try {
    await fetch(`/api/prefs/${name}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: JSON.parse(raw) }), keepalive: raw.length < 60_000 });
  } catch {
    /* offline: the local copy is uploaded on the next write */
  }
}

/** Save a preference on the server now (outside a zustand store, e.g. theme). */
export function savePref(name: string, value: unknown) {
  void put(name, JSON.stringify(value));
}

/** Read a preference from the server (null when none, or offline). */
export async function loadPref<T>(name: string): Promise<T | null> {
  try {
    const res = await fetch(`/api/prefs/${name}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { value: T | null }).value;
  } catch {
    return null;
  }
}

export const serverStorage: StateStorage = {
  getItem: async (name) => {
    if (typeof window === "undefined") return null;
    const cached = local.get(name);
    try {
      const res = await fetch(`/api/prefs/${name}`, { cache: "no-store" });
      if (res.ok) {
        const { value } = (await res.json()) as { value: unknown };
        if (value !== null && value !== undefined) {
          const raw = JSON.stringify(value);
          local.set(name, raw);
          return raw;
        }
        if (cached) void put(name, cached); // migrate a value saved before server persistence
        return cached;
      }
    } catch {
      /* offline */
    }
    return cached;
  },
  setItem: (name, value) => {
    local.set(name, value);
    clearTimeout(timers.get(name));
    timers.set(name, setTimeout(() => void put(name, value), 400));
  },
  removeItem: (name) => {
    local.del(name);
    void fetch(`/api/prefs/${name}`, { method: "DELETE" }).catch(() => undefined);
  },
};
