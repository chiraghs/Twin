"""Abstract repository contract for machine telemetry and predictions (DIP)."""
from abc import ABC, abstractmethod
from typing import Optional
from backend.features.predictive_maintenance.schemas.sensor_reading import SensorReadingEvent


class IMachineRepository(ABC):
    @abstractmethod
    async def get_all_machines(self) -> list[dict]:
        pass

    @abstractmethod
    async def get_machine_by_id(self, machine_id: str) -> Optional[dict]:
        pass

    @abstractmethod
    async def get_recent_readings(self, machine_id: str, limit: int = 50) -> list[SensorReadingEvent]:
        pass

    @abstractmethod
    async def get_latest_prediction(self, machine_id: str) -> Optional[dict]:
        pass

    @abstractmethod
    async def save_prediction(self, prediction_record: dict) -> None:
        pass

    @abstractmethod
    async def get_high_risk_machines(self) -> list[dict]:
        pass

    @abstractmethod
    async def get_analytics_summary(self) -> dict:
        pass
