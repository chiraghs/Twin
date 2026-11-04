import { DomainError } from "@/domain/errors";
import { BACKEND_ALLOWED, intelligenceBackend } from "@/server/integrations/backend";
import { recordCheck } from "@/server/integrations/status";
import { errorResponse } from "@/server/http";
import { ensureFreshSettings, setting } from "@/server/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

type Ctx = { params: Promise<{ path: string[] }> };
const MAX_BODY = 16 * 1024 * 1024;

/**
 * Proxy to the Python intelligence backend. The browser only ever talks to this app; the backend
 * URL stays server-side, and only allow-listed paths are forwarded.
 */
async function proxy(req: Request, ctx: Ctx) {
  try {
    await ensureFreshSettings();
    const { path } = await ctx.params;
    const rel = path.map(encodeURIComponent).join("/");
    if (!BACKEND_ALLOWED.some((re) => re.test(rel))) throw new DomainError(`Path /${rel} is not available through the proxy`, 404);
    const base = intelligenceBackend.url();
    if (!base) throw new DomainError("The intelligence backend is not configured (Integrations → Intelligence backend).", 503);
    const url = `${base}/${rel}${new URL(req.url).search}`;
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
    if (body && body.byteLength > MAX_BODY) throw new DomainError("Request is larger than 16 MB", 413);
    const headers: Record<string, string> = {};
    const token = setting("INTELLIGENCE_BACKEND_TOKEN");
    if (token) headers.authorization = `Bearer ${token}`;
    const ct = req.headers.get("content-type");
    if (ct) headers["content-type"] = ct;
    let res: Response;
    try {
      res = await fetch(url, { method: req.method, headers, body, signal: AbortSignal.timeout(140_000), cache: "no-store" });
    } catch (e) {
      recordCheck("intelligence-backend", false, `${base} unreachable: ${e instanceof Error ? e.message : String(e)}`);
      throw new DomainError(`The intelligence backend at ${base} is not reachable. Start it with: uvicorn backend.main:app --port 8000`, 502);
    }
    if (res.status < 500) recordCheck("intelligence-backend", true, `${base} · last call ${req.method} /${rel} → ${res.status}`);
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
