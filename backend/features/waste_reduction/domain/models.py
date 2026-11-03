"""Domain models for scrap attribution and carbon footprinting."""
from typing import Optional
from pydantic import BaseModel, Field
from backend.core.interfaces.base import BaseValueObject


class ScrapCause(BaseValueObject):
    cause_category: str  # MECHANICAL_WEAR | THERMAL_DRIFT | OPERATOR_ERROR | MATERIAL_DEFECT
    root_asset_id: Optional[str]
    scrap_count: int
    percentage_of_total_scrap: float
    cost_impact_usd: float


class ScrapAttributionReport(BaseModel):
    line_id: str
    total_scrap_units: int
    scrap_causes: list[ScrapCause]
    top_root_cause_asset: str


class MachineEnergyWasteReport(BaseModel):
    asset_id: str
    idle_power_kw: float
    friction_waste_kw: float
    active_load_kw: float
    daily_energy_waste_cost_usd: float
    recommendation: str


class CarbonFootprintReport(BaseModel):
    product_id: str
    scope_1_direct_co2_kg: float
    scope_2_electricity_co2_kg: float
    total_co2_kg_per_unit: float
    circular_rework_potential_pct: float
