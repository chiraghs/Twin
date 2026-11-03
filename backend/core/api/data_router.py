"""Data API: the backend's SQLite data model, run history, configuration history and AI activity."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from backend.core.db.connection import connection, db_path
from backend.core.db.persistent import ensure_table, registry

router = APIRouter(prefix="/data", tags=["Data & Persistence"])


def _count(table: str) -> int:
    try:
        return connection().execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    except Exception:
        return 0


@router.get("/model")
async def data_model() -> dict[str, Any]:
    """Every backend table: feature, description, typed columns, indexes and row count."""
    tables = []
    for spec in sorted(registry().values(), key=lambda s: (s.feature, s.name)):
        ensure_table(spec)
        cols = [r["name"] for r in connection().execute(f"PRAGMA table_info({spec.name})")]
        tables.append({"table": spec.name, "feature": spec.feature, "description": spec.description, "kind": spec.kind,
                       "columns": cols, "indexes": list(spec.indexes), "rows": _count(spec.name)})
    shared = [
        {"table": t, "feature": "platform", "description": d, "rows": _count(t)}
        for t, d in [("app_config", "Feature configurations (current)."), ("app_config_history", "Every configuration change."),
                     ("ai_calls", "Every Meta Model API call (web and backend)."), ("ai_interactions", "AI-written answers with grounding status."),
                     ("schema_migrations", "Applied migrations per component.")]
    ]
    return {"database": db_path(), "tables": tables, "platform_tables": shared}


@router.get("/runs/{table}")
async def run_history(table: str, limit: int = Query(20, ge=1, le=200), subject_id: str | None = None) -> list[dict[str, Any]]:
    """Recent results of a run-history table (e.g. sc_what_if_runs, df_planning_briefs)."""
    spec = registry().get(table)
    if not spec or "subject_id" not in spec.columns:
        raise HTTPException(404, f"{table} is not a run-history table")
    ensure_table(spec)
    where, args = ("WHERE subject_id = ?", (subject_id,)) if subject_id else ("", ())
    rows = connection().execute(f"SELECT data FROM {table} {where} ORDER BY created_at DESC LIMIT ?", (*args, limit)).fetchall()
    return [json.loads(r["data"]) for r in rows]


@router.get("/config-history/{component}")
async def config_history(component: str, limit: int = Query(20, ge=1, le=200)) -> list[dict[str, Any]]:
    rows = connection().execute(
        "SELECT data, changed_at, changed_by FROM app_config_history WHERE component = ? ORDER BY id DESC LIMIT ?", (component, limit)
    ).fetchall()
    return [{"config": json.loads(r["data"]), "changed_at": r["changed_at"], "changed_by": r["changed_by"]} for r in rows]


@router.get("/ai-activity")
async def ai_activity(limit: int = Query(30, ge=1, le=200)) -> dict[str, Any]:
    calls = connection().execute(
        "SELECT component, model, purpose, ok, latency_ms, detail, created_at FROM ai_calls ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    answers = connection().execute(
        "SELECT feature, subject_id, question, language, generated_by, created_at FROM ai_interactions ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    return {"calls": [dict(r) for r in calls], "answers": [dict(r) for r in answers]}
