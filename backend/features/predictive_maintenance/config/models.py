"""Configurable parameters for Predictive Maintenance domain."""
from pydantic import BaseModel, Field


class ISO10816Thresholds(BaseModel):
    """ISO 10816-3 vibration severity thresholds (in mm/s RMS)."""
    zone_a_good_max: float = Field(1.8, description="Max vibration for Zone A (Good)")
    zone_b_acceptable_max: float = Field(4.5, description="Max vibration for Zone B (Acceptable)")
    zone_c_unsatisfactory_max: float = Field(7.1, description="Max vibration for Zone C (Unsatisfactory)")


class PredictiveMaintenanceConfig(BaseModel):
    """Runtime configuration for predictive maintenance calculations."""
    iso_thresholds: ISO10816Thresholds = Field(default_factory=ISO10816Thresholds)
    trip_threshold_rms: float = Field(8.5, description="Vibration threshold triggering emergency trip")
    nominal_temperature_c: float = Field(40.0, description="Nominal operating temperature in °C")
    max_temperature_c: float = Field(80.0, description="Temperature threshold for severe thermal warning")
    overheating_temperature_threshold: float = Field(70.0, description="Temperature threshold adding failure risk boost")
    vibration_damage_weight: float = Field(0.7, description="Weight of vibration in composite health score")
    temperature_damage_weight: float = Field(0.3, description="Weight of temperature in composite health score")
    imminent_trip_hours_threshold: float = Field(24.0, description="Hours threshold to declare trip imminent")
    high_risk_probability_threshold: float = Field(0.70, description="Failure probability threshold for HIGH risk tier")
    medium_risk_probability_threshold: float = Field(0.35, description="Failure probability threshold for MEDIUM risk tier")
    default_prediction_horizon_hours: int = Field(24, description="Default prediction horizon in hours")
    alert_cooldown_minutes: int = Field(30, description="Cooldown period between repeated high-risk alerts")


class MaintenanceConfigStore:
    """Thread-safe in-memory store for runtime configuration updates."""

    def __init__(self) -> None:
        self._config = PredictiveMaintenanceConfig()

    def get_config(self) -> PredictiveMaintenanceConfig:
        return self._config

    def update_config(self, new_config: PredictiveMaintenanceConfig) -> PredictiveMaintenanceConfig:
        self._config = new_config
        return self._config


# Singleton store instance for the feature
maintenance_config_store = MaintenanceConfigStore()
