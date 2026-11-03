import { DomainError } from "@/domain/errors";
import { clientId } from "@/server/client-id";
import { deletePref, getPref, MAX_PREF_BYTES, NAMESPACE_RE, putPref } from "@/server/db/prefs";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ namespace: string }> };

async function ns(ctx: Ctx) {
  const { namespace } = await ctx.params;
  if (!NAMESPACE_RE.test(namespace)) throw new DomainError("Invalid preference namespace", 400);
  return namespace;
}

/** One preference / draft for this browser (null when none is saved). */
export const GET = route(async (_req: Request, ctx: Ctx) => {
  const p = getPref(await clientId(), await ns(ctx));
  return json({ value: p?.value ?? null, updatedAt: p?.updatedAt ?? null });
});

/** Save `{ value }` for this browser (≤ 1 MB). */
export const PUT = route(async (req: Request, ctx: Ctx) => {
  const namespace = await ns(ctx);
  const text = await req.text();
  if (text.length > MAX_PREF_BYTES + 64) throw new DomainError("Preference is larger than 1 MB", 413);
  const body = text ? (JSON.parse(text) as { value?: unknown }) : {};
  if (!("value" in body)) throw new DomainError("Send { value }", 400);
  return json({ ok: true, updatedAt: putPref(await clientId(), namespace, body.value) });
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  deletePref(await clientId(), await ns(ctx));
  return json({ ok: true });
});
