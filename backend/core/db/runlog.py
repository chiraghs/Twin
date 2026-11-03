"""Run history: every result produced by a write endpoint is kept (simulations, plans, traces…)."""
from __future__ import annotations

import uuid
from typing import Any, Optional

from pydantic import BaseModel

from backend.core.db.connection import connection, now_iso
from backend.core.db.persistent import PersistentList, TableSpec, ensure_table, register


class RunLog:
    def __init__(self, table: str, description: str, feature: str) -> None:
        self.spec = register(TableSpec(
            table, description, None, key=lambda d: d["run_id"], kind="list",
            columns={"subject_id": lambda d: d.get("subject_id"), "created_at": lambda d: d.get("created_at")},
            indexes=("subject_id", "created_at"), feature=feature))
        self._rows: Optional[PersistentList] = None

    def _list(self) -> PersistentList:
        if self._rows is None:
            ensure_table(self.spec)
            self._rows = PersistentList(self.spec, load=False)
            self._rows.extend([])  # keep empty in memory; reads go to SQLite
        return self._rows

    def record(self, result: Any, subject_id: Optional[str] = None) -> Any:
        data = result.model_dump(mode="json") if isinstance(result, BaseModel) else result
        self._list().append({"run_id": f"RUN-{uuid.uuid4().hex[:10].upper()}", "subject_id": subject_id, "created_at": now_iso(), "result": data})
        return result

    def recent(self, limit: int = 20, subject_id: Optional[str] = None) -> list[dict[str, Any]]:
        import json

        ensure_table(self.spec)
        where, args = ("WHERE subject_id = ?", (subject_id,)) if subject_id else ("", ())
        rows = connection().execute(f"SELECT data FROM {self.spec.name} {where} ORDER BY created_at DESC LIMIT ?", (*args, limit)).fetchall()
        return [json.loads(r["data"]) for r in rows]
