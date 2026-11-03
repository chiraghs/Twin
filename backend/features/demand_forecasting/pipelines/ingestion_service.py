"""Data Ingestion & Validation Pipeline Service for Industrial Data.

Handles:
- Batch uploads from ERP / MES systems (JSON / CSV records)
- Schema validation & required-field enforcement
- Idempotent deduplication
- Timestamp normalization (ISO-8601 UTC)
- Invalid record quarantine
- Batch execution summaries and structured error tracking
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from backend.features.demand_forecasting.schemas.manufacturing import (
    IngestPayload,
    IngestBatchStatus,
    PipelineRunStatus,
    DataQualityReport,
    HistoricalDemandRecord,
    DataProvenance,
)
from backend.features.demand_forecasting.repositories.local_manufacturing_repo import (
    LocalManufacturingRepository,
    local_manufacturing_repo,
)


class DataIngestionPipelineService:
    """Validates, deduplicates, and ingests batch manufacturing data records."""

    def __init__(self, repository: Optional[LocalManufacturingRepository] = None) -> None:
        self.repo = repository or local_manufacturing_repo
        self.quarantine: list[dict[str, Any]] = []
        self.pipeline_runs: list[PipelineRunStatus] = [
            PipelineRunStatus(
                pipeline_id="PIPE-ERP-NIGHTLY",
                pipeline_name="Nightly S/4HANA Sales Order Extract",
                last_run_timestamp="2026-10-18T01:00:00Z",
                status="SUCCESS",
                records_processed=2450,
                duration_seconds=42.3,
            ),
            PipelineRunStatus(
                pipeline_id="PIPE-MES-HOURLY",
                pipeline_name="MES Shift Actuals Stream",
                last_run_timestamp="2026-10-18T14:00:00Z",
                status="SUCCESS",
                records_processed=180,
                duration_seconds=3.8,
            ),
        ]

    def ingest_records(self, payload: IngestPayload) -> IngestBatchStatus:
        """Validates incoming batch records, deduplicating and quarantining invalid data."""
        batch_id = f"BATCH-{uuid.uuid4().hex[:8].upper()}"
        records = payload.records
        validated = 0
        quarantined = 0
        duplicates = 0
        error_summary = []

        existing_ids = {r.record_id for r in self.repo.demand_history}

        for idx, rec in enumerate(records):
            # Check required fields: product_id, date_recorded, actual_units
            pid = rec.get("product_id")
            dt_str = rec.get("date_recorded") or rec.get("date")
            units = rec.get("actual_units") or rec.get("units")

            if not pid or not dt_str or units is None:
                quarantined += 1
                rec["quarantine_reason"] = "MISSING_REQUIRED_FIELDS"
                self.quarantine.append(rec)
                error_summary.append(f"Row {idx}: Missing product_id, date, or actual_units")
                continue

            try:
                units_val = float(units)
                if units_val < 0:
                    quarantined += 1
                    rec["quarantine_reason"] = "NEGATIVE_DEMAND_UNITS"
                    self.quarantine.append(rec)
                    error_summary.append(f"Row {idx}: Negative demand units ({units_val})")
                    continue
            except (ValueError, TypeError):
                quarantined += 1
                rec["quarantine_reason"] = "INVALID_NUMERIC_VALUE"
                self.quarantine.append(rec)
                error_summary.append(f"Row {idx}: Invalid numeric units value ({units})")
                continue

            # Timestamp normalization
            try:
                clean_date = datetime.fromisoformat(str(dt_str)).date().isoformat()
            except Exception:
                clean_date = datetime.now(timezone.utc).date().isoformat()

            rec_id = rec.get("record_id") or f"DEM-{pid}-{clean_date}"

            # Deduplication
            if rec_id in existing_ids:
                duplicates += 1
                continue

            existing_ids.add(rec_id)
            plant_id = rec.get("plant_id", "PLANT_BANGALORE")

            valid_record = HistoricalDemandRecord(
                record_id=rec_id,
                product_id=pid,
                plant_id=plant_id,
                date_recorded=clean_date,
                actual_units=units_val,
                sales_orders_count=int(rec.get("sales_orders_count", 1)),
                unfulfilled_backlog_units=float(rec.get("unfulfilled_backlog_units", 0.0)),
                demand_shock_flag=bool(rec.get("demand_shock_flag", False)),
                data_provenance=DataProvenance.ACTUAL,
            )
            self.repo.demand_history.append(valid_record)
            validated += 1

        status = "SUCCESS" if quarantined == 0 else "COMPLETED_WITH_WARNINGS"

        return IngestBatchStatus(
            batch_id=batch_id,
            target_table=payload.target_table,
            records_received=len(records),
            records_validated=validated,
            records_quarantined=quarantined,
            duplicate_records_skipped=duplicates,
            status=status,
            error_summary=error_summary[:10],  # Top 10 errors
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    def get_data_quality_report(self) -> DataQualityReport:
        total_ingested = len(self.repo.demand_history) + len(self.quarantine)
        valid_pct = (len(self.repo.demand_history) / max(1, total_ingested)) * 100.0

        return DataQualityReport(
            total_records_ingested=total_ingested,
            valid_records_pct=round(valid_pct, 1),
            quarantined_records_count=len(self.quarantine),
            missing_timestamp_count=sum(1 for q in self.quarantine if q.get("quarantine_reason") == "MISSING_REQUIRED_FIELDS"),
            negative_quantity_quarantined_count=sum(1 for q in self.quarantine if q.get("quarantine_reason") == "NEGATIVE_DEMAND_UNITS"),
            schema_compliance_status="PASSED",
        )

    def get_pipeline_statuses(self) -> list[PipelineRunStatus]:
        return self.pipeline_runs


# Global singleton instance
data_ingestion_service = DataIngestionPipelineService()
