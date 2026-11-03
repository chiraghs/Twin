"""FastAPI Router for Manufacturing Demand Forecasting & Operations Planning.

Exposes:
1. Master Data & Filtering (Plants, Products, Filters)
2. Demand Forecasting (History, Forecasts, Run, Metrics, Models)
3. Production Planning (Net Requirements, Capacity, Bottlenecks)
4. Inventory Optimization (Summary, Stockout Risks, Replenishment)
5. Maintenance & Equipment (Assets, Downtime, Capacity at Risk)
6. Quality Analytics (Metrics, Scrap Rates, Trends)
7. What-If Scenario Engine (Simulate, List, Get)
8. Ingestion & Data Pipelines (Ingest, Pipeline Status, Data Quality)
9. Backward-Compatible Legacy Endpoints
"""
from typing import Any, Optional
try:
    from fastapi import APIRouter, HTTPException, Query, Body
except ImportError:
    class HTTPException(Exception):
        def __init__(self, status_code: int = 400, detail: str = ""):
            self.status_code = status_code
            self.detail = detail
            super().__init__(detail)

    def Query(default=None, **kwargs):
        return default

    def Body(default=None, **kwargs):
        return default

    class APIRouter:
        def __init__(self, prefix: str = "", tags: list[str] = None):
            self.prefix = prefix
            self.tags = tags or []

        def get(self, path: str, **kwargs):
            def decorator(func):
                return func
            return decorator

        def post(self, path: str, **kwargs):
            def decorator(func):
                return func
            return decorator

        def put(self, path: str, **kwargs):
            def decorator(func):
                return func
            return decorator

from backend.features.demand_forecasting.schemas.manufacturing import (
    PlantMaster,
    ProductMaster,
    HistoricalDemandRecord,
    DemandForecastResult,
    DemandForecastRunRequest,
    ForecastEvaluationMetrics,
    ModelRegistryEntry,
    ProductionPlanSummary,
    ProductionCapacityReport,
    BottleneckReport,
    InventorySummaryResponse,
    InventoryPosition,
    ReplenishmentRecommendation,
    EquipmentAssetReport,
    DowntimeEventReport,
    QualityMetricsSummary,
    QualityTrendRecord,
    ScenarioSimulationRequest,
    ScenarioSimulationResult,
    IngestPayload,
    IngestBatchStatus,
    PipelineRunStatus,
    DataQualityReport,
    ModelType,
    ItemCategory,
)
from backend.features.demand_forecasting.domain.models import (
    ProbabilisticForecast,
    CapacityHeadroomReport,
)
from backend.features.demand_forecasting.config.models import (
    DemandForecastingConfig,
    demand_config_store,
)
from backend.features.demand_forecasting.repositories.local_manufacturing_repo import local_manufacturing_repo
from backend.features.demand_forecasting.services.forecast_service import demand_forecasting_service
from backend.features.demand_forecasting.services.production_planning_service import production_planning_service
from backend.features.demand_forecasting.services.inventory_service import inventory_optimization_service
from backend.features.demand_forecasting.services.maintenance_service import maintenance_equipment_service
from backend.features.demand_forecasting.services.quality_service import quality_analytics_service
from backend.features.demand_forecasting.services.scenario_service import what_if_scenario_engine
from backend.features.demand_forecasting.services.planning_brief_service import PlanningBrief, build_planning_brief
from backend.features.demand_forecasting.pipelines.ingestion_service import data_ingestion_service

from backend.core.db.runlog import RunLog

PRODUCTION_PLANS = RunLog("df_production_plans", "Generated constraint-aware production plans.", "demand_forecasting")
PLANNING_BRIEFS = RunLog("df_planning_briefs", "S&OP planning briefs (Muse Wonder, grounded).", "demand_forecasting")

router = APIRouter(tags=["Demand Forecasting & Operations Planning"])


# ==============================================================================
# 1. Master Data & Filtering
# ==============================================================================
@router.get("/ready")
async def readiness_probe() -> dict[str, Any]:
    """Readiness probe indicating analytical engine and in-memory lakehouse are ready."""
    return {
        "ready": True,
        "database": "BigQuery (Local In-Memory Mode Active)",
        "plants_count": len(local_manufacturing_repo.plants),
        "products_count": len(local_manufacturing_repo.products),
        "demand_history_records": len(local_manufacturing_repo.demand_history),
    }


