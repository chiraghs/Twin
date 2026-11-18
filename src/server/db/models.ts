import "server-only";
import { db } from "./connection";

/** User 3D models (binary glTF) per machine type, per facility. The 3D twin draws them instead of the built-in shapes. */

export const MODEL_LIMIT_BYTES = 15 * 1024 * 1024;
let ready = false;
function conn() {
  const c = db();
  if (!ready) {
    c.exec(`CREATE TABLE IF NOT EXISTS machine_models (
      facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BLOB NOT NULL,
      uploaded_at TEXT NOT NULL,
      uploaded_by TEXT NOT NULL,
      PRIMARY KEY (facility_id, kind)
    )`);
    ready = true;
  }
  return c;
}

export interface MachineModelMeta {
  kind: string;
  fileName: string;
  size: number;
  uploadedAt: string;
  uploadedBy: string;
}

/** A binary glTF starts with the ASCII magic "glTF" and version 2. */
export function isGlb(bytes: Uint8Array): boolean {
  if (bytes.length < 20) return false;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  const version = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  return magic === "glTF" && version === 2;
}

export function listModels(facilityId: string): MachineModelMeta[] {
  return (conn().prepare("SELECT kind, file_name, size, uploaded_at, uploaded_by FROM machine_models WHERE facility_id = ? ORDER BY kind").all(facilityId) as Record<string, unknown>[]).map((r) => ({
    kind: String(r.kind),
    fileName: String(r.file_name),
    size: Number(r.size),
    uploadedAt: String(r.uploaded_at),
    uploadedBy: String(r.uploaded_by),
  }));
}

export function saveModel(facilityId: string, kind: string, fileName: string, bytes: Uint8Array, by: string, nowISO: string): MachineModelMeta {
  conn()
    .prepare(
      `INSERT INTO machine_models (facility_id, kind, file_name, size, data, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (facility_id, kind) DO UPDATE SET file_name = excluded.file_name, size = excluded.size, data = excluded.data, uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by`,
    )
    .run(facilityId, kind, fileName, bytes.length, bytes, nowISO, by);
  return { kind, fileName, size: bytes.length, uploadedAt: nowISO, uploadedBy: by };
}

export function loadModel(facilityId: string, kind: string): { bytes: Uint8Array; uploadedAt: string } | null {
  const r = conn().prepare("SELECT data, uploaded_at FROM machine_models WHERE facility_id = ? AND kind = ?").get(facilityId, kind) as { data: Uint8Array; uploaded_at: string } | undefined;
  return r ? { bytes: r.data, uploadedAt: r.uploaded_at } : null;
}

export function deleteModel(facilityId: string, kind: string): boolean {
  return Number(conn().prepare("DELETE FROM machine_models WHERE facility_id = ? AND kind = ?").run(facilityId, kind).changes) > 0;
}
