"""Demand forecasting service uniting machine learning forecasting with legacy and enterprise APIs."""
from datetime import datetime, date, timedelta, timezone
from typing import Any, Optional

from backend.features.demand_forecasting.ports.contracts import (
    IDemandForecastingUseCase,
    IOrderHistoryReader,
)
from backend.features.demand_forecasting.domain.models import (
    ProbabilisticForecast,
    CapacityHeadroomReport,
)
from backend.features.demand_forecasting.config.models import (
    DemandConfigStore,
    demand_config_store,
)
from backend.features.demand_forecasting.schemas.manufacturing import (
    DemandForecastResult,
    HistoricalDemandRecord,
    ForecastEvaluationMetrics,
    ModelRegistryEntry,
    ModelType,
)
from backend.features.demand_forecasting.repositories.local_manufacturing_repo import (
    LocalManufacturingRepository,
    local_manufacturing_repo,
)
from backend.features.demand_forecasting.models.forecasting_engine import (
    DemandForecastingEngine,
    forecasting_engine,
)
from backend.features.demand_forecasting.adapters.mock_order_reader import InMemoryOrderReader


class DemandForecastingService(IDemandForecastingUseCase):
    """Orchestrates demand forecasting across machine learning models and capacity constraints."""

    def __init__(
        self,
        history_reader: Optional[IOrderHistoryReader] = None,
        config_store: Optional[DemandConfigStore] = None,
        repo: Optional[LocalManufacturingRepository] = None,
        engine: Optional[DemandForecastingEngine] = None,
    ) -> None:
        self.reader = history_reader or InMemoryOrderReader()
        self.config_store = config_store or demand_config_store
        self.repo = repo or local_manufacturing_repo
        self.engine = engine or forecasting_engine
        self._cached_forecasts: dict[str, DemandForecastResult] = {}

    # ==========================================================================
    # Legacy Backward-Compatible Endpoints (Used by test_features.py)
    # ==========================================================================
    async def forecast_product_demand(
        self, product_id: str, horizon_weeks: Optional[int] = None
    ) -> ProbabilisticForecast:
        cfg = self.config_store.get_config()
        horizon = horizon_weeks if horizon_weeks is not None else cfg.default_horizon_weeks

        history = await self.reader.get_historical_demand(product_id)
        avg_demand = sum(history) / len(history) if history else 1200.0

        p50 = round(avg_demand * horizon * cfg.growth_trend_multiplier, 1)
        p10 = round(p50 * cfg.p10_uncertainty_factor, 1)
        p90 = round(p50 * cfg.p90_uncertainty_factor, 1)

        trend = "INCREASING" if p50 > (avg_demand * horizon) else "STABLE"

        return ProbabilisticForecast(
            product_id=product_id,
            horizon_weeks=horizon,
            p10_units=p10,
            p50_units=p50,
            p90_units=p90,
            trend_direction=trend,
        )

    async def check_capacity_headroom(
        self, line_id: str, horizon_weeks: Optional[int] = None
    ) -> CapacityHeadroomReport:
        cfg = self.config_store.get_config()
        horizon = horizon_weeks if horizon_weeks is not None else cfg.default_horizon_weeks

        rated_weekly_cap = await self.reader.get_line_rated_capacity(line_id)
        total_capacity = rated_weekly_cap * horizon

        forecast = await self.forecast_product_demand(product_id="ECU-200", horizon_weeks=horizon)
        headroom = total_capacity - forecast.p50_units
        utilization = (forecast.p50_units / total_capacity * 100.0) if total_capacity > 0 else 100.0

        return CapacityHeadroomReport(
            line_id=line_id,
            total_capacity_units=total_capacity,
            forecasted_demand_units=forecast.p50_units,
            headroom_units=round(headroom, 1),
            utilization_pct=round(utilization, 1),
            is_capacity_exceeded=utilization >= cfg.capacity_warning_threshold_pct,
        )

    # ==========================================================================
    # Enterprise Machine Learning Forecasting Endpoints
    # ==========================================================================
    def get_historical_demand(
        self,
        product_id: Optional[str] = None,
        plant_id: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> list[HistoricalDemandRecord]:
        """Retrieves filtered historical daily demand time series."""
        records = self.repo.demand_history
        if product_id:
            records = [r for r in records if r.product_id == product_id]
        if plant_id:
            records = [r for r in records if r.plant_id == plant_id]
        if start_date:
            records = [r for r in records if r.date_recorded >= start_date]
        if end_date:
            records = [r for r in records if r.date_recorded <= end_date]
        return records

    def run_enterprise_forecast(
        self,
        product_id: str = "PRD-CNC-5X",
        plant_id: str = "PLANT_BANGALORE",
        horizon_days: int = 30,
        model_type: ModelType = ModelType.GRADIENT_BOOSTED_TREES,
    ) -> DemandForecastResult:
        """Executes selected ML model against 24-month historical series."""
        prod = self.repo.products.get(product_id)
        prod_name = prod.product_name if prod else product_id

        # Filter historical demand for this product
        records = [
            {"date": r.date_recorded, "actual_units": r.actual_units}
            for r in self.repo.demand_history
            if r.product_id == product_id and r.plant_id == plant_id
        ]

        if not records:
            # Fallback if specific plant combination not seeded
            records = [
                {"date": r.date_recorded, "actual_units": r.actual_units}
                for r in self.repo.demand_history
                if r.product_id == product_id
            ]

        result = self.engine.run_forecast(
            product_id=product_id,
            product_name=prod_name,
            plant_id=plant_id,
            history_records=records,
            horizon_days=horizon_days,
            model_type=model_type,
        )

        self._cached_forecasts[result.forecast_id] = result
        return result

    def get_forecast_by_id(self, forecast_id: str) -> Optional[DemandForecastResult]:
        return self._cached_forecasts.get(forecast_id)

    def list_all_forecasts(
        self, product_id: Optional[str] = None, plant_id: Optional[str] = None
    ) -> list[DemandForecastResult]:
        """Returns active forecasts, automatically generating defaults if cache empty."""
        if not self._cached_forecasts:
            for pid, prod in list(self.repo.products.items())[:3]:
                self.run_enterprise_forecast(
                    product_id=pid,
                    plant_id=prod.target_plant_id,
                    horizon_days=30,
                    model_type=ModelType.GRADIENT_BOOSTED_TREES,
                )

        res = list(self._cached_forecasts.values())
        if product_id:
            res = [f for f in res if f.product_id == product_id]
        if plant_id:
            res = [f for f in res if f.plant_id == plant_id]
        return res

    def get_evaluation_metrics(
        self, product_id: str = "PRD-CNC-5X", plant_id: str = "PLANT_BANGALORE"
    ) -> ForecastEvaluationMetrics:
        """Retrieves out-of-time cross-validation metrics comparing champion GBDT vs baseline."""
        forecast = self.run_enterprise_forecast(
            product_id=product_id,
            plant_id=plant_id,
            horizon_days=30,
            model_type=ModelType.GRADIENT_BOOSTED_TREES,
        )
        return forecast.metrics

    def list_registered_models(self) -> list[ModelRegistryEntry]:
        return list(self.repo.model_registry.values())


# Global singleton instance
demand_forecasting_service = DemandForecastingService()
