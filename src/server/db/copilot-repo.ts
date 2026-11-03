import "server-only";
import type { ChatMessage } from "@/server/ai/llm";
import { db, nowIso, transaction } from "./connection";

/** Copilot conversations as the model saw them (messages, tool evidence, a pending confirmation). */
export interface StoredSession {
  messages: ChatMessage[];
  evidence: unknown[];
  pending: { callId: string; name: string; args: Record<string, unknown> } | null;
}

export function loadSession(id: string): StoredSession | null {
  const c = db();
  const s = c.prepare("SELECT pending_confirmation FROM copilot_sessions WHERE id = ?").get(id) as { pending_confirmation: string | null } | undefined;
  if (!s) return null;
  const messages = (c.prepare("SELECT role, parts FROM copilot_messages WHERE session_id = ? ORDER BY seq").all(id) as { role: "user" | "assistant"; parts: string }[]).map((m) => ({ role: m.role, parts: JSON.parse(m.parts) }));
  const evidence = (c.prepare("SELECT data FROM copilot_evidence WHERE session_id = ? ORDER BY seq").all(id) as { data: string }[]).map((e) => JSON.parse(e.data));
  return { messages, evidence, pending: s.pending_confirmation ? JSON.parse(s.pending_confirmation) : null };
}

export function saveSession(id: string, s: StoredSession, meta: { clientId?: string | null; facilityId?: string | null; model?: string | null } = {}) {
  const c = db();
  const now = nowIso();
  transaction(c, () => {
    c.prepare(
      `INSERT INTO copilot_sessions (id, client_id, facility_id, model, pending_confirmation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET model = excluded.model, pending_confirmation = excluded.pending_confirmation, updated_at = excluded.updated_at,
         facility_id = COALESCE(excluded.facility_id, copilot_sessions.facility_id), client_id = COALESCE(excluded.client_id, copilot_sessions.client_id)`,
    ).run(id, meta.clientId ?? null, meta.facilityId ?? null, meta.model ?? null, s.pending ? JSON.stringify(s.pending) : null, now, now);
    c.prepare("DELETE FROM copilot_messages WHERE session_id = ?").run(id);
    c.prepare("DELETE FROM copilot_evidence WHERE session_id = ?").run(id);
    const msg = c.prepare("INSERT INTO copilot_messages (session_id, seq, role, parts, created_at) VALUES (?, ?, ?, ?, ?)");
    s.messages.forEach((m, i) => msg.run(id, i, m.role, JSON.stringify(m.parts), now));
    const ev = c.prepare("INSERT INTO copilot_evidence (session_id, seq, data) VALUES (?, ?, ?)");
    s.evidence.forEach((e, i) => ev.run(id, i, JSON.stringify(e ?? null)));
  });
}
