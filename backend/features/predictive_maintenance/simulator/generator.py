"""Multi-machine industrial sensor simulator producing realistic operating fleets."""
import random
import time
from typing import Iterator, Optional
from backend.features.predictive_maintenance.schemas.sensor_reading import MachineType, PlantLocation, HealthState, SensorReadingEvent
from backend.features.predictive_maintenance.simulator.models import SimulatedMachine


class IndustrialSensorSimulator:
    """Manages an entire industrial fleet of 20+ machines with configurable failure patterns."""

    def __init__(self, num_machines: int = 20, seed: int = 42) -> None:
        random.seed(seed)
        self.machines: list[SimulatedMachine] = []
        self._initialize_fleet(num_machines)

    def _initialize_fleet(self, count: int) -> None:
        machine_types = list(MachineType)
        plant_locations = list(PlantLocation)

        for i in range(1, count + 1):
            m_type = machine_types[(i - 1) % len(machine_types)]
            plant = plant_locations[(i - 1) % len(plant_locations)]
            m_id = f"{m_type.value[:3]}-{i:03d}"

            # Create realistic distribution:
            # - 70% Healthy baseline
            # - 15% Gradual degradation
            # - 10% Abnormal vibration / Overheating (Failure impending)
            # - 5% Critical condition
            if i in (3, 7):
                health = HealthState.ABNORMAL_VIBRATION
                deg_rate = 0.015
            elif i in (12, 18):
                health = HealthState.OVERHEATING
                deg_rate = 0.012
            elif i == 5:
                health = HealthState.CRITICAL_FAILURE
                deg_rate = 0.03
            else:
                health = HealthState.HEALTHY
                deg_rate = 0.0008

            self.machines.append(
                SimulatedMachine(
                    machine_id=m_id,
                    machine_type=m_type,
                    plant_id=plant,
                    operating_hours=random.uniform(800.0, 7500.0),
                    initial_health=health,
                    degradation_rate=deg_rate,
                )
            )

    def generate_tick(self, elapsed_minutes: float = 5.0) -> list[SensorReadingEvent]:
        """Generate a snapshot of readings for all monitored machines."""
        return [machine.step(elapsed_minutes=elapsed_minutes) for machine in self.machines]

    def stream_readings(self, interval_seconds: float = 2.0, max_ticks: Optional[int] = None) -> Iterator[list[SensorReadingEvent]]:
        """Infinite or bounded generator streaming readings for all machines."""
        ticks = 0
        while max_ticks is None or ticks < max_ticks:
            yield self.generate_tick()
            ticks += 1
            if interval_seconds > 0:
                time.sleep(interval_seconds)
