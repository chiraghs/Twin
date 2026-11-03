"""Configurable parameters for Supply Chain Intelligence domain."""
from pydantic import BaseModel, Field


class SupplyChainConfig(BaseModel):
    critical_days_of_supply_threshold: float = Field(3.0, ge=0.5, description="Days of supply threshold to trigger critical stockout alert")
    min_recommended_po_qty: int = Field(500, ge=10, description="Minimum lot quantity for purchase order recommendations")
    default_component_cost_usd: float = Field(14.50, ge=0.01, description="Default unit cost for component budgeting")
    on_time_delivery_target_pct: float = Field(95.0, ge=50.0, le=100.0, description="Target on-time delivery rate")


class SupplyConfigStore:
    def __init__(self) -> None:
        self._config = SupplyChainConfig()

    def get_config(self) -> SupplyChainConfig:
        return self._config

    def update_config(self, new_config: SupplyChainConfig) -> SupplyChainConfig:
        self._config = new_config
        return self._config


supply_config_store = SupplyConfigStore()
