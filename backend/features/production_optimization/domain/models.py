"""Domain models for production line balancing and OEE calculation."""
from pydantic import BaseModel, Field
from backend.core.interfaces.base import BaseValueObject


class OEEMetrics(BaseValueObject):
    line_id: str
    availability_pct: float = Field(..., ge=0.0, le=100.0)
    performance_pct: float = Field(..., ge=0.0, le=100.0)
    quality_pct: float = Field(..., ge=0.0, le=100.0)
    overall_oee_pct: float = Field(..., ge=0.0, le=100.0)


class BottleneckStation(BaseValueObject):
    asset_id: str
    asset_name: str
    cycle_time_seconds: float
    utilization_pct: float
    is_active_constraint: bool
    starvation_risk_downstream: float


class LineThroughputAnalysis(BaseModel):
    line_id: str
    current_uph: float
    target_uph: float
    oee: OEEMetrics
    bottleneck: BottleneckStation
    wip_units: int
