"""Feature configurations persisted in ``app_config`` with every change in ``app_config_history``."""
from __future__ import annotations

import json
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel

from backend.core.db.connection import connection, now_iso, transaction

C = TypeVar("C", bound=BaseModel)


class PersistentConfig(Generic[C]):
    def __init__(self, component: str, model: type[C], default: Optional[C] = None) -> None:
        self.component = component
        self.model = model
        self._default = default or model()
        self._cache: Optional[C] = None

    def get(self) -> C:
        if self._cache is None:
            row = connection().execute("SELECT data FROM app_config WHERE component = ?", (self.component,)).fetchone()
            if row is None:
                self._cache = self._default.model_copy(deep=True)
                self.put(self._cache, "default")
            else:
                self._cache = self.model.model_validate_json(row["data"])
        return self._cache

    def put(self, config: C, by: Optional[str] = None) -> C:
        data = config.model_dump_json()
        now = now_iso()
        with transaction() as c:
            c.execute(
                """INSERT INTO app_config (component, data, version, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)
                   ON CONFLICT (component) DO UPDATE SET data = excluded.data, version = app_config.version + 1,
                     updated_at = excluded.updated_at, updated_by = excluded.updated_by""",
                (self.component, data, now, by),
            )
            c.execute("INSERT INTO app_config_history (component, data, changed_at, changed_by) VALUES (?, ?, ?, ?)", (self.component, data, now, by))
        self._cache = config
        return config

    def history(self, limit: int = 20) -> list[dict]:
        rows = connection().execute(
            "SELECT data, changed_at, changed_by FROM app_config_history WHERE component = ? ORDER BY id DESC LIMIT ?", (self.component, limit)
        ).fetchall()
        return [{"config": json.loads(r["data"]), "changed_at": r["changed_at"], "changed_by": r["changed_by"]} for r in rows]
