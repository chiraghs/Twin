"use client";

import { useCallback, useEffect, useState } from "react";

/** Calls to the Python intelligence backend through this app's proxy (/api/backend/*). */
export async function bk<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/backend/${path.replace(/^\/+/, "")}`, {
    ...rest,
    ...(json !== undefined ? { method: rest.method ?? "POST", headers: { "content-type": "application/json", ...(rest.headers ?? {}) }, body: JSON.stringify(json) } : {}),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!res.ok) {
    const d = data as { error?: string; detail?: unknown } | null;
    throw new Error(d?.error ?? (typeof d?.detail === "string" ? d.detail : JSON.stringify(d?.detail ?? res.statusText)).slice(0, 300));
  }
  return data as T;
}

/** GET a backend resource with loading / error state and a reload function. */
export function useBackend<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await bk<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}
