"""CMMS Adapter (SAP PM / IBM Maximo / Infor EAM).

Ingests maintenance work orders, failure codes, repair history, labor hours, and parts used.
Enables predictive correlation between sensor degradation and historical mechanical failures.
"""
import os
import csv
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from backend.features.predictive_maintenance.schemas.canonical_models import (
    FactWorkOrder,
    DataProvenance,
)
from backend.features.predictive_maintenance.connectors.models import (
    SourceSystemHealth,
    ConnectionState,
)

logger = logging.getLogger("connectors.cmms")


class CmmsAdapter:
    """Interfaces with enterprise Computerized Maintenance Management Systems."""

    def __init__(self) -> None:
        self.api_url = os.getenv("CMMS_API_URL")
        self.api_key = os.getenv("CMMS_API_KEY")
        self.drop_dir = os.getenv("CMMS_DROP_DIR", "data/drops/cmms")
        self.system_id = "CMMS-MAXIMO-PROD"
        self.records_count = 0
        self.last_sync: Optional[datetime] = None

    def get_health(self) -> SourceSystemHealth:
        missing = []
        if not self.api_url:
            missing.append("CMMS_API_URL environment variable")
        if not self.api_key:
            missing.append("CMMS_API_KEY environment variable")

        drop_path = Path(self.drop_dir)
        has_drop = drop_path.exists() and any(drop_path.glob("*.csv"))

        if (self.api_url and self.api_key) or has_drop:
            state = ConnectionState.CONNECTED if has_drop else ConnectionState.CONFIGURED_UNTESTED
            is_actual = True
            detail = f"Connected to CMMS via {self.api_url or str(drop_path)}"
        else:
            state = ConnectionState.SIMULATED_FALLBACK
            is_actual = False
            detail = "CMMS enterprise credentials unconfigured. Operating in labeled synthetic fallback."

        return SourceSystemHealth(
            system_id=self.system_id,
            system_name="Enterprise CMMS (Maximo / SAP PM)",
            system_type="CMMS",
            state=state,
            is_actual=is_actual,
            endpoint_or_path=self.api_url or str(drop_path),
            missing_prerequisites=missing,
            last_sync_timestamp=self.last_sync,
            records_ingested_count=self.records_count,
            data_freshness_seconds=None,
            status_detail=detail,
        )

    def ingest_records(self, raw_records: list[dict[str, Any]], provenance: Optional[DataProvenance] = None) -> list[FactWorkOrder]:
        orders = []
        prov = provenance or (DataProvenance.ACTUAL if (self.api_url and self.api_key) else DataProvenance.SIMULATED)

        for raw in raw_records:
            try:
                def parse_date(val):
                    if not val:
                        return None
                    if isinstance(val, datetime):
                        return val
                    try:
                        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
                    except Exception:
                        return None

                hours = float(raw.get("labor_hours", 0.0))
                rate = float(raw.get("labor_rate_usd", 75.0))
                parts = float(raw.get("spare_parts_cost_usd", 0.0))
                total = float(raw.get("total_cost_usd", (hours * rate) + parts))

                wo = FactWorkOrder(
                    work_order_id=str(raw.get("work_order_id", f"WO-{raw.get('source_work_order_num', 'X')}")),
                    asset_id=str(raw.get("asset_id") or "UNKNOWN"),
                    source_work_order_num=str(raw.get("source_work_order_num") or raw.get("work_order_num", "WO-000")),
                    work_order_type=str(raw.get("work_order_type", "CORRECTIVE")),
                    failure_code=raw.get("failure_code"),
                    failure_description=raw.get("failure_description"),
                    work_status=str(raw.get("work_status", "COMPLETED")),
                    scheduled_start=parse_date(raw.get("scheduled_start")),
                    actual_start=parse_date(raw.get("actual_start")),
                    actual_finish=parse_date(raw.get("actual_finish")),
                    labor_hours=hours,
                    labor_rate_usd=rate,
                    spare_parts_cost_usd=parts,
                    total_cost_usd=total,
                    technician_notes=raw.get("technician_notes"),
                    source_system=self.system_id,
                    data_provenance=prov,
                )
                orders.append(wo)
            except Exception as e:
                logger.warning(f"Malformed CMMS work order record skipped: {raw} ({e})")

        self.records_count += len(orders)
        self.last_sync = datetime.now(timezone.utc)
        return orders
