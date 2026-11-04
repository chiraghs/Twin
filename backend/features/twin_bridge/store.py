"""SQLite tables for the twin bridge (`tw_*`), keyed by the web app's facility id.

tw_snapshots      latest plant snapshot per facility
tw_insights       latest computed insights per facility and feature
tw_asset_health   health / RUL time series per asset (one row per sync and asset)
tw_stock_levels   days-of-supply time series per material
tw_demand_history generated daily demand history per product (labelled simulated)
tw_inspections    AOI inspections of the twin's products, with the human disposition
"""
from __future__ import annotations

import json
from typing import Any, Iterable

from backend.core.db.connection import connection, now_iso, write_lock

DDL = [
    """CREATE TABLE IF NOT EXISTS tw_snapshots (
        facility_id TEXT PRIMARY KEY, facility_name TEXT NOT NULL, sim_hour REAL NOT NULL,
        features TEXT NOT NULL, synced_at TEXT NOT NULL, data TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS tw_insights (
        facility_id TEXT NOT NULL, feature TEXT NOT NULL, sim_hour REAL NOT NULL, computed_at TEXT NOT NULL,
        data TEXT NOT NULL, PRIMARY KEY (facility_id, feature))""",
    """CREATE TABLE IF NOT EXISTS tw_asset_health (
        facility_id TEXT NOT NULL, sim_hour REAL NOT NULL, asset_id TEXT NOT NULL, health REAL NOT NULL,
        vibration REAL NOT NULL, temperature REAL NOT NULL, hours_to_trip REAL NOT NULL, zone TEXT NOT NULL, risk TEXT NOT NULL,
        PRIMARY KEY (facility_id, sim_hour, asset_id))""",
    "CREATE INDEX IF NOT EXISTS ix_tw_asset_health_asset ON tw_asset_health (facility_id, asset_id, sim_hour)",
    """CREATE TABLE IF NOT EXISTS tw_stock_levels (
        facility_id TEXT NOT NULL, sim_hour REAL NOT NULL, item_id TEXT NOT NULL, on_hand REAL NOT NULL,
        days_of_supply REAL NOT NULL, at_risk INTEGER NOT NULL, PRIMARY KEY (facility_id, sim_hour, item_id))""",
    """CREATE TABLE IF NOT EXISTS tw_demand_history (
        facility_id TEXT NOT NULL, product_id TEXT NOT NULL, day TEXT NOT NULL, units REAL NOT NULL,
        PRIMARY KEY (facility_id, product_id, day))""",
    """CREATE TABLE IF NOT EXISTS tw_inspections (
        facility_id TEXT NOT NULL, inspection_id TEXT PRIMARY KEY, camera_id TEXT NOT NULL, line_id TEXT,
        product_id TEXT, at TEXT NOT NULL, sim_hour REAL NOT NULL, verdict TEXT NOT NULL, defect_count INTEGER NOT NULL,
        disposition TEXT NOT NULL DEFAULT 'pending', auditor TEXT, data TEXT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS ix_tw_inspections_facility ON tw_inspections (facility_id, at)",
]

TABLE_DESCRIPTIONS = {
    "tw_snapshots": "Latest plant snapshot from the web twin, per facility.",
    "tw_insights": "Latest insights per facility and feature (maintenance, supply, demand, vision).",
    "tw_asset_health": "Health, vibration and hours-to-trip per twin asset over time.",
    "tw_stock_levels": "On-hand and days of supply per twin material over time.",
    "tw_demand_history": "Generated daily demand history per twin product (simulated).",
    "tw_inspections": "AOI inspections of twin products with the human disposition.",
}

_ready = False


def ensure_tables() -> None:
    global _ready
    if _ready:
        return
    conn = connection()
    with write_lock:
        for stmt in DDL:
            conn.execute(stmt)
    _ready = True


def _conn():
    ensure_tables()
    return connection()


def save_snapshot(facility_id: str, name: str, sim_hour: float, features: list[str], data: dict[str, Any]) -> str:
    at = now_iso()
    with write_lock:
        _conn().execute(
            """INSERT INTO tw_snapshots (facility_id, facility_name, sim_hour, features, synced_at, data) VALUES (?,?,?,?,?,?)
               ON CONFLICT(facility_id) DO UPDATE SET facility_name=excluded.facility_name, sim_hour=excluded.sim_hour,
               features=excluded.features, synced_at=excluded.synced_at, data=excluded.data""",
            (facility_id, name, sim_hour, json.dumps(features), at, json.dumps(data)),
        )
    return at


def snapshot_meta(facility_id: str) -> dict[str, Any] | None:
    r = _conn().execute("SELECT facility_name, sim_hour, features, synced_at FROM tw_snapshots WHERE facility_id = ?", (facility_id,)).fetchone()
    return None if r is None else {"facility_name": r["facility_name"], "sim_hour": r["sim_hour"], "features": json.loads(r["features"]), "synced_at": r["synced_at"]}


def load_snapshot(facility_id: str) -> dict[str, Any] | None:
    r = _conn().execute("SELECT data FROM tw_snapshots WHERE facility_id = ?", (facility_id,)).fetchone()
    return None if r is None else json.loads(r["data"])


def save_insight(facility_id: str, feature: str, sim_hour: float, data: dict[str, Any]) -> None:
    with write_lock:
        _conn().execute(
            """INSERT INTO tw_insights (facility_id, feature, sim_hour, computed_at, data) VALUES (?,?,?,?,?)
               ON CONFLICT(facility_id, feature) DO UPDATE SET sim_hour=excluded.sim_hour, computed_at=excluded.computed_at, data=excluded.data""",
            (facility_id, feature, sim_hour, now_iso(), json.dumps(data)),
        )


def load_insights(facility_id: str) -> dict[str, dict[str, Any]]:
    rows = _conn().execute("SELECT feature, data FROM tw_insights WHERE facility_id = ?", (facility_id,)).fetchall()
    return {r["feature"]: json.loads(r["data"]) for r in rows}


def load_insight(facility_id: str, feature: str) -> dict[str, Any] | None:
    r = _conn().execute("SELECT data FROM tw_insights WHERE facility_id = ? AND feature = ?", (facility_id, feature)).fetchone()
    return None if r is None else json.loads(r["data"])


def record_asset_health(facility_id: str, sim_hour: float, rows: Iterable[tuple]) -> None:
    with write_lock:
        _conn().executemany(
            """INSERT OR REPLACE INTO tw_asset_health (facility_id, sim_hour, asset_id, health, vibration, temperature, hours_to_trip, zone, risk)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            [(facility_id, sim_hour, *r) for r in rows],
        )


