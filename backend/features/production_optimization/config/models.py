"""Configurable parameters for Production Optimization domain."""
from pydantic import BaseModel, Field


class ProductionOptimizationConfig(BaseModel):
    nominal_ideal_cycle_time_seconds: float = Field(15.0, ge=1.0, description="Ideal cycle time per unit in seconds")
    target_line_uph: float = Field(220.0, ge=1.0, description="Target line units per hour throughput")
    target_oee_pct: float = Field(85.0, ge=0.0, le=100.0, description="Target benchmark Overall Equipment Effectiveness")
    bottleneck_utilization_threshold_pct: float = Field(90.0, ge=0.0, le=100.0, description="Threshold to flag a station as constraint")


class ProductionConfigStore:
    def __init__(self) -> None:
        self._config = ProductionOptimizationConfig()

    def get_config(self) -> ProductionOptimizationConfig:
        return self._config

    def update_config(self, new_config: ProductionOptimizationConfig) -> ProductionOptimizationConfig:
        self._config = new_config
        return self._config


production_config_store = ProductionConfigStore()
