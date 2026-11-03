"""Domain models for demand forecasting and capacity headroom."""
from datetime import datetime
from pydantic import BaseModel, Field
from backend.core.interfaces.base import BaseValueObject


class ProbabilisticForecast(BaseValueObject):
    product_id: str
    horizon_weeks: int
    p10_units: float
    p50_units: float  # Median point forecast
    p90_units: float
    trend_direction: str  # INCREASING | STABLE | DECREASING


class CapacityHeadroomReport(BaseModel):
    line_id: str
    total_capacity_units: float
    forecasted_demand_units: float
    headroom_units: float
    utilization_pct: float
    is_capacity_exceeded: bool
