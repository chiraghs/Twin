import "server-only";
import { DomainError } from "@/domain/errors";
import { VIEW_LIMIT, validPose, type SavedView, type SavedViewKind, type Vec3 } from "@/domain/views";
import { db } from "./connection";

/** Saved 3D viewpoints and virtual cameras, per facility (deleted with the facility). */

let ready = false;

function conn() {
  const c = db();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS facility_views (
      id TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('view', 'camera')),
      position TEXT NOT NULL,
      target TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    )`);
    c.exec("CREATE INDEX IF NOT EXISTS ix_facility_views_facility ON facility_views (facility_id, created_at)");
    ready = true;
  }
  return c;
}

const toView = (r: Record<string, unknown>): SavedView => ({
  id: String(r.id),
  facilityId: String(r.facility_id),
  name: String(r.name),
  kind: r.kind === "camera" ? "camera" : "view",
  position: JSON.parse(String(r.position)) as Vec3,
  target: JSON.parse(String(r.target)) as Vec3,
  createdAt: String(r.created_at),
  createdBy: String(r.created_by),
});

export function listViews(facilityId: string): SavedView[] {
  return (conn().prepare("SELECT * FROM facility_views WHERE facility_id = ? ORDER BY created_at, rowid").all(facilityId) as Record<string, unknown>[]).map(toView);
}

export function saveView(facilityId: string, input: { name: string; kind: SavedViewKind; position: Vec3; target: Vec3 }, by: string, nowISO: string): SavedView {
  if (!validPose(input.position, input.target)) throw new DomainError("That viewpoint isn't valid.", 400);
  const c = conn();
  const n = (c.prepare("SELECT COUNT(*) AS n FROM facility_views WHERE facility_id = ?").get(facilityId) as { n: number }).n;
  if (n >= VIEW_LIMIT) throw new DomainError(`This twin already has ${VIEW_LIMIT} saved views; delete one first.`, 409);
  const round = (v: Vec3) => v.map((x) => Math.round(x * 1000) / 1000) as Vec3;
  const view: SavedView = {
    id: `VW-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    facilityId,
    name: input.name,
    kind: input.kind,
    position: round(input.position),
    target: round(input.target),
    createdAt: nowISO,
    createdBy: by,
  };
  c.prepare("INSERT INTO facility_views (id, facility_id, name, kind, position, target, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    view.id,
    facilityId,
    view.name,
    view.kind,
    JSON.stringify(view.position),
    JSON.stringify(view.target),
    nowISO,
    by,
  );
  return view;
}

export function deleteView(facilityId: string, id: string): boolean {
  return Number(conn().prepare("DELETE FROM facility_views WHERE facility_id = ? AND id = ?").run(facilityId, id).changes) > 0;
}
