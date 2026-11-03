"""SQLite tables of predictive maintenance: telemetry, predictions, asset catalogue, recommendations,
ROI ledger, technician feedback and the RAG knowledge base."""
from backend.core.db import TableSpec
from backend.features.predictive_maintenance.schemas.canonical_models import DimAsset, FactMaintenanceRecommendation, FactRoiLedger
from backend.features.predictive_maintenance.schemas.sensor_reading import SensorReadingEvent

F = "predictive_maintenance"


READINGS = TableSpec(
    "pm_sensor_readings", "Machine telemetry: vibration RMS, temperature, pressure, RPM, operating hours.", SensorReadingEvent,
    key=lambda m: m.timestamp.isoformat(), kind="series",
    columns={"reading_at": lambda m: m.timestamp, "vibration_mm_s": lambda m: m.vibration_mm_s, "temperature_c": lambda m: m.temperature_celsius,
             "pressure_bar": lambda m: m.pressure_bar, "rpm": lambda m: m.rpm, "plant_id": lambda m: m.plant_id},
    indexes=("reading_at",), feature=F)
PREDICTIONS = TableSpec(
    "pm_predictions", "Latest 24 h failure-risk prediction per machine.", None,
    columns={"failure_probability": lambda d: d.get("failure_probability"), "risk_category": lambda d: d.get("risk_category"),
             "predicted_at": lambda d: d.get("prediction_timestamp")},
    indexes=("risk_category",), feature=F)
ASSETS = TableSpec(
    "pm_assets", "Canonical enterprise asset catalogue (plant, line, criticality, downtime cost).", DimAsset,
    columns={"plant_id": lambda m: m.plant_id, "line_id": lambda m: m.line_id, "equipment_type": lambda m: m.equipment_type,
             "criticality": lambda m: m.criticality, "hourly_downtime_cost_usd": lambda m: m.hourly_downtime_cost_usd},
    indexes=("plant_id",), feature=F)
SOURCE_MAPPINGS = TableSpec("pm_source_mappings", "Source-system tag → canonical asset id (PLC, SCADA, CMMS, ERP).", None,
                            columns={"canonical_asset_id": lambda v: v}, indexes=("canonical_asset_id",), feature=F)
RECOMMENDATIONS = TableSpec(
    "pm_recommendations", "Prescriptive maintenance recommendations and their human approval.", FactMaintenanceRecommendation,
    columns={"asset_id": lambda m: m.asset_id, "approval_status": lambda m: m.approval_status, "approved_by": lambda m: m.approved_by,
             "created_at": lambda m: m.created_at},
    indexes=("asset_id", "approval_status"), feature=F)
ROI_LEDGER = TableSpec(
    "pm_roi_ledger", "Financial ledger of estimated and realised maintenance value.", FactRoiLedger, key=lambda m: m.ledger_id, kind="list",
    columns={"asset_id": lambda m: m.asset_id, "recorded_at": lambda m: m.recorded_at, "value_category": lambda m: m.value_category},
    indexes=("asset_id",), feature=F)