@router.get("/plants", response_model=list[PlantMaster])
async def list_plants() -> list[PlantMaster]:
    """Retrieve registered manufacturing plant facilities."""
    return list(local_manufacturing_repo.plants.values())


@router.get("/products", response_model=list[ProductMaster])
async def list_products() -> list[ProductMaster]:
    """Retrieve finished product and component master records."""
    return list(local_manufacturing_repo.products.values())


@router.get("/filters")
async def get_filter_options() -> dict[str, Any]:
    """Provides available plants, products, categories, horizons, and models for UI dropdowns."""
    return {
        "plants": [p.plant_id for p in local_manufacturing_repo.plants.values()],
        "products": [p.product_id for p in local_manufacturing_repo.products.values()],
        "categories": [c.value for c in ItemCategory],
        "horizons_days": [7, 30, 60, 90],
        "models": [m.value for m in ModelType],
    }


# ==============================================================================
# 2. Demand Forecasting
# ==============================================================================
@router.get("/demand/history", response_model=list[HistoricalDemandRecord])
async def get_demand_history(
    product_id: Optional[str] = Query(None, description="Filter by product SKU"),
    plant_id: Optional[str] = Query(None, description="Filter by plant"),
    start_date: Optional[str] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[str] = Query(None, description="End date (YYYY-MM-DD)"),
) -> list[HistoricalDemandRecord]:
    """Retrieve chronological 24-month historical daily demand records."""
    return demand_forecasting_service.get_historical_demand(
        product_id=product_id, plant_id=plant_id, start_date=start_date, end_date=end_date
    )


@router.get("/forecasts", response_model=list[DemandForecastResult])
async def list_forecasts(
    product_id: Optional[str] = Query(None),
    plant_id: Optional[str] = Query(None),
) -> list[DemandForecastResult]:
    """Retrieve active multi-horizon demand forecasts with P10/P50/P90 prediction intervals."""
    return demand_forecasting_service.list_all_forecasts(product_id=product_id, plant_id=plant_id)


@router.post("/forecasts/run", response_model=DemandForecastResult)
async def run_forecast(request: DemandForecastRunRequest) -> DemandForecastResult:
    """Execute time-series forecast generation (Seasonal-Naive, ETS, or Champion GBDT)."""
    return demand_forecasting_service.run_enterprise_forecast(
        product_id=request.product_id,
        plant_id=request.plant_id,
        horizon_days=request.horizon_days,
        model_type=request.model_type,
    )


@router.get("/forecasts/metrics", response_model=ForecastEvaluationMetrics)
async def get_forecast_metrics(
    product_id: str = Query("PRD-CNC-5X"),
    plant_id: str = Query("PLANT_BANGALORE"),
) -> ForecastEvaluationMetrics:
    """Out-of-time cross-validation metrics: MAE, RMSE, WAPE, Bias, and improvement vs baseline."""
    return demand_forecasting_service.get_evaluation_metrics(product_id=product_id, plant_id=plant_id)


@router.get("/forecasts/models", response_model=list[ModelRegistryEntry])
async def list_forecast_models() -> list[ModelRegistryEntry]:
    """Retrieve registered models with active champion designations and benchmark WAPEs."""
    return demand_forecasting_service.list_registered_models()


@router.get("/forecasts/{forecast_id}", response_model=DemandForecastResult)
async def get_forecast_details(forecast_id: str) -> DemandForecastResult:
    """Retrieve a specific cached forecast by its ID."""
    res = demand_forecasting_service.get_forecast_by_id(forecast_id)
    if not res:
        # Generate on the fly
        parts = forecast_id.split("-")
        pid = parts[1] if len(parts) > 1 else "PRD-CNC-5X"
        res = demand_forecasting_service.run_enterprise_forecast(product_id=pid)
    return res


# ==============================================================================
# 3. Production Planning
# ==============================================================================
@router.get("/production/plan", response_model=ProductionPlanSummary)
async def get_production_plan(
    plant_id: str = Query("PLANT_BANGALORE"),
    horizon_days: int = Query(30),
) -> ProductionPlanSummary:
    """Retrieve demand-driven production plan and net requirements calculation."""
    return production_planning_service.generate_plan(plant_id=plant_id, horizon_days=horizon_days)


