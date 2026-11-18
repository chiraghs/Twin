import { appendAudit } from "@/domain/audit";
import { ASSET_KINDS } from "@/domain/archetypes";
import { DomainError } from "@/domain/errors";
import { adminActor, requireAdmin } from "@/server/admin";
import { json, nowISO, route } from "@/server/http";
import { deleteModel, isGlb, loadModel, MODEL_LIMIT_BYTES, saveModel } from "@/server/db/models";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string }> };

function kindOf(raw: string) {
  if (!(ASSET_KINDS as string[]).includes(raw)) throw new DomainError(`Unknown machine type ${raw}`, 404);
  return raw;
}

/** The uploaded model for a machine type (binary glTF). */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const kind = kindOf((await params).kind);
  const m = loadModel(getState().profile.id, kind);
  if (!m) throw new DomainError(`No model uploaded for ${kind}`, 404);
  return new Response(new Uint8Array(m.bytes), { headers: { "content-type": "model/gltf-binary", "cache-control": "no-store", etag: `"${m.uploadedAt}"` } });
});

/** Upload a .glb for a machine type (admin). Every machine of that type in the 3D twin uses it. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  requireAdmin(req);
  const kind = kindOf((await params).kind);
  const form = await req.formData();
  const file = form.get("file");
  const by = String(form.get("by") ?? "").slice(0, 60) || undefined;
  if (!(file instanceof File)) throw new DomainError("Attach a .glb file", 400);
  if (file.size > MODEL_LIMIT_BYTES) throw new DomainError("The model must be under 15 MB", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isGlb(bytes)) throw new DomainError("That isn't a binary glTF (.glb) file", 415);
  const at = nowISO();
  const s = getState();
  const meta = saveModel(s.profile.id, kind, file.name.slice(0, 120), bytes, adminActor(by), at);
  mutate((st) => appendAudit(st, at, { category: "system", actor: adminActor(by), title: `3D model uploaded for ${kind}`, detail: `${meta.fileName}, ${(meta.size / 1024).toFixed(0)} KB.`, severity: "info", refs: {} }));
  return json({ model: meta }, 201);
});

/** Go back to the built-in shape for this machine type (admin). */
export const DELETE = route(async (req: Request, { params }: Ctx) => {
  requireAdmin(req);
  const kind = kindOf((await params).kind);
  if (!deleteModel(getState().profile.id, kind)) throw new DomainError(`No model uploaded for ${kind}`, 404);
  return json({ deleted: kind });
});
