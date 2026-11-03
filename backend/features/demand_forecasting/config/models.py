"""Configurable parameters for Demand Forecasting domain."""
from pydantic import BaseModel, Field


class DemandForecastingConfig(BaseModel):
    default_horizon_weeks: int = Field(4, ge=1, le=52, description="Default forecast horizon in weeks")
    growth_trend_multiplier: float = Field(1.05, ge=0.5, le=2.0, description="Paced growth multiplier for baseline forecast")
    p10_uncertainty_factor: float = Field(0.88, ge=0.5, le=1.0, description="Lower P10 confidence band ratio")
    p90_uncertainty_factor: float = Field(1.15, ge=1.0, le=2.0, description="Upper P90 confidence band ratio")
    capacity_warning_threshold_pct: float = Field(90.0, ge=50.0, le=100.0, description="Utilization percentage triggering capacity warning")


class DemandConfigStore:
    def __init__(self) -> None:
        self._config = DemandForecastingConfig()

    def get_config(self) -> DemandForecastingConfig:
        return self._config

    def update_config(self, new_config: DemandForecastingConfig) -> DemandForecastingConfig:
        self._config = new_config
        return self._config


demand_config_store = DemandConfigStore()
