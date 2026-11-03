import "server-only";
import { db, nowIso } from "./connection";

/** Record one Meta Model API call in `ai_calls` (shared with the Python backend). Never throws. */
export function logAiCall(model: string, purpose: string, ok: boolean, latencyMs: number, detail = "") {
  try {
    db()
      .prepare("INSERT INTO ai_calls (component, model, purpose, ok, latency_ms, detail, created_at) VALUES ('web', ?, ?, ?, ?, ?, ?)")
      .run(model, purpose.slice(0, 120), ok ? 1 : 0, Math.round(latencyMs), detail.slice(0, 300), nowIso());
  } catch {
    /* logging must never break an AI feature */
  }
}

export function recentAiCalls(limit = 50) {
  return db()
    .prepare("SELECT component, model, purpose, ok, latency_ms AS latencyMs, detail, created_at AS createdAt FROM ai_calls ORDER BY id DESC LIMIT ?")
    .all(limit) as { component: string; model: string; purpose: string; ok: number; latencyMs: number; detail: string; createdAt: string }[];
}

export function aiCallStats(sinceIso: string) {
  return db()
    .prepare("SELECT component, model, COUNT(*) AS calls, SUM(ok) AS ok, ROUND(AVG(latency_ms)) AS avgMs FROM ai_calls WHERE created_at >= ? GROUP BY component, model ORDER BY calls DESC")
    .all(sinceIso) as { component: string; model: string; calls: number; ok: number; avgMs: number }[];
}
