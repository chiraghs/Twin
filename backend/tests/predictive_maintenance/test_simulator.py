"""Unit tests for the industrial sensor simulator and physical models."""
from backend.features.predictive_maintenance.simulator.generator import IndustrialSensorSimulator
from backend.features.predictive_maintenance.schemas.sensor_reading import MachineType, HealthState


def test_simulator_fleet_initialization():
    sim = IndustrialSensorSimulator(num_machines=20, seed=42)
    assert len(sim.machines) == 20
    machine_types = {m.machine_type for m in sim.machines}
    assert len(machine_types) >= 3


def test_sensor_reading_physics():
    sim = IndustrialSensorSimulator(num_machines=5, seed=42)
    readings = sim.generate_tick(elapsed_minutes=5.0)
    assert len(readings) == 5

    for r in readings:
        assert r.temperature_celsius > 10.0
        assert r.vibration_mm_s > 0.0
        assert r.pressure_bar >= 0.0
        assert r.rpm >= 0.0
        assert r.operating_hours > 0.0
