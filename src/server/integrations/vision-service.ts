import "server-only";
import { setting } from "@/server/settings";

/**
 * Client for the Python vision service (services/vision, FastAPI + OpenCV).
 *
 * Local:   VISION_SERVICE_URL=http://localhost:8080 (no auth).
 * Compose: VISION_SERVICE_URL=http://vision:8080 and the same VISION_SERVICE_TOKEN on both sides;
 *          requests carry Authorization: Bearer <token>.
 */

export const visionService = {
  url: () => (setting("VISION_SERVICE_URL") ?? "").replace(/\/+$/, ""),
  configured: () => !!setting("VISION_SERVICE_URL"),
};

/** Shared bearer token (VISION_SERVICE_TOKEN), when the service requires one. */
async function authHeaders(_base: string): Promise<Record<string, string>> {
  const token = setting("VISION_SERVICE_TOKEN");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export class VisionServiceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: { method: "GET" | "POST"; body?: FormData; timeoutMs: number }): Promise<{ data: T; latencyMs: number }> {
  const base = visionService.url();
  if (!base) throw new VisionServiceError("Vision service is not configured (VISION_SERVICE_URL).", 503);
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method,
      body: init.body,
      headers: await authHeaders(base),
      signal: AbortSignal.timeout(init.timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? `timed out after ${init.timeoutMs} ms` : e.message) : String(e);
    throw new VisionServiceError(`Vision service unreachable: ${msg}`, 502);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page (e.g. a 403 from a reverse proxy) */
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | null)?.detail;
    const msg = typeof detail === "string" ? detail : Array.isArray(detail) ? "Invalid request to the vision service" : `Vision service returned ${res.status}`;
    // Pass client errors (bad file, too large, wrong type) through; anything else is a gateway failure.
    throw new VisionServiceError(msg, res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403 ? res.status : 502);
  }
  return { data: data as T, latencyMs: Date.now() - started };
}

export async function inspectWithService<T>(kind: "image" | "video", form: FormData) {
  return call<T>(`/v1/inspect/${kind}`, { method: "POST", body: form, timeoutMs: kind === "video" ? 120_000 : 45_000 });
}

export async function testVisionService(): Promise<{ ok: boolean; detail: string }> {
  const { data, latencyMs } = await call<{ status: string; engine: string; version: string }>("/health", { method: "GET", timeoutMs: 15_000 });
  return { ok: data.status === "ok", detail: `${visionService.url()} · ${data.engine} · v${data.version} · ${latencyMs} ms` };
}
