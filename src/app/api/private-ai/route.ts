import { json, route } from "@/server/http";
import { baseten, OpenModelError, openChat } from "@/server/private-ai/baseten";

export const dynamic = "force-dynamic";

/** Plant-Private AI status: is the open-weight model configured (no secrets returned). */
export const GET = route(async () =>
  json({
    configured: baseten.configured(),
    provider: "Baseten",
    model: baseten.model(),
    endpoint: new URL(baseten.baseUrl()).host,
    label: baseten.label(),
  }),
);

/** Test connection: one tiny real call to Muse Spark Open. */
export const POST = route(async () => {
  try {
    const r = await openChat({
      system: "You are a connection check.",
      user: "Reply with exactly: OK",
      maxTokens: 64,
      timeoutMs: 60_000,
      purpose: "connection test",
    });
    return json({ ok: true, model: r.model, latencyMs: r.latencyMs, reply: r.text.trim().slice(0, 40) });
  } catch (e) {
    const err = e instanceof OpenModelError ? e : new OpenModelError(String(e));
    return json({ ok: false, error: err.message }, err.status === 503 ? 503 : 200);
  }
});
