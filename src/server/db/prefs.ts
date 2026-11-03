import "server-only";
import { randomUUID } from "node:crypto";
import { db, nowIso } from "./connection";

/**
 * Per-browser preferences and drafts, keyed by an anonymous client id (cookie `twin_client`):
 * twin view and layers, node positions, simulator workbench, Twin Builder and Playground drafts,
 * the copilot conversation view, theme and 3D quality.
 */

export const CLIENT_COOKIE = "twin_client";
export const NAMESPACE_RE = /^[a-z][a-z0-9-]{1,40}$/;
export const MAX_PREF_BYTES = 1024 * 1024;
const CLIENT_RE = /^[A-Za-z0-9-]{8,64}$/;

export const newClientId = () => randomUUID();
export const validClientId = (v: string | undefined | null): v is string => !!v && CLIENT_RE.test(v);

export function getPref(clientId: string, namespace: string): { value: unknown; updatedAt: string } | null {
  const r = db().prepare("SELECT value, updated_at FROM client_preferences WHERE client_id = ? AND namespace = ?").get(clientId, namespace) as { value: string; updated_at: string } | undefined;
  return r ? { value: JSON.parse(r.value), updatedAt: r.updated_at } : null;
}

export function listPrefs(clientId: string): Record<string, unknown> {
  const rows = db().prepare("SELECT namespace, value FROM client_preferences WHERE client_id = ?").all(clientId) as { namespace: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.namespace, JSON.parse(r.value)]));
}

export function putPref(clientId: string, namespace: string, value: unknown): string {
  const json = JSON.stringify(value ?? null);
  if (json.length > MAX_PREF_BYTES) throw new Error(`Preference "${namespace}" is larger than 1 MB`);
  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO client_preferences (client_id, namespace, value, version, updated_at) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (client_id, namespace) DO UPDATE SET value = excluded.value, version = client_preferences.version + 1, updated_at = excluded.updated_at`,
    )
    .run(clientId, namespace, json, now);
  return now;
}

export function deletePref(clientId: string, namespace: string) {
  db().prepare("DELETE FROM client_preferences WHERE client_id = ? AND namespace = ?").run(clientId, namespace);
}
