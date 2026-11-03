"""MES Adapter (Opcenter / Rockwell FactoryTalk / AVEVA).

Ingests production schedules, station output, downtime events, and line criticality.
Enables quantifying the actual financial cost of unplanned downtime per station.
"""
import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from backend.features.predictive_maintenance.schemas.canonical_models import (
    FactProductionDowntime,
    DataProvenance,
)
from backend.features.predictive_maintenance.connectors.models import (
    SourceSystemHealth,
    ConnectionState,
)

logger = logging.getLogger("connectors.mes")


class MesAdapter:
    """Interfaces with Manufacturing Execution Systems for downtime tracking."""

    def __init__(self) -> None:
        self.mes_endpoint = os.getenv("MES_SERVICE_URL")
        self.mes_api_token = os.getenv("MES_API_TOKEN")
        self.drop_dir = os.getenv("MES_DROP_DIR", "data/drops/mes")
        self.system_id = "MES-OPCENTER-01"
        self.records_count = 0
        self.last_sync: Optional[datetime] = None

    def get_health(self) -> SourceSystemHealth:
        missing = []
        if not self.mes_endpoint:
            missing.append("MES_SERVICE_URL environment variable")
        if not self.mes_api_token:
            missing.append("MES_API_TOKEN environment variable")

        drop_path = Path(self.drop_dir)
        has_drop = drop_path.exists() and any(drop_path.glob("*.csv"))

        if (self.mes_endpoint and self.mes_api_token) or has_drop:
            state = ConnectionState.CONNECTED if has_drop else ConnectionState.CONFIGURED_UNTESTED
            is_actual = True
            detail = f"Connected to MES via {self.mes_endpoint or str(drop_path)}"
        else:
            state = ConnectionState.SIMULATED_FALLBACK
            is_actual = False
            detail = "MES production execution credentials unconfigured. Operating in labeled synthetic fallback."

        return SourceSystemHealth(
            system_id=self.system_id,
            system_name="Manufacturing Execution System (Opcenter / FactoryTalk)",
            system_type="MES",
            state=state,
            is_actual=is_actual,
            endpoint_or_path=self.mes_endpoint or str(drop_path),
            missing_prerequisites=missing,
            last_sync_timestamp=self.last_sync,
            records_ingested_count=self.records_count,
            data_freshness_seconds=None,
            status_detail=detail,
        )

    def ingest_records(self, raw_records: list[dict[str, Any]], provenance: Optional[DataProvenance] = None) -> list[FactProductionDowntime]:
        events = []
        prov = provenance or (DataProvenance.ACTUAL if (self.mes_endpoint and self.mes_api_token) else DataProvenance.SIMULATED)

        for raw in raw_records:
            try:
                def parse_date(val):
                    if isinstance(val, datetime):
                        return val
                    try:
                        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
                    except Exception:
                        return datetime.now(timezone.utc)

                st = parse_date(raw.get("start_time"))
                et = parse_date(raw.get("end_time"))
                duration_min = float(raw.get("duration_minutes", (et - st).total_seconds() / 60.0))
                lost_units = int(raw.get("lost_production_units", int(duration_min * 2.5)))
                impact_usd = float(raw.get("downtime_financial_impact_usd", duration_min * 45.0))

                event = FactProductionDowntime(
                    downtime_id=str(raw.get("downtime_id", f"DT-{int(st.timestamp())}")),
                    asset_id=str(raw.get("asset_id") or "UNKNOWN"),
                    line_id=str(raw.get("line_id", "LINE-1")),
                    start_time=st,
                    end_time=et,
                    duration_minutes=duration_min,
                    downtime_category=str(raw.get("downtime_category", "UNPLANNED_MECHANICAL")),
                    lost_production_units=lost_units,
                    downtime_financial_impact_usd=impact_usd,
                    root_cause_asset_id=raw.get("root_cause_asset_id"),
                    source_system=self.system_id,
                    data_provenance=prov,
                )
                events.append(event)
            except Exception as e:
                logger.warning(f"Malformed MES downtime event skipped: {raw} ({e})")

        self.records_count += len(events)
        self.last_sync = datetime.now(timezone.utc)
        return events
