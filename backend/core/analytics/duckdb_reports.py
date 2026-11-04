"""Analytics reports on DuckDB (open source, in-process) over the shared SQLite database.

Each report copies only the tables it needs from SQLite into an in-memory DuckDB database
(via a temporary CSV, so no DuckDB extension download is needed) and runs a fixed SQL query.
Reports are predefined: no caller-supplied SQL reaches DuckDB.

At larger scale, the same queries run unchanged on a columnar store (ClickHouse, or Iceberg
tables queried by Trino/Presto); see "Scaling to market standards" in the README.
"""
from __future__ import annotations

import csv
import os
import tempfile
import time
from typing import Any

import duckdb

from backend.core.db.connection import connection

_TYPES = {"INTEGER": "BIGINT", "REAL": "DOUBLE"}

REPORTS: dict[str, dict[str, Any]] = {
    "demand-monthly": {
        "title": "Monthly demand by product",
        "tables": ["df_demand_history"],
        "sql": """
            SELECT product_id, plant_id, strftime(TRY_CAST(recorded_at AS TIMESTAMP), '%Y-%m') AS month,
                   round(sum(actual_units), 1) AS units
            FROM df_demand_history GROUP BY ALL ORDER BY month, product_id, plant_id""",
    },
    "sensor-health": {
        "title": "Sensor health by asset",
        "tables": ["pm_sensor_readings"],
        "sql": """
            SELECT group_key AS asset_id, count(*) AS readings,
                   round(avg(TRY_CAST(vibration_mm_s AS DOUBLE)), 2) AS avg_vibration_mm_s,
                   round(max(TRY_CAST(vibration_mm_s AS DOUBLE)), 2) AS max_vibration_mm_s,
                   round(avg(temperature_c), 1) AS avg_temperature_c,
                   max(reading_at) AS last_reading_at
            FROM pm_sensor_readings GROUP BY ALL ORDER BY max_vibration_mm_s DESC NULLS LAST""",
    },
    "supplier-exposure": {
        "title": "Open purchase orders by supplier risk",
        "tables": ["sc_suppliers", "sc_purchase_orders"],
        "sql": """
            SELECT s.risk_level, s.country, count(DISTINCT s.key) AS suppliers, count(p.key) AS purchase_orders
            FROM sc_suppliers s LEFT JOIN sc_purchase_orders p ON p.supplier_id = s.key
            GROUP BY ALL ORDER BY purchase_orders DESC, suppliers DESC""",
    },
    "ai-usage": {
        "title": "Meta Model API usage",
        "tables": ["ai_calls"],
        "sql": """
            SELECT component, model, count(*) AS calls, round(avg(ok) * 100, 1) AS success_pct,
                   round(quantile_cont(latency_ms, 0.5)) AS p50_latency_ms,
                   round(quantile_cont(latency_ms, 0.95)) AS p95_latency_ms
            FROM ai_calls GROUP BY ALL ORDER BY calls DESC""",
    },
}


def _load(duck: duckdb.DuckDBPyConnection, table: str, tmpdir: str) -> None:
    sqlite = connection()
    cols = [(r["name"], _TYPES.get((r["type"] or "").upper(), "VARCHAR")) for r in sqlite.execute(f"PRAGMA table_info({table})")]
    if not cols:  # table not created yet: an empty table keeps the report query valid
        raise LookupError(table)
    path = os.path.join(tmpdir, f"{table}.csv")
    cur = sqlite.execute(f"SELECT {', '.join(c for c, _ in cols)} FROM {table}")
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([c for c, _ in cols])
        w.writerows(tuple(cur))
    types = ", ".join(f"'{c}': '{t}'" for c, t in cols)
    duck.execute(f"CREATE TABLE {table} AS SELECT * FROM read_csv(?, header = true, columns = {{{types}}})", [path])


def run_report(report_id: str) -> dict[str, Any]:
    report = REPORTS.get(report_id)
    if not report:
        raise KeyError(report_id)
    started = time.perf_counter()
    duck = duckdb.connect(":memory:")
    try:
        with tempfile.TemporaryDirectory(prefix="twin-duck-") as tmpdir:
            for table in report["tables"]:
                try:
                    _load(duck, table, tmpdir)
                except LookupError:
                    return {"id": report_id, "title": report["title"], "columns": [], "rows": [], "engine": "duckdb",
                            "note": f"{table} has no data yet"}
        duck.execute("SET enable_external_access = false")
        cur = duck.execute(report["sql"])
        columns = [d[0] for d in cur.description]
        rows = [dict(zip(columns, r)) for r in cur.fetchall()]
    finally:
        duck.close()
    return {"id": report_id, "title": report["title"], "columns": columns, "rows": rows, "engine": f"duckdb {duckdb.__version__}",
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1)}
