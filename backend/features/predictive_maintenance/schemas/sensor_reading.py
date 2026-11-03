"""Pydantic schemas and validation for industrial sensor readings."""
from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class MachineType(str, Enum):
    CNC_MILLING = "CNC_MILLING"
    ROBOTIC_ARM = "ROBOTIC_ARM"
    CENTRIFUGAL_PUMP = "CENTRIFUGAL_PUMP"
    HYDRAULIC_PRESS = "HYDRAULIC_PRESS"
    CONVEYOR_SYSTEM = "CONVEYOR_SYSTEM"


class PlantLocation(str, Enum):
    PLANT_BANGALORE = "PLANT_BANGALORE"
    PLANT_STUTTGART = "PLANT_STUTTGART"
    PLANT_DETROIT = "PLANT_DETROIT"


class HealthState(str, Enum):
    HEALTHY = "HEALTHY"
    DEGRADING = "DEGRADING"
    ABNORMAL_VIBRATION = "ABNORMAL_VIBRATION"
    OVERHEATING = "OVERHEATING"
    CRITICAL_FAILURE = "CRITICAL_FAILURE"


class SensorReadingEvent(BaseModel):
    """Schema for a single industrial machine telemetry event."""
    machine_id: str = Field(..., description="Unique machine ID, e.g. CNC-001, ROB-003")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="UTC timestamp of the sensor capture")
    temperature_celsius: float = Field(..., ge=-40.0, le=250.0, description="Bearing/casing temperature in °C")
    vibration_mm_s: float = Field(..., ge=0.0, le=50.0, description="Vibration velocity RMS in mm/s")
    pressure_bar: float = Field(..., ge=0.0, le=350.0, description="Operating fluid/hydraulic pressure in bar")
    rpm: float = Field(..., ge=0.0, le=15000.0, description="Spindle/motor speed in revolutions per minute")
    operating_hours: float = Field(..., ge=0.0, description="Total machine runtime hours")
    machine_type: MachineType
    plant_id: PlantLocation
    
    # Synthetic ground-truth labels (included for offline training datasets)
    ground_truth_health: Optional[HealthState] = HealthState.HEALTHY
    failure_within_24h: Optional[int] = Field(0, description="1 if failure will occur within 24h, else 0")

    model_config = {
        "json_schema_extra": {
            "example": {
                "machine_id": "ROB-003",
                "timestamp": "2026-10-18T00:00:00Z",
                "temperature_celsius": 68.4,
                "vibration_mm_s": 5.2,
                "pressure_bar": 120.5,
                "rpm": 2850.0,
                "operating_hours": 4210.5,
                "machine_type": "ROBOTIC_ARM",
                "plant_id": "PLANT_BANGALORE",
                "ground_truth_health": "ABNORMAL_VIBRATION",
                "failure_within_24h": 1,
            }
        }
    }


class DeadLetterEvent(BaseModel):
    """Malformed or invalid event routing payload."""
    raw_payload: str
    error_message: str
    rejected_at: datetime = Field(default_factory=datetime.utcnow)
    source_topic: str = "machine-readings"
