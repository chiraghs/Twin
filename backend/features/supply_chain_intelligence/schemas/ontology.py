"""Governed Business Entity and Relationship Ontology for Supply Chain Intelligence.

Ontology Hierarchy:
Supplier → Part (BOM) → Purchase Order → Shipment (Carrier) → Warehouse → Plant → Customer Order → Customer

Defines:
- Primary and foreign keys
- Enums for lifecycle states, transport modes, and disruption severities
- Data provenance tracking (ACTUAL vs SIMULATED)
- Financial exposure and SLA penalties
"""
from datetime import datetime, date, timezone
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


class DataProvenance(str, Enum):
    ACTUAL = "ACTUAL"
    SIMULATED = "SIMULATED"
    ESTIMATED = "ESTIMATED"
    SIMULATED_SCENARIO = "SIMULATED_SCENARIO"


class RiskSeverity(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    NORMAL = "NORMAL"


class TransportMode(str, Enum):
    OCEAN = "OCEAN"
    AIR = "AIR"
    ROAD_FREIGHT = "ROAD_FREIGHT"
    ROAD = "ROAD_FREIGHT"
    RAIL = "RAIL"
    EXPRESS_COURIER = "EXPRESS_COURIER"


class ShipmentStatus(str, Enum):
    PLANNED = "PLANNED"
    PICKED_UP = "PICKED_UP"
    IN_TRANSIT = "IN_TRANSIT"
    CUSTOMS_HOLD = "CUSTOMS_HOLD"
    PORT_CONGESTION = "PORT_CONGESTION"
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY"
    DELIVERED = "DELIVERED"
    EXCEPTION_DELAYED = "EXCEPTION_DELAYED"


class PurchaseOrderStatus(str, Enum):
    CREATED = "CREATED"
    CONFIRMED = "CONFIRMED"
    IN_FULFILLMENT = "IN_FULFILLMENT"
    SHIPPED = "SHIPPED"
    PARTIALLY_DELIVERED = "PARTIALLY_DELIVERED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class CustomerOrderStatus(str, Enum):
    BOOKED = "BOOKED"
    ALLOCATED = "ALLOCATED"
    IN_PRODUCTION = "IN_PRODUCTION"
    STAGED_FOR_SHIPMENT = "STAGED_FOR_SHIPMENT"
    DISPATCHED = "DISPATCHED"
    FULFILLED = "FULFILLED"
    DELAY_AT_RISK = "DELAY_AT_RISK"


class DisruptionType(str, Enum):
    SUPPLIER_FORCE_MAJEURE = "SUPPLIER_FORCE_MAJEURE"
    PORT_CONGESTION = "PORT_CONGESTION"
    GEOPOLITICAL_SANCTION = "GEOPOLITICAL_SANCTION"
    RAW_MATERIAL_SHORTAGE = "RAW_MATERIAL_SHORTAGE"
    WEATHER_DELAY = "WEATHER_DELAY"
    CUSTOMS_CLEARANCE_FAILURE = "CUSTOMS_CLEARANCE_FAILURE"
    EQUIPMENT_BREAKDOWN = "EQUIPMENT_BREAKDOWN"


# 1. Supplier Entity
class Supplier(BaseModel):
    supplier_id: str = Field(..., description="Unique supplier identifier (e.g. SUP-MICRO-01)")
    supplier_name: str
    country: str
    tier: int = Field(1, ge=1, le=3, description="1=Direct component OEM, 2=Sub-tier, 3=Raw material")
    category: str = Field(..., description="Semiconductors, Metals, Hydraulics, Polymers, Fasteners")
    contract_start: str
    contract_end: str
    lead_time_days_mean: float
    lead_time_variance_days: float
    on_time_delivery_rate: float = Field(..., ge=0.0, le=1.0)
    defect_ppm: float = Field(default=50.0, description="Defect parts per million")
    geopolitical_risk_score: float = Field(0.1, ge=0.0, le=1.0)
    financial_stability_score: float = Field(0.9, ge=0.0, le=1.0)
    composite_risk_level: RiskSeverity = RiskSeverity.LOW
    data_provenance: DataProvenance = DataProvenance.SIMULATED


# 2. Part / Component Entity
class Part(BaseModel):
    part_id: str = Field(..., description="Unique part/SKU identifier (e.g. PRT-MCU-8841)")
    part_name: str
    primary_supplier_id: str = Field(..., description="Foreign key to Supplier")
    alternate_supplier_id: Optional[str] = None
    unit_cost_usd: float = Field(..., ge=0.01)
    criticality: str = Field("A", description="A=Production Halted, B=Sub-assembly impacted, C=General")
    category: str
    weight_kg: float
    safety_stock_units: int
    reorder_point_units: int
    standard_lead_time_days: int
    dual_sourced: bool = False


# 3. Bill of Materials (BOM) Relationship
class BillOfMaterials(BaseModel):
    finished_assembly_id: str = Field(..., description="Target finished product (e.g. ASM-CNC-SPINDLE)")
    assembly_name: str
    part_id: str = Field(..., description="Foreign key to Part")
    quantity_required_per_unit: int = Field(1, ge=1)
    critical_for_assembly: bool = True


# 4. Inventory Record
class InventoryItem(BaseModel):
    inventory_id: str
    part_id: str = Field(..., description="Foreign key to Part")
    warehouse_id: str
    plant_id: str
    stock_on_hand: int
    stock_allocated: int
    stock_available: int
    daily_consumption_rate: float
    days_of_inventory_remaining: float
    stockout_risk_score: float = Field(..., ge=0.0, le=1.0)
    is_at_risk_of_stockout: bool = False
    last_cycle_count: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# 5. Purchase Order (PO)
class PurchaseOrder(BaseModel):
    po_id: str = Field(..., description="Unique PO number (e.g. PO-2026-8801)")
    supplier_id: str = Field(..., description="Foreign key to Supplier")
    part_id: str = Field(..., description="Foreign key to Part")
    destination_plant_id: str
    destination_warehouse_id: str
    quantity_ordered: int
    quantity_received: int = 0
    unit_price_usd: float
    total_amount_usd: float
    po_status: PurchaseOrderStatus
    order_date: str
    promised_delivery_date: str
    estimated_arrival_date: str
    is_delayed: bool = False
    delay_days: float = 0.0


# 6. Shipment & Logistics
class Shipment(BaseModel):
    shipment_id: str = Field(..., description="Tracking reference (e.g. SHP-AIR-9921)")
    po_id: str = Field(..., description="Foreign key to PurchaseOrder")
    carrier_name: str
    transport_mode: TransportMode
    origin_hub: str
    destination_hub: str
    status: ShipmentStatus
    dispatch_date: str
    scheduled_eta: str
    current_projected_eta: str
    eta_drift_days: float = 0.0
    current_location_lat: float = 0.0
    current_location_lon: float = 0.0
    milestone_summary: str
    delay_root_cause: Optional[str] = None
    carbon_emissions_kg_co2e: float = 120.0


# 7. Manufacturing Plant & Warehouse
class Plant(BaseModel):
    plant_id: str
    plant_name: str
    location_city: str
    country: str
    daily_production_target: int
    active_production_lines: int
    hourly_unplanned_downtime_cost_usd: float = 3500.0


# 8. Customer Order
class CustomerOrder(BaseModel):
    order_id: str = Field(..., description="Unique customer order ID (e.g. ORD-CUST-7741)")
    customer_name: str
    finished_assembly_id: str
    plant_id: str
    quantity: int
    revenue_usd: float
    sla_delivery_deadline: str
    order_status: CustomerOrderStatus
    sla_penalty_per_day_usd: float = 1200.0
    downstream_delay_days: float = 0.0
    is_impacted_by_supply_disruption: bool = False
    associated_disruption_id: Optional[str] = None


# 9. Disruption Event
class DisruptionEvent(BaseModel):
    disruption_id: str
    disruption_type: DisruptionType
    severity: RiskSeverity
    title: str
    description: str
    affected_supplier_ids: list[str] = Field(default_factory=list)
    affected_part_ids: list[str] = Field(default_factory=list)
    affected_shipment_ids: list[str] = Field(default_factory=list)
    affected_plants: list[str] = Field(default_factory=list)
    affected_customer_orders: list[str] = Field(default_factory=list)
    estimated_daily_financial_impact_usd: float
    total_projected_disruption_cost_usd: float
    detected_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    resolved: bool = False


# 10. Mitigation Recommendation
class MitigationRecommendation(BaseModel):
    recommendation_id: str
    disruption_id: str
    action_type: str  # EXPEDITE_AIR_FREIGHT | DUAL_SOURCE_ALLOCATION | REBALANCE_WAREHOUSE_STOCK | RESCHEDULE_PRODUCTION
    description: str
    target_part_id: str
    source_supplier_id: Optional[str] = None
    target_supplier_id: Optional[str] = None
    estimated_mitigation_cost_usd: float
    estimated_downtime_cost_avoided_usd: float
    net_financial_benefit_usd: float
    speed_hours_to_execute: int
    feasibility_score: float = Field(..., ge=0.0, le=1.0)
    urgency: RiskSeverity
    status: str = "PENDING_APPROVAL"  # PENDING_APPROVAL | APPROVED | REJECTED
    approved_by: Optional[str] = None


# 11. Governed Supply Chain KPI Summary
class GovernedSupplyChainKPIs(BaseModel):
    on_time_delivery_rate: float = Field(..., description="Percentage of shipments delivered on or before promise date")
    order_fill_rate: float = Field(..., description="Percentage of customer orders fulfilled complete without backorder")
    average_days_of_inventory: float = Field(..., description="Average days of inventory across all component SKUs")
    supplier_reliability_index: float = Field(..., description="Aggregated supplier performance and SLA adherence score (0-100)")
    lead_time_variability_std_days: float = Field(..., description="Standard deviation in days between promised and actual arrival")
    stockout_risk_percentage: float = Field(..., description="Percentage of monitored active SKUs with stockout risk > 50%")
    shipment_delay_rate: float = Field(..., description="Percentage of active in-transit shipments currently behind ETA")
    customer_orders_at_risk_count: int = Field(..., description="Number of customer orders directly impacted by delayed parts")
    total_revenue_at_risk_usd: float = Field(..., description="Total revenue of customer orders currently delayed or jeopardized")
    estimated_disruption_cost_usd: float = Field(..., description="Projected financial impact summing plant downtime and SLA penalties")
    data_provenance: DataProvenance = DataProvenance.ACTUAL
    calculated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# 12. Carrier & Logistics Service Provider Entity
class Carrier(BaseModel):
    carrier_id: str = Field(..., description="Unique carrier identifier (e.g. CRR-EVERGREEN-01)")
    carrier_name: str
    transport_mode: TransportMode
    on_time_performance_rate: float = Field(..., ge=0.0, le=1.0)
    average_transit_delay_days: float = Field(..., ge=0.0)
    carbon_efficiency_rating: str = Field("B", description="A=Low carbon, B=Standard, C=High emissions")
    primary_corridors: list[str] = Field(default_factory=list)
    contact_dispatch: str = "dispatch@carrier-logistics.com"


# 13. Dedicated Warehouse Entity
class Warehouse(BaseModel):
    warehouse_id: str = Field(..., description="Unique warehouse identifier (e.g. WH-BLR-01)")
    warehouse_name: str
    location_city: str
    storage_capacity_pallets: int
    utilized_capacity_pct: float = Field(..., ge=0.0, le=100.0)
    associated_plant_id: str
    annual_holding_cost_rate_pct: float = Field(22.0, description="Annual inventory carrying cost percentage")


# 14. Plant Production Schedule & Line Starvation
class ProductionSchedule(BaseModel):
    schedule_id: str = Field(..., description="Schedule block (e.g. SCH-2026-W42-L1)")
    plant_id: str
    line_id: str
    assembly_id: str
    assembly_name: str
    planned_start_date: str
    planned_end_date: str
    planned_units: int
    daily_run_rate: int
    required_parts_allocated: bool
    starvation_risk_level: RiskSeverity = RiskSeverity.LOW
    estimated_starvation_hours: float = 0.0
    bottleneck_part_id: Optional[str] = None


# 15. Probabilistic Demand Forecast
class DemandForecast(BaseModel):
    forecast_id: str
    assembly_id: str
    assembly_name: str
    horizon_days: int = Field(30, description="Forecast window in days")
    p10_units: int = Field(..., description="Conservative lower-bound demand")
    p50_units: int = Field(..., description="Expected baseline demand")
    p90_units: int = Field(..., description="Upside demand surge potential")
    forecast_growth_rate_pct: float = 5.0
    demand_surge_risk: bool = False
    generated_at: str = "2026-10-18"


# 16. Pre-Negotiated Alternative Supplier Contract
class AlternativeSupplierContract(BaseModel):
    contract_id: str
    primary_supplier_id: str
    alternative_supplier_id: str
    alternative_supplier_name: str
    part_id: str
    guaranteed_capacity_units_per_month: int
    expedited_lead_time_days: int
    price_premium_pct: float = Field(15.0, description="Percentage cost increase over primary supplier")
    is_contract_active: bool = True


# 17. Excess Inventory & Tied-Up Working Capital Item
class ExcessInventoryItem(BaseModel):
    part_id: str
    part_name: str
    stock_on_hand: int
    days_of_inventory: float
    excess_units: int
    tied_up_capital_usd: float
    annual_holding_cost_usd: float
    obsolescence_risk_score: float = Field(..., ge=0.0, le=1.0)
    recommended_action: str = "HOLD"  # REBALANCE_TO_PLANT | RETURN_TO_SUPPLIER | DISCOUNT_SCRAP


# 18. Multi-Echelon End-to-End Disruption Impact Trace
class EndToEndImpactTrace(BaseModel):
    disruption_id: str
    root_cause_type: str
    trigger_entity_id: str
    affected_pos: list[str] = Field(default_factory=list)
    affected_shipments: list[str] = Field(default_factory=list)
    affected_parts: list[str] = Field(default_factory=list)
    time_to_depletion_hours: float
    depletion_timestamp: str
    starved_production_lines: list[str] = Field(default_factory=list)
    threatened_customer_orders: list[str] = Field(default_factory=list)
    total_revenue_at_risk_usd: float
    daily_sla_penalties_usd: float
    total_projected_loss_usd: float
    contingency_mitigation_ids: list[str] = Field(default_factory=list)
    data_provenance: DataProvenance = DataProvenance.ACTUAL
