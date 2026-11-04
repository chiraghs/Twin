"""Pydantic schemas and domain contracts for Manufacturing Demand Forecasting."""
from datetime import datetime, date, timezone
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


class DataProvenance(str, Enum):
    ACTUAL = "ACTUAL"
    SIMULATED = "SIMULATED"
    ESTIMATED = "ESTIMATED"
    QUARANTINED = "QUARANTINED"


class ItemCategory(str, Enum):
    RAW_MATERIAL = "RAW_MATERIAL"
    WORK_IN_PROGRESS = "WORK_IN_PROGRESS"
    FINISHED_GOOD = "FINISHED_GOOD"
    SPARE_PART = "SPARE_PART"


class ModelType(str, Enum):
    SEASONAL_NAIVE = "SEASONAL_NAIVE"
    EXPONENTIAL_SMOOTHING = "EXPONENTIAL_SMOOTHING"
    ARIMA = "ARIMA"
    GRADIENT_BOOSTED_TREES = "GRADIENT_BOOSTED_TREES"


class ForecastHorizon(int, Enum):
    DAYS_7 = 7
    DAYS_30 = 30
    DAYS_60 = 60
    DAYS_90 = 90


# ==============================================================================
# 1. Master Data Entities
# ==============================================================================
class PlantMaster(BaseModel):
    plant_id: str = Field(..., description="Unique plant identifier (e.g. PLANT_BANGALORE)")
    plant_name: str
    location_city: str
    country: str
    region: str = "APAC"
    active_production_lines: int
    rated_capacity_hours_per_day: float = 20.0
    shift_count: int = 2
    hourly_downtime_cost_usd: float = 3500.0


class ProductMaster(BaseModel):
    product_id: str = Field(..., description="Unique finished SKU or assembly ID")
    product_name: str
    category: ItemCategory = ItemCategory.FINISHED_GOOD
    target_plant_id: str
    unit_cost_usd: float
    selling_price_usd: float
    standard_lead_time_days: int = 14
    safety_stock_units: int = 200
    cycle_time_hours_per_unit: float = 1.8
    lot_size_units: int = 25


class ProductionLineMaster(BaseModel):
    line_id: str
    plant_id: str
    line_name: str
    daily_capacity_hours: float = 20.0
    primary_product_ids: list[str] = Field(default_factory=list)
    nominal_hourly_rate_units: float = 1.2


# ==============================================================================
# 2. Demand & Sales Order Entities
# ==============================================================================
class HistoricalDemandRecord(BaseModel):
    record_id: str
    product_id: str
    plant_id: str
    date_recorded: str
    actual_units: float
    sales_orders_count: int = 1
    unfulfilled_backlog_units: float = 0.0
    demand_shock_flag: bool = False
    data_provenance: DataProvenance = DataProvenance.ACTUAL


class SalesOrder(BaseModel):
    order_id: str
    customer_id: str
    customer_name: str
    product_id: str
    plant_id: str
    order_date: str
    requested_delivery_date: str
    quantity_units: int
    unit_price_usd: float
    total_amount_usd: float
    status: str = "CONFIRMED"  # PENDING | CONFIRMED | IN_PRODUCTION | SHIPPED


# ==============================================================================
# 3. Forecasting & Evaluation Entities
# ==============================================================================
class ForecastPoint(BaseModel):
    date: str
    p10_units: float
    p50_units: float
    p90_units: float
    baseline_units: float


class ForecastEvaluationMetrics(BaseModel):
    model_name: str
    horizon_days: int
    mae: float = Field(..., description="Mean Absolute Error")
    rmse: float = Field(..., description="Root Mean Squared Error")
    wape: float = Field(..., description="Weighted Absolute Percentage Error (0-1)")
    bias: float = Field(..., description="Forecast bias: sum(pred - actual) / sum(actual)")
    mape: Optional[float] = Field(None, description="Mean Absolute Percentage Error where meaningful")
    baseline_wape: float = 0.28
    wape_improvement_vs_baseline_pct: float = 0.0


