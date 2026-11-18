import "server-only";
import { DomainError } from "@/domain/errors";
import { LINK_LIMIT, type FieldProtocol, type SignalLink } from "@/domain/signal-links";
import { db } from "./connection";

/** Field-tag → twin-signal links, per facility (deleted with the facility). One link per twin signal. */

let ready = false;
function conn() {
  const c = db();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS signal_links (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      signal_id TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK (protocol IN ('opcua', 'modbus')),
      endpoint TEXT NOT NULL,
      address TEXT NOT NULL,
      scale REAL NOT NULL DEFAULT 1,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE (facility_id, signal_id)
    )`);
    ready = true;
  }
  return c;
}

const toLink = (r: Record<string, unknown>): SignalLink => ({
  id: String(r.id),
  facilityId: String(r.facility_id),
  signalId: String(r.signal_id),
  protocol: r.protocol === "modbus" ? "modbus" : "opcua",
  endpoint: String(r.endpoint),
  address: String(r.address),
  scale: Number(r.scale),
  label: String(r.label),
  createdAt: String(r.created_at),
  createdBy: String(r.created_by),
});

export function listLinks(facilityId: string): SignalLink[] {
  return (conn().prepare("SELECT * FROM signal_links WHERE facility_id = ? ORDER BY signal_id").all(facilityId) as Record<string, unknown>[]).map(toLink);
}

/** Link a field tag to a twin signal; linking an already-linked signal replaces its link. */
export function saveLink(
  facilityId: string,
  input: { signalId: string; protocol: FieldProtocol; endpoint: string; address: string; scale: number; label: string },
  by: string,
  nowISO: string,
): SignalLink {
  const c = conn();
  const exists = c.prepare("SELECT id FROM signal_links WHERE facility_id = ? AND signal_id = ?").get(facilityId, input.signalId) as { id: string } | undefined;
  if (!exists) {
    const n = (c.prepare("SELECT COUNT(*) AS n FROM signal_links WHERE facility_id = ?").get(facilityId) as { n: number }).n;
    if (n >= LINK_LIMIT) throw new DomainError(`This twin already has ${LINK_LIMIT} signal links.`, 409);
  }
  const id = exists?.id ?? `LNK-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  c.prepare(
    `INSERT INTO signal_links (id, facility_id, signal_id, protocol, endpoint, address, scale, label, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (facility_id, signal_id) DO UPDATE SET protocol = excluded.protocol, endpoint = excluded.endpoint, address = excluded.address,
       scale = excluded.scale, label = excluded.label, created_at = excluded.created_at, created_by = excluded.created_by`,
  ).run(id, facilityId, input.signalId, input.protocol, input.endpoint, input.address, input.scale, input.label, nowISO, by);
  return { id, facilityId, ...input, createdAt: nowISO, createdBy: by };
}

export function deleteLink(facilityId: string, id: string): boolean {
  return Number(conn().prepare("DELETE FROM signal_links WHERE facility_id = ? AND id = ?").run(facilityId, id).changes) > 0;
}
