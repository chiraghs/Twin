"""Configurable parameters for Supply Chain Intelligence domain."""
from backend.core.db.config_store import PersistentConfig
from pydantic import BaseModel, Field


class SupplyChainConfig(BaseModel):
    critical_days_of_supply_threshold: float = Field(3.0, ge=0.5, description="Days of supply threshold to trigger critical stockout alert")
    min_recommended_po_qty: int = Field(500, ge=10, description="Minimum lot quantity for purchase order recommendations")
    default_component_cost_usd: float = Field(14.50, ge=0.01, description="Default unit cost for component budgeting")
    on_time_delivery_target_pct: float = Field(95.0, ge=50.0, le=100.0, description="Target on-time delivery rate")


class SupplyConfigStore:
    """Runtime configuration persisted in SQLite (app_config, every change in app_config_history)."""

    def __init__(self) -> None:
        self._store = PersistentConfig("supply_chain_intelligence", SupplyChainConfig)

    def get_config(self) -> SupplyChainConfig:
        return self._store.get()

    def update_config(self, new_config: SupplyChainConfig, updated_by: str | None = "api") -> SupplyChainConfig:
        return self._store.put(new_config, updated_by)

    def history(self, limit: int = 20) -> list[dict]:
        return self._store.history(limit)


supply_config_store = SupplyConfigStore()
