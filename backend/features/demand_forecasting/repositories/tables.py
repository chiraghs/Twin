"""SQLite tables of demand forecasting and operations planning."""
import hashlib
import json

from backend.core.db import TableSpec
from backend.features.demand_forecasting.schemas.manufacturing import (
    DemandForecastResult, DowntimeEventReport, EquipmentAssetReport, HistoricalDemandRecord, IngestBatchStatus,
    InventoryPosition, ModelRegistryEntry, PipelineRunStatus, PlantMaster, ProductionLineMaster, ProductMaster,
    QualityMetricsSummary, QualityTrendRecord, ReplenishmentRecommendation, SalesOrder, ScenarioSimulationResult,
)

F = "demand_forecasting"
DF_TABLES = {
    "plants": TableSpec("df_plants", "Plant master data.", PlantMaster, feature=F),
    "products": TableSpec("df_products", "Product master: family, price, cost, lead times.", ProductMaster, feature=F),
    "lines": TableSpec("df_production_lines", "Line master: capacity, shifts, products.", ProductionLineMaster,
                       columns={"plant_id": lambda m: m.plant_id}, feature=F),
    "demand_history": TableSpec("df_demand_history", "Daily actual demand per product and plant.", HistoricalDemandRecord,
                                key=lambda m: m.record_id, kind="list",
                                columns={"product_id": lambda m: m.product_id, "plant_id": lambda m: m.plant_id,
                                         "recorded_at": lambda m: m.date_recorded, "actual_units": lambda m: m.actual_units},
                                indexes=("product_id", "recorded_at"), feature=F),
    "sales_orders": TableSpec("df_sales_orders", "Open sales orders.", SalesOrder,
                              columns={"product_id": lambda m: m.product_id, "plant_id": lambda m: m.plant_id}, feature=F),
    "inventory_positions": TableSpec("df_inventory_positions", "Inventory positions: on hand, safety stock, ROP, stock-out ETA.", InventoryPosition,
                                     columns={"plant_id": lambda m: m.plant_id, "category": lambda m: m.category,
                                              "days_on_hand": lambda m: m.days_on_hand}, indexes=("plant_id",), feature=F),
    "replenishment_recs": TableSpec("df_replenishment_recommendations", "Replenishment recommendations (quantity, supplier, urgency).",
                                    ReplenishmentRecommendation, columns={"item_id": lambda m: m.item_id, "urgency": lambda m: m.urgency}, feature=F),
    "equipment_assets": TableSpec("df_equipment_assets", "Equipment health and availability for capacity planning.", EquipmentAssetReport,
                                  columns={"plant_id": lambda m: m.plant_id}, feature=F),
    "downtime_events": TableSpec("df_downtime_events", "Planned and unplanned downtime events.", DowntimeEventReport,
                                 key=lambda m: m.event_id, kind="list",
                                 columns={"asset_id": lambda m: m.asset_id, "plant_id": lambda m: m.plant_id}, feature=F),
    "quality_summaries": TableSpec("df_quality_summaries", "Quality KPIs per plant / product.", QualityMetricsSummary, feature=F),
    "quality_trends": TableSpec("df_quality_trends", "Daily FPY and scrap trend.", QualityTrendRecord,
                                key=lambda m: f"{m.date}:{m.plant_id}", kind="list", columns={"plant_id": lambda m: m.plant_id}, feature=F),
    "model_registry": TableSpec("df_model_registry", "Forecast model registry with validation metrics.", ModelRegistryEntry,
                                columns={"model_type": lambda m: m.model_type}, feature=F),
}
FORECAST_RUNS = TableSpec("df_forecast_runs", "Forecast runs (P10 / P50 / P90 series and metrics).", DemandForecastResult,
                          columns={"product_id": lambda m: m.product_id, "plant_id": lambda m: m.plant_id}, indexes=("product_id",), feature=F)
SCENARIOS = TableSpec("df_scenarios", "What-if scenario simulations and their impact.", ScenarioSimulationResult,
                      columns={"plant_id": lambda m: m.plant_id, "created_at": lambda m: m.created_at}, feature=F)
PIPELINE_RUNS = TableSpec("df_pipeline_runs", "Data pipeline run status.", PipelineRunStatus, key=lambda m: m.pipeline_id, kind="list",
                          columns={"status": lambda m: m.status}, feature=F)
QUARANTINE = TableSpec("df_quarantine", "Quarantined ingestion records with the reason.", None,
                       key=lambda d: hashlib.sha1(json.dumps(d, sort_keys=True, default=str).encode()).hexdigest()[:20], kind="list",
                       columns={"reason_kind": lambda d: d.get("quarantine_reason")}, feature=F)
INGEST_BATCHES = TableSpec("df_ingest_batches", "Ingestion batch results (received, validated, quarantined, duplicates).", IngestBatchStatus,
                           key=lambda m: m.batch_id, kind="list",
                           columns={"target_table": lambda m: m.target_table, "status": lambda m: m.status, "ingested_at": lambda m: m.timestamp},
                           feature=F)