@router.post("/production/plan/generate", response_model=ProductionPlanSummary)
async def generate_production_plan(
    plant_id: str = Body("PLANT_BANGALORE"),
    horizon_days: int = Body(30),
    consider_maintenance: bool = Body(True),
) -> ProductionPlanSummary:
    """Trigger constraint-aware production plan generation considering capacity and maintenance."""
    plan = production_planning_service.generate_plan(plant_id=plant_id, horizon_days=horizon_days, consider_maintenance=consider_maintenance)
    return PRODUCTION_PLANS.record(plan, subject_id=plant_id)


@router.get("/production/brief", response_model=PlanningBrief)
async def get_planning_brief(
    plant_id: str = Query("PLANT_BANGALORE"),
    horizon_days: int = Query(30, ge=7, le=120),
) -> PlanningBrief:
    """S&OP decision brief: deterministic plan, bottlenecks and stock-out risks, written up by Muse Wonder (grounded)."""
    return PLANNING_BRIEFS.record(await build_planning_brief(plant_id=plant_id, horizon_days=horizon_days), subject_id=plant_id)


@router.get("/production/capacity", response_model=list[ProductionCapacityReport])
async def get_production_capacity(
    plant_id: Optional[str] = Query(None),
    line_id: Optional[str] = Query(None),
) -> list[ProductionCapacityReport]:
    """Retrieve machine capacity headroom, utilization %, and maintenance allocations by line."""
    return production_planning_service.get_capacity_reports(plant_id=plant_id, line_id=line_id)


@router.get("/production/bottlenecks", response_model=list[BottleneckReport])
async def get_production_bottlenecks(
    plant_id: Optional[str] = Query(None),
) -> list[BottleneckReport]:
    """Identify operational bottlenecks across machine capacity, raw materials, and maintenance."""
    return production_planning_service.get_bottlenecks(plant_id=plant_id)


# ==============================================================================
# 4. Inventory Optimization
# ==============================================================================
@router.get("/inventory/summary", response_model=InventorySummaryResponse)
async def get_inventory_summary(
    plant_id: Optional[str] = Query(None),
    category: Optional[ItemCategory] = Query(None),
) -> InventorySummaryResponse:
    """Summarize inventory coverage, days on hand, and stock balances by category."""
    return inventory_optimization_service.get_inventory_summary(plant_id=plant_id, category=category)


@router.get("/inventory/risks", response_model=list[InventoryPosition])
async def get_inventory_risks(
    plant_id: Optional[str] = Query(None),
) -> list[InventoryPosition]:
    """List SKUs with immediate stockout risk (Days on Hand < 3.0 days)."""
    return inventory_optimization_service.get_stockout_risks(plant_id=plant_id)


@router.get("/inventory/recommendations", response_model=list[ReplenishmentRecommendation])
async def get_replenishment_recommendations(
    plant_id: Optional[str] = Query(None),
) -> list[ReplenishmentRecommendation]:
    """Retrieve dynamic replenishment purchase and work order recommendations."""
    return inventory_optimization_service.get_replenishment_recommendations(plant_id=plant_id)


# ==============================================================================
# 5. Maintenance & Equipment Reliability
# ==============================================================================
@router.get("/maintenance/assets", response_model=list[EquipmentAssetReport])
async def get_maintenance_assets(
    plant_id: Optional[str] = Query(None),
) -> list[EquipmentAssetReport]:
    """Retrieve equipment availability %, MTBF, MTTR, and health status."""
    return maintenance_equipment_service.get_asset_reports(plant_id=plant_id)


@router.get("/maintenance/downtime", response_model=list[DowntimeEventReport])
async def get_maintenance_downtime(
    plant_id: Optional[str] = Query(None),
) -> list[DowntimeEventReport]:
    """Retrieve historical equipment downtime and trip event log."""
    return maintenance_equipment_service.get_downtime_history(plant_id=plant_id)


@router.get("/maintenance/risks")
async def get_maintenance_risks(
    plant_id: Optional[str] = Query(None),
) -> list[dict[str, Any]]:
    """Retrieve planned maintenance windows threatening upcoming production capacity."""
    return maintenance_equipment_service.get_capacity_risks(plant_id=plant_id)


