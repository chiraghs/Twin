import { z } from "zod";
import { appendAudit } from "@/domain/audit";
import { DomainError } from "@/domain/errors";
import { adminActor, requireAdmin } from "@/server/admin";
import { json, nowISO, parseBody, route } from "@/server/http";
import { deleteSnapshot, loadSnapshot } from "@/server/db/snapshots";
import { getState, replaceState } from "@/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const RestoreSchema = z.object({ by: z.string().trim().max(60).optional() });

/** Restore a snapshot into the active twin (admin): the plant returns to exactly that state. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  requireAdmin(req);
  const { id } = await params;
  const { by } = await parseBody(req, RestoreSchema);
  const current = getState();
  const snap = loadSnapshot(current.profile.id, id);
  if (!snap) throw new DomainError(`Snapshot ${id} not found`, 404);
  const next = snap.state;
  // Same twin, same identity; the live clock restarts from now (no catch-up for the time in between).
  next.profile = { ...next.profile, id: current.profile.id, isDemo: current.profile.isDemo };
  next.clock = { ...next.clock, lastTickAt: Date.now() };
  const at = nowISO();
  appendAudit(next, at, { category: "system", actor: adminActor(by), title: `Snapshot restored: ${snap.meta.name}`, detail: `${snap.meta.id} from plant hour ${snap.meta.simHour.toFixed(2)}.`, severity: "warning", refs: {} });
  const state = replaceState(next, current.profile.isDemo, current.profile.id);
  return json({ snapshot: snap.meta, state });
});

/** Delete a snapshot (admin). */
export const DELETE = route(async (req: Request, { params }: Ctx) => {
  requireAdmin(req);
  const { id } = await params;
  if (!deleteSnapshot(getState().profile.id, id)) throw new DomainError(`Snapshot ${id} not found`, 404);
  return json({ deleted: id });
});
