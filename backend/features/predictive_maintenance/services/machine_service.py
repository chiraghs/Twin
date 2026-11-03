"""Application service layer orchestrating domain operations and queries."""
from typing import Optional
from backend.features.predictive_maintenance.repositories.base import IMachineRepository
from backend.features.predictive_maintenance.schemas.sensor_reading import SensorReadingEvent


class MachineService:
    """Decouples API routes from concrete persistence and ML inference."""

    def __init__(self, repository: IMachineRepository) -> None:
        self.repo = repository

    async def list_machines(self, plant_id: Optional[str] = None, risk_category: Optional[str] = None) -> list[dict]:
        machines = await self.repo.get_all_machines()
        if plant_id:
            machines = [m for m in machines if m["plant_id"] == plant_id]
        if risk_category:
            machines = [m for m in machines if m["risk_category"] == risk_category]
        return machines

    async def get_machine_details(self, machine_id: str) -> Optional[dict]:
        return await self.repo.get_machine_by_id(machine_id)

    async def get_readings_history(self, machine_id: str, limit: int = 50) -> list[dict]:
        events = await self.repo.get_recent_readings(machine_id, limit=limit)
        return [e.model_dump() for e in events]

    async def get_predictions(self, machine_id: str) -> Optional[dict]:
        return await self.repo.get_latest_prediction(machine_id)

    async def get_high_risk_alerts(self) -> list[dict]:
        return await self.repo.get_high_risk_machines()

    async def get_fleet_analytics(self) -> dict:
        return await self.repo.get_analytics_summary()
