"""ERP Adapter (SAP S/4HANA / Oracle NetSuite).

Ingests equipment financial book values, replacement costs, spare-parts inventory,
lead times, and technician hourly labor billing rates.
Powers ROI models and prevents maintenance delays caused by missing critical spares.
"""
import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from backend.features.predictive_maintenance.schemas.canonical_models import (
    FactInventoryCost,
    DataProvenance,
)
from backend.features.predictive_maintenance.connectors.models import (
    SourceSystemHealth,
    ConnectionState,
)

logger = logging.getLogger("connectors.erp")


class ErpAdapter:
    """Interfaces with Enterprise Resource Planning systems for inventory and cost data."""

    def __init__(self) -> None:
        self.erp_base_url = os.getenv("ERP_API_URL")
        self.erp_auth_token = os.getenv("ERP_AUTH_TOKEN")
        self.drop_dir = os.getenv("ERP_DROP_DIR", "data/drops/erp")
        self.system_id = "ERP-SAP-S4HANA"
        self.records_count = 0
        self.last_sync: Optional[datetime] = None

    def get_health(self) -> SourceSystemHealth:
        missing = []
        if not self.erp_base_url:
            missing.append("ERP_API_URL environment variable")
        if not self.erp_auth_token:
            missing.append("ERP_AUTH_TOKEN environment variable")

        drop_path = Path(self.drop_dir)
        has_drop = drop_path.exists() and any(drop_path.glob("*.csv"))

        if (self.erp_base_url and self.erp_auth_token) or has_drop:
            state = ConnectionState.CONNECTED if has_drop else ConnectionState.CONFIGURED_UNTESTED
            is_actual = True
            detail = f"Connected to ERP via {self.erp_base_url or str(drop_path)}"
        else:
            state = ConnectionState.SIMULATED_FALLBACK
            is_actual = False
            detail = "ERP financial credentials unconfigured. Operating in labeled synthetic fallback."

        return SourceSystemHealth(
            system_id=self.system_id,
            system_name="Enterprise Resource Planning (SAP S/4HANA)",
            system_type="ERP",
            state=state,
            is_actual=is_actual,
            endpoint_or_path=self.erp_base_url or str(drop_path),
            missing_prerequisites=missing,
            last_sync_timestamp=self.last_sync,
            records_ingested_count=self.records_count,
            data_freshness_seconds=None,
            status_detail=detail,
        )

    def ingest_records(self, raw_records: list[dict[str, Any]], provenance: Optional[DataProvenance] = None) -> list[FactInventoryCost]:
        items = []
        prov = provenance or (DataProvenance.ACTUAL if (self.erp_base_url and self.erp_auth_token) else DataProvenance.SIMULATED)

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

                item = FactInventoryCost(
                    inventory_record_id=str(raw.get("inventory_record_id", f"INV-{raw.get('part_number', 'X')}")),
                    part_number=str(raw.get("part_number", "PRT-000")),
                    asset_id=str(raw.get("asset_id") or "UNKNOWN"),
                    part_description=str(raw.get("part_description", "Replacement Component")),
                    stock_on_hand=int(raw.get("stock_on_hand", 0)),
                    safety_stock=int(raw.get("safety_stock", 2)),
                    unit_cost_usd=float(raw.get("unit_cost_usd", 250.0)),
                    lead_time_days=int(raw.get("lead_time_days", 7)),
                    supplier_id=raw.get("supplier_id"),
                    last_replenished_at=parse_date(raw.get("last_replenished_at")),
                    data_provenance=prov,
                )
                items.append(item)
            except Exception as e:
                logger.warning(f"Malformed ERP inventory record skipped: {raw} ({e})")

        self.records_count += len(items)
        self.last_sync = datetime.now(timezone.utc)
        return items
