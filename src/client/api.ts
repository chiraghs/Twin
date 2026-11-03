import type { FactoryState } from "@/domain/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: string[],
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(`Unexpected response from ${path}`, res.status);
  }
  if (!res.ok) {
    const d = data as { error?: string; issues?: string[] } | null;
    throw new ApiError(d?.error ?? `Request failed (${res.status})`, res.status, d?.issues);
  }
  return data as T;
}

/** POST multipart form data (file uploads) with the same error handling as `api`. */
export async function apiForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form, cache: "no-store" });
  const data = (await res.json().catch(() => null)) as (T & { error?: string; issues?: string[] }) | null;
  if (!res.ok || data === null) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.issues);
  return data;
}

/** Stream NDJSON events from a POST endpoint. */
export async function streamNdjson<E>(path: string, onEvent: (e: E) => void, signal?: AbortSignal) {
  const res = await fetch(path, { method: "POST", signal, cache: "no-store" });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as E);
}

export type StateResponse = FactoryState;