def asset_health_series(facility_id: str, limit_hours: float = 72.0) -> list[dict[str, Any]]:
    rows = _conn().execute(
        """SELECT sim_hour, asset_id, health, vibration, temperature, hours_to_trip, zone, risk FROM tw_asset_health
           WHERE facility_id = ? AND sim_hour >= (SELECT COALESCE(MAX(sim_hour), 0) FROM tw_asset_health WHERE facility_id = ?) - ?
           ORDER BY sim_hour""",
        (facility_id, facility_id, limit_hours),
    ).fetchall()
    return [dict(r) for r in rows]


def record_stock_levels(facility_id: str, sim_hour: float, rows: Iterable[tuple]) -> None:
    with write_lock:
        _conn().executemany(
            "INSERT OR REPLACE INTO tw_stock_levels (facility_id, sim_hour, item_id, on_hand, days_of_supply, at_risk) VALUES (?,?,?,?,?,?)",
            [(facility_id, sim_hour, *r) for r in rows],
        )


def stock_series(facility_id: str, limit_hours: float = 72.0) -> list[dict[str, Any]]:
    rows = _conn().execute(
        """SELECT sim_hour, item_id, on_hand, days_of_supply, at_risk FROM tw_stock_levels
           WHERE facility_id = ? AND sim_hour >= (SELECT COALESCE(MAX(sim_hour), 0) FROM tw_stock_levels WHERE facility_id = ?) - ?
           ORDER BY sim_hour""",
        (facility_id, facility_id, limit_hours),
    ).fetchall()
    return [dict(r) for r in rows]


def demand_history(facility_id: str, product_id: str) -> list[dict[str, Any]]:
    rows = _conn().execute(
        "SELECT day, units FROM tw_demand_history WHERE facility_id = ? AND product_id = ? ORDER BY day", (facility_id, product_id)
    ).fetchall()
    return [{"date": r["day"], "actual_units": r["units"]} for r in rows]


def save_demand_history(facility_id: str, product_id: str, rows: list[tuple[str, float]]) -> None:
    with write_lock:
        _conn().executemany(
            "INSERT OR REPLACE INTO tw_demand_history (facility_id, product_id, day, units) VALUES (?,?,?,?)",
            [(facility_id, product_id, d, u) for d, u in rows],
        )


def record_inspection(facility_id: str, row: dict[str, Any]) -> None:
    with write_lock:
        _conn().execute(
            """INSERT OR REPLACE INTO tw_inspections (facility_id, inspection_id, camera_id, line_id, product_id, at, sim_hour, verdict, defect_count, disposition, data)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (facility_id, row["inspection_id"], row["camera_id"], row.get("line_id"), row.get("product_id"), row["at"], row["sim_hour"],
             row["verdict"], row["defect_count"], row.get("disposition", "pending"), json.dumps(row["data"], default=str)),
        )


def set_disposition(facility_id: str, inspection_id: str, disposition: str, auditor: str) -> bool:
    with write_lock:
        cur = _conn().execute(
            "UPDATE tw_inspections SET disposition = ?, auditor = ? WHERE facility_id = ? AND inspection_id = ?",
            (disposition, auditor, facility_id, inspection_id),
        )
    return cur.rowcount > 0


def inspections(facility_id: str, limit: int = 500) -> list[dict[str, Any]]:
    rows = _conn().execute(
        """SELECT inspection_id, camera_id, line_id, product_id, at, sim_hour, verdict, defect_count, disposition, auditor, data
           FROM tw_inspections WHERE facility_id = ? ORDER BY at DESC LIMIT ?""",
        (facility_id, limit),
    ).fetchall()
    return [{**{k: r[k] for k in r.keys() if k != "data"}, "data": json.loads(r["data"])} for r in rows]
