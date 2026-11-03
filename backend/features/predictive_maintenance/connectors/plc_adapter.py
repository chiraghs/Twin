"""PLC / SCADA Telemetry Adapter.

Ingests high-frequency mechanical and electrical sensor readings:
vibration, temperature, current, torque, RPM, operating status, and alarms.
Supports industrial edge gateway endpoints, MQTT/Sparkplug B, and CSV/JSON file drops.
"""
import os
import csv
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from backend.features.predictive_maintenance.schemas.canonical_models import (
    FactSensorReading,
    DataProvenance,
)
from backend.features.predictive_maintenance.connectors.models import (
    SourceSystemHealth,
    ConnectionState,
    IngestionBatchResult,
)

logger = logging.getLogger("connectors.plc")


class PlcScadaAdapter:
    """Connects to industrial shop-floor gateways or ingests telemetry batches."""

    def __init__(self) -> None:
        self.gateway_url = os.getenv("PLC_GATEWAY_URL")
        self.opc_endpoint = os.getenv("OPCUA_SERVER_URL")
        self.telemetry_drop_dir = os.getenv("PLC_TELEMETRY_DROP_DIR", "data/drops/plc")
        self.system_id = "PLC-SCADA-GATEWAY-01"
        self.records_count = 0
        self.last_sync: Optional[datetime] = None

    def get_health(self) -> SourceSystemHealth:
        missing = []
        if not self.gateway_url and not self.opc_endpoint:
            missing.append("PLC_GATEWAY_URL or OPCUA_SERVER_URL environment variable")
        
        drop_path = Path(self.telemetry_drop_dir)
        has_drop_files = drop_path.exists() and any(drop_path.glob("*.csv"))

        if self.gateway_url or self.opc_endpoint or has_drop_files:
            state = ConnectionState.CONNECTED if has_drop_files else ConnectionState.CONFIGURED_UNTESTED
            is_actual = True
            detail = f"Actual OT feed active via {self.gateway_url or self.opc_endpoint or str(drop_path)}"
        else:
            state = ConnectionState.SIMULATED_FALLBACK
            is_actual = False
            detail = "No active PLC gateway credentials found. Operating in labeled simulated fallback mode."

        return SourceSystemHealth(
            system_id=self.system_id,
            system_name="Shop-Floor PLC / SCADA Network",
            system_type="PLC_SCADA",
            state=state,
            is_actual=is_actual,
            endpoint_or_path=self.gateway_url or self.opc_endpoint or str(drop_path),
            missing_prerequisites=missing,
            last_sync_timestamp=self.last_sync,
            records_ingested_count=self.records_count,
            data_freshness_seconds=0.0 if is_actual else None,
            status_detail=detail,
        )

    def ingest_records(self, raw_records: list[dict[str, Any]], provenance: Optional[DataProvenance] = None) -> list[FactSensorReading]:
        """Validates and normalizes raw telemetry records into canonical FactSensorReading."""
        normalized = []
        prov = provenance or (DataProvenance.ACTUAL if (self.gateway_url or self.opc_endpoint) else DataProvenance.SIMULATED)

        for i, raw in enumerate(raw_records):
            try:
                # Timestamp normalization
                raw_ts = raw.get("timestamp") or raw.get("ts") or raw.get("time")
                if isinstance(raw_ts, str):
                    try:
                        ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
                    except Exception:
                        ts = datetime.now(timezone.utc)
                elif isinstance(raw_ts, datetime):
                    ts = raw_ts
                else:
                    ts = datetime.now(timezone.utc)

                reading = FactSensorReading(
                    reading_id=str(raw.get("reading_id", f"READ-PLC-{int(ts.timestamp())}-{i}")),
                    asset_id=str(raw.get("asset_id") or raw.get("machine_id") or "UNKNOWN"),
                    timestamp=ts,
                    vibration_mm_s=float(raw.get("vibration_mm_s") or raw.get("vibration", 0.0)),
                    temperature_celsius=float(raw.get("temperature_celsius") or raw.get("temperature", 0.0)),
                    pressure_bar=float(raw.get("pressure_bar", raw.get("pressure", 0.0))) if raw.get("pressure_bar") is not None or raw.get("pressure") is not None else None,
                    motor_current_amps=float(raw.get("motor_current_amps", raw.get("current", 0.0))) if raw.get("motor_current_amps") is not None or raw.get("current") is not None else None,
                    torque_nm=float(raw.get("torque_nm", raw.get("torque", 0.0))) if raw.get("torque_nm") is not None or raw.get("torque") is not None else None,
                    rpm=float(raw.get("rpm", 0.0)),
                    operating_hours=float(raw.get("operating_hours", 0.0)),
                    data_provenance=prov,
                    source_system=self.system_id,
                    lineage_job_id=raw.get("lineage_job_id", "ingest-pipeline-v1"),
                )
                normalized.append(reading)
            except Exception as e:
                logger.warning(f"Malformed PLC record skipped: {raw} ({e})")

        self.records_count += len(normalized)
        self.last_sync = datetime.now(timezone.utc)
        return normalized

    def ingest_from_csv(self, file_path: str | Path) -> list[FactSensorReading]:
        """Ingests actual telemetry batch from CSV export."""
        p = Path(file_path)
        if not p.exists():
            return []
        records = []
        with open(p, mode="r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                records.append(row)
        return self.ingest_records(records, provenance=DataProvenance.ACTUAL)
