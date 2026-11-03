"""Simulator configuration and archetype operating envelopes."""
from pydantic import BaseModel, Field
from backend.features.predictive_maintenance.schemas.sensor_reading import MachineType, PlantLocation


class MachineArchetypeSpec(BaseModel):
    nominal_temp: float
    nominal_vib: float
    nominal_pressure: float
    nominal_rpm: float
    vib_trip_threshold: float
    temp_trip_threshold: float


ARCHETYPE_SPECS: dict[MachineType, MachineArchetypeSpec] = {
    MachineType.CNC_MILLING: MachineArchetypeSpec(
        nominal_temp=42.0, nominal_vib=1.2, nominal_pressure=40.0, nominal_rpm=6000.0,
        vib_trip_threshold=7.5, temp_trip_threshold=85.0
    ),
    MachineType.ROBOTIC_ARM: MachineArchetypeSpec(
        nominal_temp=48.0, nominal_vib=1.5, nominal_pressure=120.0, nominal_rpm=2400.0,
        vib_trip_threshold=8.0, temp_trip_threshold=90.0
    ),
    MachineType.CENTRIFUGAL_PUMP: MachineArchetypeSpec(
        nominal_temp=38.0, nominal_vib=1.8, nominal_pressure=15.0, nominal_rpm=1750.0,
        vib_trip_threshold=9.0, temp_trip_threshold=78.0
    ),
    MachineType.HYDRAULIC_PRESS: MachineArchetypeSpec(
        nominal_temp=55.0, nominal_vib=2.0, nominal_pressure=220.0, nominal_rpm=1200.0,
        vib_trip_threshold=8.5, temp_trip_threshold=95.0
    ),
    MachineType.CONVEYOR_SYSTEM: MachineArchetypeSpec(
        nominal_temp=32.0, nominal_vib=0.9, nominal_pressure=6.0, nominal_rpm=800.0,
        vib_trip_threshold=6.5, temp_trip_threshold=70.0
    ),
}
