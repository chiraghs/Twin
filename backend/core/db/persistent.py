"""Declared tables and write-through persistent collections.

Every backend entity lives in a declared table: a natural key, typed and indexed columns that
queries filter on, its position (``ord``) and the full entity as JSON (``data``). Repositories
keep their familiar ``dict`` / ``list`` attributes; ``PersistentDict`` / ``PersistentList`` write
every change through to SQLite, and ``bind_repository`` loads them from the database on start
(seeding the demo data only into an empty database).

In-place changes to an entity (``rec.status = "APPROVED"``) are saved with ``.save(key)``.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from pydantic import BaseModel

from backend.core.db.connection import connection, now_iso, transaction, write_lock


@dataclass
class TableSpec:
    name: str
    description: str
    model: Optional[type] = None  # pydantic model class; None = plain JSON values
    key: Callable[[Any], str] = lambda v: str(v)
    columns: dict[str, Callable[[Any], Any]] = field(default_factory=dict)
    indexes: tuple[str, ...] = ()
    kind: str = "dict"  # "dict" | "list" | "series" (dict of lists, grouped by the dict key)
    feature: str = ""

    def ddl(self) -> str:
        cols = ",\n  ".join(f"{c} {_sqltype(c)}" for c in self.columns)
        group = "group_key TEXT NOT NULL,\n  " if self.kind == "series" else ""
        pk = "group_key, key" if self.kind == "series" else "key"
        idx = "\n".join(f"CREATE INDEX IF NOT EXISTS ix_{self.name}_{c} ON {self.name} ({c});" for c in self.indexes)
        return (
            f"CREATE TABLE IF NOT EXISTS {self.name} (\n  {group}key TEXT NOT NULL,\n  "
            + (cols + ",\n  " if cols else "")
            + f"ord INTEGER NOT NULL,\n  data TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  PRIMARY KEY ({pk})\n);\n{idx}"
        )


_REGISTRY: dict[str, TableSpec] = {}
_CREATED: set[tuple[str, str]] = set()


def _sqltype(col: str) -> str:
    if col.endswith(("_at", "_id", "_status", "_type", "_class", "status", "category", "severity", "verdict", "name", "action", "level", "plant", "kind")):
        return "TEXT"
    if col.endswith(("_count", "_flag", "is_active")):
        return "INTEGER"
    if col.endswith(("_usd", "_pct", "_hours", "_days", "_score", "_rate", "probability", "confidence", "similarity", "quantity", "_units", "_c", "_rms")):
        return "REAL"
    return "TEXT"


def register(spec: TableSpec) -> TableSpec:
    _REGISTRY[spec.name] = spec
    return spec


def registry() -> dict[str, TableSpec]:
    return dict(_REGISTRY)


def ensure_table(spec: TableSpec) -> None:
    from backend.core.db.connection import db_path

    marker = (db_path(), spec.name)
    if marker in _CREATED:
        return
    conn = connection()
    with write_lock:
        # individual statements: executescript would commit an enclosing transaction
        for stmt in spec.ddl().split(";"):
            if stmt.strip():
                conn.execute(stmt)
    _CREATED.add(marker)


def _dump(spec: TableSpec, value: Any) -> str:
    if isinstance(value, BaseModel):
        return value.model_dump_json()
    return json.dumps(value, default=str)


def _load(spec: TableSpec, data: str) -> Any:
    if spec.model is not None and issubclass(spec.model, BaseModel):
        return spec.model.model_validate_json(data)
    return json.loads(data)


def _cols(spec: TableSpec, value: Any) -> list[Any]:
    out = []
    for fn in spec.columns.values():
        try:
            v = fn(value)
        except Exception:  # a missing attribute must not block persistence
            v = None
        if hasattr(v, "value"):
            v = v.value
        if hasattr(v, "isoformat"):
            v = v.isoformat()
        if isinstance(v, (dict, list)):
            v = json.dumps(v, default=str)
        out.append(v)
    return out


class PersistentDict(dict):
    """dict whose items are written through to a declared table."""

    def __init__(self, spec: TableSpec, initial: Optional[dict] = None, load: bool = True):
        super().__init__()
        self.spec = spec
        ensure_table(spec)
        if load:
            for r in connection().execute(f"SELECT key, data FROM {spec.name} ORDER BY ord"):
                super().__setitem__(r["key"], _load(spec, r["data"]))
        if initial:
            with transaction():
                for k, v in initial.items():
                    self[k] = v

    def _write(self, key: Any, value: Any) -> None:
        sql = f"INSERT INTO {self.spec.name} (key, {', '.join(self.spec.columns) + ', ' if self.spec.columns else ''}ord, data, updated_at) VALUES ({', '.join('?' * (len(self.spec.columns) + 4))}) ON CONFLICT (key) DO UPDATE SET {''.join(f'{c} = excluded.{c}, ' for c in self.spec.columns)}data = excluded.data, updated_at = excluded.updated_at"
        ordv = list(dict.keys(self)).index(key) if key in self else len(self)
        with write_lock:
            connection().execute(sql, (str(key), *_cols(self.spec, value), ordv, _dump(self.spec, value), now_iso()))

    def __setitem__(self, key: Any, value: Any) -> None:
        super().__setitem__(key, value)
        self._write(key, value)

    def __delitem__(self, key: Any) -> None:
        super().__delitem__(key)
        with write_lock:
            connection().execute(f"DELETE FROM {self.spec.name} WHERE key = ?", (str(key),))

    def pop(self, key: Any, *default: Any) -> Any:
        if key in self:
            v = super().__getitem__(key)
            del self[key]
            return v
        return default[0] if default else super().pop(key)

    def update(self, *args: Any, **kwargs: Any) -> None:
        with transaction():
            for k, v in dict(*args, **kwargs).items():
                self[k] = v

    def setdefault(self, key: Any, default: Any = None) -> Any:
        if key not in self:
            self[key] = default
        return super().__getitem__(key)

    def clear(self) -> None:
        super().clear()
        with write_lock:
            connection().execute(f"DELETE FROM {self.spec.name}")

    def save(self, key: Any) -> None:
        """Persist an in-place change to the entity stored under ``key``."""
        self._write(key, super().__getitem__(key))


class PersistentList(list):
    """list whose items are written through to a declared table (keyed by ``spec.key``)."""

    def __init__(self, spec: TableSpec, initial: Optional[list] = None, load: bool = True, group: Optional[str] = None):
        super().__init__()
        self.spec = spec
        self.group = group
        ensure_table(spec)
        if load:
            where, args = ("WHERE group_key = ?", (group,)) if spec.kind == "series" else ("", ())
            for r in connection().execute(f"SELECT data FROM {spec.name} {where} ORDER BY ord", args):
                super().append(_load(spec, r["data"]))
        if initial:
            with transaction():
                for v in initial:
                    self.append(v)

    def _sql(self) -> str:
        cols = list(self.spec.columns)
        group = "group_key, " if self.spec.kind == "series" else ""
        conflict = "group_key, key" if self.spec.kind == "series" else "key"
        return (
            f"INSERT INTO {self.spec.name} ({group}key, {', '.join(cols) + ', ' if cols else ''}ord, data, updated_at) "
            f"VALUES ({', '.join('?' * (len(cols) + 4 + (1 if group else 0)))}) ON CONFLICT ({conflict}) DO UPDATE SET "
            f"{''.join(f'{c} = excluded.{c}, ' for c in cols)}ord = excluded.ord, data = excluded.data, updated_at = excluded.updated_at"
        )

    def _write(self, value: Any, ordv: int) -> None:
        g = (self.group,) if self.spec.kind == "series" else ()
        with write_lock:
            connection().execute(self._sql(), (*g, self.spec.key(value), *_cols(self.spec, value), ordv, _dump(self.spec, value), now_iso()))

    def _rewrite(self) -> None:
        with transaction() as c:
            if self.spec.kind == "series":
                c.execute(f"DELETE FROM {self.spec.name} WHERE group_key = ?", (self.group,))
            else:
                c.execute(f"DELETE FROM {self.spec.name}")
            for i, v in enumerate(self):
                self._write(v, i)

    def append(self, value: Any) -> None:
        super().append(value)
        self._write(value, len(self) - 1)

    def extend(self, values: Any) -> None:
        with transaction():
            for v in values:
                self.append(v)

    def insert(self, index: int, value: Any) -> None:
        super().insert(index, value)
        self._rewrite()

    def __setitem__(self, index: Any, value: Any) -> None:
        super().__setitem__(index, value)
        self._rewrite()

    def __delitem__(self, index: Any) -> None:
        super().__delitem__(index)
        self._rewrite()

    def remove(self, value: Any) -> None:
        super().remove(value)
        self._rewrite()

    def pop(self, index: int = -1) -> Any:
        v = super().pop(index)
        self._rewrite()
        return v

    def clear(self) -> None:
        super().clear()
        self._rewrite()

    def sort(self, *args: Any, **kwargs: Any) -> None:
        super().sort(*args, **kwargs)
        self._rewrite()

    def save(self, value: Any) -> None:
        """Persist an in-place change to ``value`` (an item of this list)."""
        for i, v in enumerate(self):
            if v is value:
                self._write(v, i)
                return


class PersistentSeries(dict):
    """dict of group → PersistentList (time series such as readings per machine)."""

    def __init__(self, spec: TableSpec, initial: Optional[dict] = None, load: bool = True):
        super().__init__()
        self.spec = spec
        ensure_table(spec)
        if load:
            for r in connection().execute(f"SELECT DISTINCT group_key FROM {spec.name}"):
                super().__setitem__(r["group_key"], PersistentList(spec, group=r["group_key"]))
        if initial:
            with transaction():
                for k, v in initial.items():
                    self[k] = v

    def __setitem__(self, key: str, values: Any) -> None:
        lst = values if isinstance(values, PersistentList) else PersistentList(self.spec, initial=list(values), load=False, group=key)
        super().__setitem__(key, lst)


def _wrap(spec: TableSpec, value: Any, load: bool):
    if spec.kind == "series":
        return PersistentSeries(spec, initial=None if load else value, load=load)
    if spec.kind == "list":
        return PersistentList(spec, initial=None if load else value, load=load)
    return PersistentDict(spec, initial=None if load else value, load=load)


def table_has_rows(spec: TableSpec) -> bool:
    ensure_table(spec)
    return connection().execute(f"SELECT 1 FROM {spec.name} LIMIT 1").fetchone() is not None


def bind_repository(obj: Any, specs: dict[str, TableSpec], seed: Optional[Callable[[], None]] = None) -> bool:
    """Bind ``obj.<attr>`` collections to their tables.

    If the database already holds data (the first spec's table is non-empty) everything is loaded
    from SQLite and ``seed`` is not called. Otherwise ``seed()`` fills the plain attributes and they
    are written to SQLite in one transaction. Returns True when data was loaded from the database.
    """
    for spec in specs.values():
        register(spec)
        ensure_table(spec)
    first = next(iter(specs.values()))
    if table_has_rows(first):
        for attr, spec in specs.items():
            setattr(obj, attr, _wrap(spec, None, load=True))
        return True
    if seed:
        seed()
    with transaction():
        for attr, spec in specs.items():
            setattr(obj, attr, _wrap(spec, getattr(obj, attr), load=False))
    return False
