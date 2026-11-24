/**
 * Meta Model API relay. The web app and backend run in Singapore, where the Meta Model API
 * answers "model not found"; this service runs in a US region and forwards their calls to
 * https://api.meta.ai unchanged. The callers' own Authorization header is passed through; the
 * relay holds no API key. Only paths under /<RELAY_SECRET>/v1/ are forwarded, so it is not an
 * open proxy. Set META_API_BASE=https://<this service>/<RELAY_SECRET>/v1 on the callers.
 */
import http from "node:http";

const UPSTREAM = "https://api.meta.ai";
const SECRET = process.env.RELAY_SECRET ?? "";
const PASS = ["authorization", "content-type", "accept"];

http
  .createServer(async (req, res) => {
    if (req.url === "/healthz") return res.end("ok");
    const prefix = `/${SECRET}/`;
    if (!SECRET || !req.url?.startsWith(prefix)) {
      res.statusCode = 404;
      return res.end();
    }
    const path = "/" + req.url.slice(prefix.length);
    if (!path.startsWith("/v1/")) {
      res.statusCode = 404;
      return res.end();
    }
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = {};
      for (const h of PASS) if (req.headers[h]) headers[h] = req.headers[h];
      const up = await fetch(UPSTREAM + path, {
        method: req.method,
        headers,
        body: chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined,
      });
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") ?? "application/json" });
      // Streams (server-sent events) are passed on as they arrive.
      if (up.body) for await (const c of up.body) res.write(c);
      res.end();
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: `Relay could not reach the Meta Model API: ${e?.message ?? e}` } }));
    }
  })
  .listen(Number(process.env.PORT || 10000), () => console.log("meta relay listening"));
