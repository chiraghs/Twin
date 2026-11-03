"""Configurable parameters for Waste Reduction & Sustainability domain."""
from backend.core.db.config_store import PersistentConfig
from pydantic import BaseModel, Field


class WasteReductionConfig(BaseModel):
    electricity_tariff_usd_per_kwh: float = Field(0.14, ge=0.01, description="Industrial electricity cost per kWh in USD")
    scrap_cost_per_unit_usd: float = Field(18.20, ge=0.1, description="Average scrap material & processing cost per rejected unit")
    bearing_friction_waste_threshold_kw: float = Field(1.0, ge=0.1, description="Excess kW friction threshold indicating bearing degradation")
    grid_carbon_intensity_kg_co2_per_kwh: float = Field(0.45, ge=0.01, description="Embodied grid electricity Scope 2 emissions factor")


class WasteConfigStore:
    """Runtime configuration persisted in SQLite (app_config, every change in app_config_history)."""

    def __init__(self) -> None:
        self._store = PersistentConfig("waste_reduction", WasteReductionConfig)

    def get_config(self) -> WasteReductionConfig:
        return self._store.get()

    def update_config(self, new_config: WasteReductionConfig, updated_by: str | None = "api") -> WasteReductionConfig:
        return self._store.put(new_config, updated_by)

    def history(self, limit: int = 20) -> list[dict]:
        return self._store.history(limit)


waste_config_store = WasteConfigStore()