class DemandForecastResult(BaseModel):
    forecast_id: str
    product_id: str
    product_name: str
    plant_id: str
    horizon_days: int
    generated_at: str
    model_name: str
    model_version: str = "v2.1"
    time_series_points: list[ForecastPoint] = Field(default_factory=list)
    total_forecasted_units: float
    daily_average_demand: float
    metrics: ForecastEvaluationMetrics
    data_provenance: DataProvenance = DataProvenance.ACTUAL


class DemandForecastRunRequest(BaseModel):
    product_id: str
    plant_id: str = "PLANT_BANGALORE"
    horizon_days: int = 30
    model_type: ModelType = ModelType.GRADIENT_BOOSTED_TREES


class ModelRegistryEntry(BaseModel):
    model_id: str
    model_type: ModelType
    display_name: str
    version: str
    is_active_champion: bool
    trained_on: str
    sample_count: int
    wape: float
    description: str


# ==============================================================================
# 4. Production Planning Entities
# ==============================================================================
class ProductionCapacityReport(BaseModel):
    line_id: str
    line_name: str
    plant_id: str
    total_capacity_hours: float
    scheduled_production_hours: float
    maintenance_downtime_hours: float
    available_headroom_hours: float
    utilization_pct: float
    is_bottleneck: bool = False


class RecommendedProductionOrder(BaseModel):
    recommendation_id: str
    product_id: str
    product_name: str
    plant_id: str
    line_id: str
    target_start_date: str
    target_completion_date: str
    forecast_demand_units: float
    target_safety_stock_units: float
    usable_inventory_units: float
    confirmed_incoming_supply_units: float
    net_requirements_units: float
    feasible_production_units: float
    unmet_demand_units: float
    infeasibility_reasons: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)


class ProductionPlanSummary(BaseModel):
    plant_id: str
    horizon_days: int
    total_forecast_demand_units: float
    total_planned_production_units: float
    capacity_utilization_pct: float
    projected_throughput_rate: float
    orders: list[RecommendedProductionOrder] = Field(default_factory=list)
    bottlenecks: list[str] = Field(default_factory=list)
    generated_at: str


class BottleneckReport(BaseModel):
    line_id: str
    plant_id: str
    constraint_type: str  # CAPACITY_HOURS | RAW_MATERIAL_SHORTAGE | PLANNED_MAINTENANCE | QUALITY_SCRAP
    severity: str  # CRITICAL | WARNING | NOMINAL
    description: str
    impacted_products: list[str] = Field(default_factory=list)
    hours_overloaded: float = 0.0


# ==============================================================================
# 5. Inventory Optimization Entities
# ==============================================================================
class InventoryPosition(BaseModel):
    part_or_sku_id: str
    item_name: str
    category: ItemCategory
    plant_id: str
    stock_on_hand: int
    stock_allocated: int
    stock_usable: int
    daily_consumption_rate: float
    days_on_hand: float
    safety_stock_units: int
    reorder_point_units: int
    confirmed_incoming_pos: int
    potential_stockout_risk: bool
    stockout_eta_days: Optional[float] = None


class ReplenishmentRecommendation(BaseModel):
    recommendation_id: str
    item_id: str
    item_name: str
    category: ItemCategory
    plant_id: str
    current_usable_stock: int
    reorder_point: int
    safety_stock: int
    suggested_order_quantity: int
    supplier_id: str
    supplier_lead_time_days: int
    urgency: str  # CRITICAL | HIGH | MEDIUM | ROUTINE
    estimated_cost_usd: float


class InventorySummaryResponse(BaseModel):
    plant_id: str
    total_skus_monitored: int
    raw_material_items_count: int
    wip_items_count: int
    finished_goods_count: int
    spare_parts_count: int
    average_days_on_hand: float
    skus_at_stockout_risk_count: int
    positions: list[InventoryPosition] = Field(default_factory=list)


