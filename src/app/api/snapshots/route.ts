import { z } from "zod";
import { appendAudit } from "@/domain/audit";
import { json, nowISO, parseBody, route } from "@/server/http";
import { listSnapshots, saveSnapshot } from "@/server/db/snapshots";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

/** Snapshots of the active twin, newest first. */
export const GET = route(async () => json({ facilityId: getState().profile.id, snapshots: listSnapshots(getState().profile.id) }));

const SaveSchema = z.object({ name: z.string().trim().min(1).max(80), by: z.string().trim().min(1).max(60).default("Operator") });

/** Save the twin's full current state under a name. */
export const POST = route(async (req: Request) => {
  const { name, by } = await parseBody(req, SaveSchema);
  const at = nowISO();
  const meta = saveSnapshot(getState(), name, by, at);
  mutate((s) => appendAudit(s, at, { category: "system", actor: by, title: `Snapshot saved: ${name}`, detail: `${meta.id} at plant hour ${meta.simHour.toFixed(2)}.`, severity: "info", refs: {} }));
  return json({ snapshot: meta }, 201);
});
