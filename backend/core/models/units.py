"""Strongly-typed physical units and time series value objects."""
from datetime import datetime
from typing import Generic, TypeVar
from pydantic import Field
from backend.core.interfaces.base import BaseValueObject

T = TypeVar("T")


class VibrationMmS(BaseValueObject):
    """Vibration Root Mean Square (RMS) velocity in mm/s."""
    value: float = Field(..., ge=0.0, description="Vibration velocity in mm/s RMS")


class TemperatureCelsius(BaseValueObject):
    """Temperature in degrees Celsius."""
    value: float = Field(..., description="Temperature in °C")


class PowerKilowatt(BaseValueObject):
    """Electrical power in Kilowatts (kW)."""
    value: float = Field(..., ge=0.0, description="Power in kW")


class PressureBar(BaseValueObject):
    """Pressure in bar."""
    value: float = Field(..., ge=0.0, description="Pressure in bar")


class FrequencyHz(BaseValueObject):
    """Frequency in Hertz (Hz)."""
    value: float = Field(..., ge=0.0, description="Frequency in Hz")


class Percentage(BaseValueObject):
    """Ratio represented as a percentage (0.0 to 100.0%)."""
    value: float = Field(..., ge=0.0, le=100.0, description="Percentage value")


class TimeRange(BaseValueObject):
    """Time interval bounded by start and end timestamps."""
    start_time: datetime
    end_time: datetime

    def duration_seconds(self) -> float:
        return (self.end_time - self.start_time).total_seconds()


class TimestampedReading(BaseValueObject, Generic[T]):
    """Generic timestamped sensor reading."""
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    asset_id: str
    metric_name: str
    value: T
