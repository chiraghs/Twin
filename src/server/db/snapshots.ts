import "server-only";
import { DomainError } from "@/domain/errors";
import type { FactoryState } from "@/domain/types";
import { db } from "./connection";

/**
 * Named snapshots of a twin's full state (for commissioning tests and demos): save, then restore
 * later. Stored per facility; deleting the facility deletes its snapshots.
 */

export interface SnapshotMeta {
  id: string;
  facilityId: string;
  name: string;
  createdAt: string;
  createdBy: string;
  simHour: number;
  bytes: number;
}

export const SNAPSHOT_LIMIT = 20;
let ready = false;

function conn() {
  const c = db();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS facility_snapshots (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      sim_hour REAL NOT NULL,
      data TEXT NOT NULL
    )`);
    c.exec("CREATE INDEX IF NOT EXISTS ix_facility_snapshots_facility ON facility_snapshots (facility_id, created_at)");
    ready = true;
  }
  return c;
}

const toMeta = (r: Record<string, unknown>): SnapshotMeta => ({
  id: String(r.id),
  facilityId: String(r.facility_id),
  name: String(r.name),
  createdAt: String(r.created_at),
  createdBy: String(r.created_by),
  simHour: Number(r.sim_hour),
  bytes: Number(r.bytes ?? 0),
});

export function listSnapshots(facilityId: string): SnapshotMeta[] {
  return (conn()
    .prepare("SELECT id, facility_id, name, created_at, created_by, sim_hour, length(data) AS bytes FROM facility_snapshots WHERE facility_id = ? ORDER BY created_at DESC")
    .all(facilityId) as Record<string, unknown>[]).map(toMeta);
}

export function saveSnapshot(state: FactoryState, name: string, by: string, nowISO: string): SnapshotMeta {
  const c = conn();
  const count = (c.prepare("SELECT COUNT(*) AS n FROM facility_snapshots WHERE facility_id = ?").get(state.profile.id) as { n: number }).n;
  if (count >= SNAPSHOT_LIMIT) throw new DomainError(`This twin already has ${SNAPSHOT_LIMIT} snapshots; delete one first.`, 409);
  const id = `SNP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const data = JSON.stringify(state);
  c.prepare("INSERT INTO facility_snapshots (id, facility_id, name, created_at, created_by, sim_hour, data) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, state.profile.id, name, nowISO, by, state.clock.hour, data);
  return { id, facilityId: state.profile.id, name, createdAt: nowISO, createdBy: by, simHour: state.clock.hour, bytes: data.length };
}

export function loadSnapshot(facilityId: string, id: string): { meta: SnapshotMeta; state: FactoryState } | null {
  const r = conn().prepare("SELECT id, facility_id, name, created_at, created_by, sim_hour, length(data) AS bytes, data FROM facility_snapshots WHERE facility_id = ? AND id = ?").get(facilityId, id) as Record<string, unknown> | undefined;
  return r ? { meta: toMeta(r), state: JSON.parse(String(r.data)) as FactoryState } : null;
}

export function deleteSnapshot(facilityId: string, id: string): boolean {
  return Number(conn().prepare("DELETE FROM facility_snapshots WHERE facility_id = ? AND id = ?").run(facilityId, id).changes) > 0;
}