# ==============================================================================
# 6. Maintenance & Equipment Entities
# ==============================================================================
class EquipmentAssetReport(BaseModel):
    asset_id: str
    asset_name: str
    plant_id: str
    line_id: str
    availability_pct: float
    historical_downtime_hours_30d: float
    mtbf_hours: float = Field(..., description="Mean Time Between Failures")
    mttr_hours: float = Field(..., description="Mean Time To Repair")
    active_maintenance_orders_count: int
    planned_downtime_hours_next_14d: float
    capacity_at_risk_hours: float
    health_status: str  # HEALTHY | WARNING | CRITICAL


class DowntimeEventReport(BaseModel):
    event_id: str
    asset_id: str
    plant_id: str
    downtime_start: str
    downtime_end: Optional[str]
    duration_hours: float
    reason: str  # PLANNED_PM | UNPLANNED_TRIP | TOOL_CHANGEOVER
    production_hours_lost: float
    resolved: bool = True


# ==============================================================================
# 7. Quality Analytics Entities
# ==============================================================================
class QualityMetricsSummary(BaseModel):
    plant_id: str
    product_id: Optional[str] = None
    inspected_units_total: int
    defective_units_total: int
    scrapped_units_total: int
    reworked_units_total: int
    first_pass_yield_pct: float  # FPY
    defect_rate_pct: float
    scrap_rate_pct: float
    estimated_usable_output_pct: float
    dpmo: float = Field(..., description="Defects Per Million Opportunities")


class QualityTrendRecord(BaseModel):
    date: str
    plant_id: str
    fpy_pct: float
    scrap_rate_pct: float
    defect_type_primary: str


# ==============================================================================
# 8. What-If Scenario Simulation Entities
# ==============================================================================
class ScenarioSimulationRequest(BaseModel):
    scenario_name: str
    plant_id: str = "PLANT_BANGALORE"
    demand_growth_pct: float = 0.0
    demand_spike_duration_days: int = 14
    supplier_lead_time_delta_days: int = 0
    raw_material_availability_pct: float = 100.0
    equipment_downtime_hours_extra: float = 0.0
    production_capacity_delta_pct: float = 0.0
    scrap_rate_delta_pct: float = 0.0
    safety_stock_multiplier: float = 1.0


class ScenarioSimulationResult(BaseModel):
    scenario_id: str
    scenario_name: str
    plant_id: str
    created_at: str
    baseline_forecast_units: float
    simulated_forecast_units: float
    forecast_delta_units: float
    baseline_capacity_utilization_pct: float
    simulated_capacity_utilization_pct: float
    capacity_shortfall_hours: float
    simulated_stockouts_count: int
    estimated_revenue_delta_usd: float
    estimated_cost_delta_usd: float
    net_financial_impact_usd: float
    bottlenecks_identified: list[str] = Field(default_factory=list)
    key_assumptions: list[str] = Field(default_factory=list)
    constraint_explanations: list[str] = Field(default_factory=list)
    data_provenance: DataProvenance = DataProvenance.SIMULATED


# ==============================================================================
# 9. Ingestion & Pipeline Entities
# ==============================================================================
class IngestPayload(BaseModel):
    batch_source: str = "ERP_BATCH_EXTRACT"
    records_count: int
    records: list[dict[str, Any]] = Field(default_factory=list)
    target_table: str = "historical_demand"


class IngestBatchStatus(BaseModel):
    batch_id: str
    target_table: str
    records_received: int
    records_validated: int
    records_quarantined: int
    duplicate_records_skipped: int
    status: str  # SUCCESS | COMPLETED_WITH_WARNINGS | FAILED
    error_summary: list[str] = Field(default_factory=list)
    timestamp: str


class PipelineRunStatus(BaseModel):
    pipeline_id: str
    pipeline_name: str
    last_run_timestamp: str
    status: str
    records_processed: int
    duration_seconds: float


class DataQualityReport(BaseModel):
    total_records_ingested: int
    valid_records_pct: float
    quarantined_records_count: int
    missing_timestamp_count: int
    negative_quantity_quarantined_count: int
    schema_compliance_status: str
