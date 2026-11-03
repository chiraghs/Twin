"""Configurable parameters for Production Optimization domain."""
from backend.core.db.config_store import PersistentConfig
from pydantic import BaseModel, Field


class ProductionOptimizationConfig(BaseModel):
    nominal_ideal_cycle_time_seconds: float = Field(15.0, ge=1.0, description="Ideal cycle time per unit in seconds")
    target_line_uph: float = Field(220.0, ge=1.0, description="Target line units per hour throughput")
    target_oee_pct: float = Field(85.0, ge=0.0, le=100.0, description="Target benchmark Overall Equipment Effectiveness")
    bottleneck_utilization_threshold_pct: float = Field(90.0, ge=0.0, le=100.0, description="Threshold to flag a station as constraint")


class ProductionConfigStore:
    """Runtime configuration persisted in SQLite (app_config, every change in app_config_history)."""

    def __init__(self) -> None:
        self._store = PersistentConfig("production_optimization", ProductionOptimizationConfig)

    def get_config(self) -> ProductionOptimizationConfig:
        return self._store.get()

    def update_config(self, new_config: ProductionOptimizationConfig, updated_by: str | None = "api") -> ProductionOptimizationConfig:
        return self._store.put(new_config, updated_by)

    def history(self, limit: int = 20) -> list[dict]:
        return self._store.history(limit)


production_config_store = ProductionConfigStore()
