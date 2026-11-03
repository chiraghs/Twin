"""Physical machine simulation models with degradation trajectories."""
import random
from datetime import datetime, timedelta
from backend.features.predictive_maintenance.schemas.sensor_reading import MachineType, PlantLocation, HealthState, SensorReadingEvent
from backend.features.predictive_maintenance.simulator.config import ARCHETYPE_SPECS, MachineArchetypeSpec


class SimulatedMachine:
    """Maintains state, wear, and physical sensor values for an industrial asset."""

    def __init__(
        self,
        machine_id: str,
        machine_type: MachineType,
        plant_id: PlantLocation,
        operating_hours: float = 1200.0,
        initial_health: HealthState = HealthState.HEALTHY,
        degradation_rate: float = 0.001,
    ) -> None:
        self.machine_id = machine_id
        self.machine_type = machine_type
        self.plant_id = plant_id
        self.operating_hours = operating_hours
        self.health_state = initial_health
        self.degradation_rate = degradation_rate
        self.wear_level = 0.0 if initial_health == HealthState.HEALTHY else 0.65
        self.spec: MachineArchetypeSpec = ARCHETYPE_SPECS[machine_type]
        self.time_to_failure_hours = 999.0

    def step(self, elapsed_minutes: float = 5.0) -> SensorReadingEvent:
        """Advance time and compute realistic physical telemetry."""
        self.operating_hours += (elapsed_minutes / 60.0)

        # Gradual wear progression
        if self.health_state == HealthState.HEALTHY:
            self.wear_level += self.degradation_rate * (elapsed_minutes / 60.0)
            if self.wear_level > 0.40 and random.random() < 0.05:
                # Transition to degrading
                self.health_state = random.choice([HealthState.ABNORMAL_VIBRATION, HealthState.OVERHEATING])

        elif self.health_state in (HealthState.ABNORMAL_VIBRATION, HealthState.OVERHEATING, HealthState.DEGRADING):
            self.wear_level += (self.degradation_rate * 8.0) * (elapsed_minutes / 60.0)
            if self.wear_level >= 1.0:
                self.health_state = HealthState.CRITICAL_FAILURE

        # Compute physics with noise and inter-metric correlations
        noise_vib = random.gauss(0.0, 0.08)
        noise_temp = random.gauss(0.0, 0.5)
        noise_rpm = random.gauss(0.0, 15.0)
        noise_press = random.gauss(0.0, 0.8)

        # Vibration is driven directly by wear level
        vib = self.spec.nominal_vib + (self.wear_level ** 1.8) * (self.spec.vib_trip_threshold - self.spec.nominal_vib) + noise_vib
        vib = max(0.1, round(vib, 2))

        # Friction from vibration generates excess heat
        excess_heat = (vib / self.spec.nominal_vib - 1.0) * 12.0 if vib > self.spec.nominal_vib else 0.0
        temp = self.spec.nominal_temp + excess_heat + noise_temp
        temp = max(10.0, round(temp, 1))

        # Degradation causes RPM instability and pressure drop
        rpm_drag = 1.0 - (0.15 * self.wear_level if self.health_state != HealthState.HEALTHY else 0.0)
        rpm = round(max(0.0, self.spec.nominal_rpm * rpm_drag + noise_rpm), 0)

        press_fluctuation = -1.0 * (self.wear_level * 5.0) if self.health_state == HealthState.CRITICAL_FAILURE else 0.0
        pressure = round(max(0.0, self.spec.nominal_pressure + press_fluctuation + noise_press), 1)

        # Check binary failure within 24h horizon
        hours_remaining = max(0.0, (1.0 - self.wear_level) / (self.degradation_rate * 8.0 if self.health_state != HealthState.HEALTHY else 0.01))
        self.time_to_failure_hours = hours_remaining
        failure_within_24h = 1 if (hours_remaining <= 24.0 or self.health_state == HealthState.CRITICAL_FAILURE) else 0

        return SensorReadingEvent(
            machine_id=self.machine_id,
            timestamp=datetime.utcnow(),
            temperature_celsius=temp,
            vibration_mm_s=vib,
            pressure_bar=pressure,
            rpm=rpm,
            operating_hours=round(self.operating_hours, 1),
            machine_type=self.machine_type,
            plant_id=self.plant_id,
            ground_truth_health=self.health_state,
            failure_within_24h=failure_within_24h,
        )
