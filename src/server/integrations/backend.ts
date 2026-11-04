import "server-only";
import { isServerless } from "@/server/runtime";
import { setting } from "@/server/settings";

/** The Python intelligence backend (FastAPI): URL from Integrations, the environment, or localhost in development. */
export const intelligenceBackend = {
  url: () => (setting("INTELLIGENCE_BACKEND_URL") || process.env.INTELLIGENCE_BACKEND_URL || (isServerless() ? "" : "http://localhost:8000")).replace(/\/+$/, ""),
  configured: () => !!intelligenceBackend.url(),
};

/** Paths the web app may call on the backend (everything else is refused by the proxy). */
export const BACKEND_ALLOWED = [/^api\/v1\//, /^ai\/status$/, /^health$/, /^ready$/];

const authHeader = (): Record<string, string> => {
  const t = setting("INTELLIGENCE_BACKEND_TOKEN");
  return t ? { authorization: `Bearer ${t}` } : {};
};

export async function testIntelligenceBackend(): Promise<{ ok: boolean; detail: string }> {
  const base = intelligenceBackend.url();
  if (!base) return { ok: false, detail: "Not configured (INTELLIGENCE_BACKEND_URL)." };
  const started = Date.now();
  try {
    const [health, ai] = await Promise.all([
      fetch(`${base}/ready`, { signal: AbortSignal.timeout(8000), cache: "no-store", headers: authHeader() }).then((r) => r.json() as Promise<{ status?: string; database?: string }>),
      fetch(`${base}/ai/status`, { signal: AbortSignal.timeout(8000), cache: "no-store", headers: authHeader() }).then((r) => r.json() as Promise<{ enabled?: boolean; reason?: string | null }>),
    ]);
    return { ok: health.status === "READY", detail: `${base} · ${health.database ?? "database ?"} · Meta Model API ${ai.enabled ? "on" : `off (${ai.reason ?? "?"})`} · ${Date.now() - started} ms` };
  } catch (e) {
    return { ok: false, detail: `${base} unreachable: ${e instanceof Error ? e.message : String(e)}` };
  }
}
