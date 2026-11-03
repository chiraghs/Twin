"""Activity logs: AI calls and AI-written answers (both auditable)."""
from __future__ import annotations

from typing import Optional

from backend.core.db.connection import connection, now_iso, write_lock


def log_ai_call(model: str, purpose: str, ok: bool, latency_ms: int, detail: str = "") -> None:
    try:
        with write_lock:
            connection().execute(
                "INSERT INTO ai_calls (component, model, purpose, ok, latency_ms, detail, created_at) VALUES ('backend', ?, ?, ?, ?, ?, ?)",
                (model, purpose[:120], 1 if ok else 0, latency_ms, detail[:300], now_iso()),
            )
    except Exception:  # logging never breaks a feature
        pass


def log_interaction(feature: str, question: str, answer: str, generated_by: str, note: Optional[str] = None,
                    subject_id: Optional[str] = None, language: Optional[str] = None) -> None:
    try:
        with write_lock:
            connection().execute(
                "INSERT INTO ai_interactions (feature, subject_id, question, language, generated_by, note, answer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (feature, subject_id, question[:2000], language, generated_by, (note or "")[:500], answer[:20000], now_iso()),
            )
    except Exception:
        pass
