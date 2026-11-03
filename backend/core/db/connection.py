"""Shared SQLite connection for the backend.

The web app and this backend use one database file. Each owns its tables and records its
migrations in ``schema_migrations (component, version)``; the backend's component is "backend".

Location: ``TWIN_DB_PATH``, else ``$TWIN_DATA_DIR/twin.db``, else ``<repo>/.data/twin.db``.
WAL mode lets both processes read while one writes; ``busy_timeout`` absorbs short write locks.
"""
from __future__ import annotations

import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

_REPO_ROOT = Path(__file__).resolve().parents[3]
_conns: dict[str, sqlite3.Connection] = {}
_lock = threading.RLock()
write_lock = _lock


def db_path() -> str:
    if os.getenv("TWIN_DB_PATH"):
        return os.environ["TWIN_DB_PATH"]
    base = Path(os.getenv("TWIN_DATA_DIR") or _REPO_ROOT / ".data")
    return str(base / "twin.db")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def connection() -> sqlite3.Connection:
    """The connection for the current database path (created and baseline-migrated on first use)."""
    path = db_path()
    with _lock:
        conn = _conns.get(path)
        if conn is None:
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=10)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA busy_timeout = 5000")
            conn.execute(
                """CREATE TABLE IF NOT EXISTS schema_migrations (
                    component TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, applied_at TEXT NOT NULL,
                    PRIMARY KEY (component, version))"""
            )
            _base_tables(conn)
            _conns[path] = conn
        return conn


def close_all() -> None:
    with _lock:
        for c in _conns.values():
            c.close()
        _conns.clear()


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """BEGIN IMMEDIATE … COMMIT under the process lock (nested use joins the outer transaction)."""
    conn = connection()
    with _lock:
        if conn.in_transaction:
            yield conn
            return
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise


def _base_tables(conn: sqlite3.Connection) -> None:
    """Backend-wide tables (feature tables are created from their TableSpec on first bind)."""
    applied = {r[0] for r in conn.execute("SELECT version FROM schema_migrations WHERE component = 'backend'")}
    if 1 in applied:
        return
    conn.executescript(
        """
        BEGIN;
        CREATE TABLE IF NOT EXISTS app_config (
            component TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL,
            updated_by TEXT
        );
        CREATE TABLE IF NOT EXISTS app_config_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            component TEXT NOT NULL,
            data TEXT NOT NULL,
            changed_at TEXT NOT NULL,
            changed_by TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_app_config_history ON app_config_history (component, changed_at);
        CREATE TABLE IF NOT EXISTS ai_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            component TEXT NOT NULL,
            model TEXT NOT NULL,
            purpose TEXT NOT NULL,
            ok INTEGER NOT NULL,
            latency_ms INTEGER,
            detail TEXT,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_ai_calls_created ON ai_calls (created_at);
        CREATE TABLE IF NOT EXISTS ai_interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feature TEXT NOT NULL,
            subject_id TEXT,
            question TEXT NOT NULL,
            language TEXT,
            generated_by TEXT NOT NULL,
            note TEXT,
            answer TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_ai_interactions ON ai_interactions (feature, created_at);
        COMMIT;
        """
    )
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (component, version, name, applied_at) VALUES ('backend', 1, ?, ?)",
        ("config, AI call log, AI interactions", now_iso()),
    )
