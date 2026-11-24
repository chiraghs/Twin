/**
 * Meta Model API relay on Vercel (same job as ../relay on Render). Forwards
 * /<RELAY_SECRET>/v1/... to https://api.meta.ai/v1/... with the caller's own Authorization header;
 * holds no API key. vercel.json sends every path here as ?p=<path>.
 * Set META_API_BASE=https://<project>.vercel.app/<RELAY_SECRET>/v1 on twin-web and twin-backend.
 */
const UPSTREAM = "https://api.meta.ai";
const PASS = ["authorization", "content-type", "accept"];

async function handle(request) {
  const secret = process.env.RELAY_SECRET ?? "";
  const url = new URL(request.url);
  const p = "/" + (url.searchParams.get("p") ?? "").replace(/^\/+/, "");
  if (p === "/healthz") return new Response("ok");
  const prefix = `/${secret}/`;
  if (!secret || !p.startsWith(prefix)) return new Response(null, { status: 404 });
  const path = "/" + p.slice(prefix.length);
  if (!path.startsWith("/v1/")) return new Response(null, { status: 404 });
  const headers = {};
  for (const h of PASS) {
    const v = request.headers.get(h);
    if (v) headers[h] = v;
  }
  try {
    const up = await fetch(UPSTREAM + path, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    });
    return new Response(up.body, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json" } });
  } catch (e) {
    return Response.json({ error: { message: `Relay could not reach the Meta Model API: ${e?.message ?? e}` } }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
