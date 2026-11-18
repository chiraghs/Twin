import "server-only";
import { DomainError } from "@/domain/errors";
import type { SeqStep, Sequence } from "@/domain/sequences";
import { db } from "./connection";

/** Commissioning sequences, per facility (deleted with the facility). */

export const SEQUENCE_LIMIT = 30;
let ready = false;
function conn() {
  const c = db();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS sequences (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      steps TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL
    )`);
    ready = true;
  }
  return c;
}

const toSeq = (r: Record<string, unknown>): Sequence => ({
  id: String(r.id),
  facilityId: String(r.facility_id),
  name: String(r.name),
  steps: JSON.parse(String(r.steps)) as SeqStep[],
  updatedAt: String(r.updated_at),
  updatedBy: String(r.updated_by),
});

export function listSequences(facilityId: string): Sequence[] {
  return (conn().prepare("SELECT * FROM sequences WHERE facility_id = ? ORDER BY rowid").all(facilityId) as Record<string, unknown>[]).map(toSeq);
}

export function getSequence(facilityId: string, id: string): Sequence | null {
  const r = conn().prepare("SELECT * FROM sequences WHERE facility_id = ? AND id = ?").get(facilityId, id) as Record<string, unknown> | undefined;
  return r ? toSeq(r) : null;
}

/** Create (no id) or replace (existing id) a sequence. */
export function saveSequence(facilityId: string, input: { id?: string; name: string; steps: SeqStep[] }, by: string, nowISO: string): Sequence {
  const c = conn();
  if (input.id && !getSequence(facilityId, input.id)) throw new DomainError(`Sequence ${input.id} not found`, 404);
  if (!input.id) {
    const n = (c.prepare("SELECT COUNT(*) AS n FROM sequences WHERE facility_id = ?").get(facilityId) as { n: number }).n;
    if (n >= SEQUENCE_LIMIT) throw new DomainError(`This twin already has ${SEQUENCE_LIMIT} sequences.`, 409);
  }
  const id = input.id ?? `SEQ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  c.prepare(
    `INSERT INTO sequences (id, facility_id, name, steps, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, steps = excluded.steps, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(id, facilityId, input.name, JSON.stringify(input.steps), nowISO, by);
  return { id, facilityId, name: input.name, steps: input.steps, updatedAt: nowISO, updatedBy: by };
}

export function deleteSequence(facilityId: string, id: string): boolean {
  return Number(conn().prepare("DELETE FROM sequences WHERE facility_id = ? AND id = ?").run(facilityId, id).changes) > 0;
}