# ==============================================================================
# 6. Quality Analytics
# ==============================================================================
@router.get("/quality/metrics", response_model=QualityMetricsSummary)
async def get_quality_metrics(
    plant_id: Optional[str] = Query(None),
    product_id: Optional[str] = Query(None),
) -> QualityMetricsSummary:
    """Retrieve First-Pass Yield (FPY), scrap rate %, and estimated usable output."""
    return quality_analytics_service.get_quality_metrics(plant_id=plant_id, product_id=product_id)


@router.get("/quality/trends", response_model=list[QualityTrendRecord])
async def get_quality_trends(
    plant_id: Optional[str] = Query(None),
) -> list[QualityTrendRecord]:
    """Retrieve chronological weekly First-Pass Yield and scrap rate trends."""
    return quality_analytics_service.get_quality_trends(plant_id=plant_id)


# ==============================================================================
# 7. What-If Scenarios
# ==============================================================================
@router.post("/scenarios/simulate", response_model=ScenarioSimulationResult)
async def simulate_scenario(request: ScenarioSimulationRequest) -> ScenarioSimulationResult:
    """Simulate manufacturing shocks (demand spike, capacity reduction, lead time drift)."""
    return what_if_scenario_engine.simulate(request)


@router.get("/scenarios", response_model=list[ScenarioSimulationResult])
async def list_scenarios() -> list[ScenarioSimulationResult]:
    """List executed What-If scenario results."""
    return what_if_scenario_engine.list_scenarios()


@router.get("/scenarios/{scenario_id}", response_model=ScenarioSimulationResult)
async def get_scenario_details(scenario_id: str) -> ScenarioSimulationResult:
    """Retrieve detailed outcomes of a specific simulated scenario."""
    scen = what_if_scenario_engine.get_scenario_by_id(scenario_id)
    if not scen:
        raise HTTPException(status_code=404, detail=f"Scenario {scenario_id} not found")
    return scen


# ==============================================================================
# 8. Data Operations & Pipelines
# ==============================================================================
@router.post("/data/ingest", response_model=IngestBatchStatus)
async def ingest_manufacturing_data(payload: IngestPayload) -> IngestBatchStatus:
    """Ingest, validate, and deduplicate batch manufacturing records into lakehouse."""
    return data_ingestion_service.ingest_records(payload)


@router.get("/pipelines/status", response_model=list[PipelineRunStatus])
async def get_pipeline_status() -> list[PipelineRunStatus]:
    """Retrieve ETL pipeline statuses, duration, and processed record volumes."""
    return data_ingestion_service.get_pipeline_statuses()


@router.get("/data/quality", response_model=DataQualityReport)
async def get_data_quality() -> DataQualityReport:
    """Retrieve lakehouse data hygiene, valid record %, and quarantined record count."""
    return data_ingestion_service.get_data_quality_report()


@router.get("/models/evaluations", response_model=list[ModelRegistryEntry])
async def get_model_evaluations() -> list[ModelRegistryEntry]:
    """Retrieve model registry benchmark evaluations."""
    return demand_forecasting_service.list_registered_models()


# ==============================================================================
# 9. Backward-Compatible Legacy Endpoints (For test_features.py & MCP Suite)
# ==============================================================================
@router.get("/demand/forecast/{product_id}", response_model=ProbabilisticForecast)
async def get_legacy_demand_forecast(
    product_id: str, horizon_weeks: Optional[int] = None
) -> ProbabilisticForecast:
    """Generate probabilistic multi-horizon demand projection (legacy compatibility)."""
    return await demand_forecasting_service.forecast_product_demand(product_id, horizon_weeks)


@router.get("/demand/headroom/{line_id}", response_model=CapacityHeadroomReport)
async def get_legacy_capacity_headroom(
    line_id: str, horizon_weeks: Optional[int] = None
) -> CapacityHeadroomReport:
    """Compare forecasted demand against maximum factory capacity (legacy compatibility)."""
    return await demand_forecasting_service.check_capacity_headroom(line_id, horizon_weeks)


@router.get("/demand/config", response_model=DemandForecastingConfig)
async def get_legacy_demand_config() -> DemandForecastingConfig:
    """Get active demand forecasting configuration."""
    return demand_config_store.get_config()


@router.put("/demand/config", response_model=DemandForecastingConfig)
async def update_legacy_demand_config(config: DemandForecastingConfig) -> DemandForecastingConfig:
    """Update demand projection factors dynamically at runtime."""
    return demand_config_store.update_config(config)
