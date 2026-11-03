"""SQLite persistence for the Twin backend (shared database file with the web app)."""
from backend.core.db.connection import connection, db_path, transaction, write_lock
from backend.core.db.persistent import (
    PersistentDict,
    PersistentList,
    TableSpec,
    bind_repository,
    register,
    registry,
)
from backend.core.db.config_store import PersistentConfig
from backend.core.db.activity import log_interaction

__all__ = [
    "connection", "db_path", "transaction", "write_lock", "PersistentDict", "PersistentList", "TableSpec",
    "bind_repository", "register", "registry", "PersistentConfig", "log_interaction",
]
