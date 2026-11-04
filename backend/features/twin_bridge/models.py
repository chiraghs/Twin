"""The plant snapshot the Twin web app sends, and the insights the backend returns.

Field names are camelCase on the wire (the web app's domain model) and snake_case here.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

FeatureId = Literal["maintenance", "supply", "demand", "vision"]
FEATURES: tuple[str, ...] = ("maintenance", "supply", "demand", "vision")


class Wire(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class Reading(Wire):
    t: float  # simulated hour
    vibration: float
    temperature: float


class TwinAsset(Wire):
    id: str
    name: str
    kind: str
    line_id: str
    criticality: str = "B"
    mode: str = "running"
    vibration_alarm: float
    vibration_trip: float
    temperature_alarm: float
    temperature_trip: float
    baseline_vibration: float = 1.5
    baseline_temperature: float = 45.0
    history: list[Reading] = Field(default_factory=list, description="10-minute telemetry history, oldest first")


class Inbound(Wire):
    po_id: str
    qty: float
    eta_hour: float


class BomUse(Wire):
    line_id: str
    product_id: str
    qty: float


class TwinItem(Wire):
    id: str
    name: str
    unit: str
    category: str = "component"
    on_hand: float
    reorder_point: float
    unit_cost: float
    supplier: str
    lead_time_hours: float
    consumption_per_hour: float
    inbound: list[Inbound] = Field(default_factory=list)
    used_by: list[BomUse] = Field(default_factory=list)


class TwinProduct(Wire):
    id: str
    name: str
    sku: str
    unit_price: float
    unit_material_cost: float = 0.0


class Capability(Wire):
    product_id: str
    rate_per_hour: float


class TwinLine(Wire):
    id: str
    name: str
    kind: str = "assembly"
    state: str = "running"
    capabilities: list[Capability] = Field(default_factory=list)
    allocation: dict[str, float] = Field(default_factory=dict)


class TwinOrder(Wire):
    id: str
    customer: str
    product_id: str
    quantity: float
    fulfilled: float
    due_hour: float
    priority: str = "standard"


class TwinCamera(Wire):
    id: str
    name: str
    kind: str
    line_id: str | None = None


class CostModel(Wire):
    maintenance_labor_per_hour: float = 380
    maintenance_parts_cost: float = 2400
    unplanned_repair_cost: float = 24000
    unplanned_repair_hours: float = 16


class TwinSnapshot(Wire):
    facility_id: str = Field(..., min_length=1, max_length=80)
    facility_name: str
    sim_hour: float
    anchor_iso: str
    features: list[FeatureId] = Field(default_factory=list)
    cost_model: CostModel = Field(default_factory=CostModel)
    assets: list[TwinAsset] = Field(default_factory=list)
    items: list[TwinItem] = Field(default_factory=list)
    products: list[TwinProduct] = Field(default_factory=list)
    lines: list[TwinLine] = Field(default_factory=list)
    orders: list[TwinOrder] = Field(default_factory=list)
    cameras: list[TwinCamera] = Field(default_factory=list)


class DispositionIn(BaseModel):
    action: Literal["confirm", "dismiss"]
    auditor: str = Field(..., min_length=1, max_length=120)
