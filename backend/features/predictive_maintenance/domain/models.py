"""Domain models and value objects for predictive maintenance."""
from enum import Enum
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field
from backend.core.interfaces.base import BaseValueObject


class ISO10816Severity(str, Enum):
    """ISO 10816-3 standard vibration severity zones for industrial machinery."""
    ZONE_A_GOOD = "ZONE_A_GOOD"            # Newly commissioned machines (< 1.8 mm/s)
    ZONE_B_ACCEPTABLE = "ZONE_B_ACCEPTABLE"# Unrestricted long-term operation (1.8 - 4.5 mm/s)
    ZONE_C_UNSATISFACTORY = "ZONE_C_UNSATISFACTORY" # Remedial action required (4.5 - 7.1 mm/s)
    ZONE_D_UNACCEPTABLE = "ZONE_D_UNACCEPTABLE"     # Danger of damage; shutdown advised (> 7.1 mm/s)


class BearingHealth(BaseValueObject):
    asset_id: str
    vibration_rms: float
    temperature_c: float
    iso_zone: ISO10816Severity
    health_score: float = Field(..., ge=0.0, le=1.0)
    primary_fault_signature: Optional[str] = None


class RulEstimate(BaseValueObject):
    asset_id: str
    hours_to_trip: float = Field(..., ge=0.0)
    estimated_trip_time: datetime
    confidence: float = Field(..., ge=0.0, le=1.0)
    degradation_rate_per_hour: float


class AssetDiagnosticReport(BaseModel):
    asset_id: str
    health: BearingHealth
    rul: RulEstimate
    is_trip_imminent: bool
    recommended_action: str
