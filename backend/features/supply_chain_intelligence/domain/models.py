"""Domain models for supply chain intelligence and inventory optimization."""
from datetime import datetime
from pydantic import BaseModel, Field
from backend.core.interfaces.base import BaseValueObject


class PartStockRisk(BaseValueObject):
    part_number: str
    part_name: str
    stock_on_hand: int
    daily_consumption_rate: float
    days_of_supply_remaining: float
    safety_stock_threshold: int
    is_at_risk_of_stockout: bool


class SupplierRiskScore(BaseValueObject):
    supplier_id: str
    supplier_name: str
    on_time_delivery_rate: float = Field(..., ge=0.0, le=1.0)
    lead_time_variance_days: float
    geopolitical_risk_score: float = Field(..., ge=0.0, le=1.0)
    composite_risk_level: str  # LOW | MEDIUM | HIGH | CRITICAL


class PurchaseOrderRecommendation(BaseModel):
    recommendation_id: str
    part_number: str
    suggested_order_qty: int
    supplier_id: str
    estimated_cost_usd: float
    urgency: str  # ROUTINE | EXPEDITE | CRITICAL
    order_deadline: datetime
