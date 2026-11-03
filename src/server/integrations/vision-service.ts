import "server-only";
import { setting } from "@/server/settings";

/**
 * Client for the Python vision service (services/vision, FastAPI + OpenCV).
 *
 * Local:     VISION_SERVICE_URL=http://localhost:8000 (no auth).
 * Cloud Run: deploy the service with --no-allow-unauthenticated and grant the web app's service
 *            account roles/run.invoker; requests carry a Google-signed ID token for the service URL.
 */

export const visionService = {
  url: () => (setting("VISION_SERVICE_URL") ?? "").replace(/\/+$/, ""),
  configured: () => !!setting("VISION_SERVICE_URL"),
};

const isLocal = (u: string) => {
  try {
    const h = new URL(u).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local");
  } catch {
    return false;
  }
};

async function authHeaders(base: string): Promise<Record<string, string>> {
  if (isLocal(base) || setting("VISION_SERVICE_AUTH") === "none") return {};
  const { GoogleAuth } = await import("google-auth-library");
  const client = await new GoogleAuth().getIdTokenClient(base);
  const h = (await client.getRequestHeaders()) as unknown;
  const authz = h instanceof Headers ? h.get("authorization") : ((h as Record<string, string>).Authorization ?? (h as Record<string, string>).authorization);
  return authz ? { Authorization: authz } : {};
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
    /* non-JSON error page (e.g. a 403 from Cloud Run IAM) */
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
