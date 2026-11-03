"""Driving and driven ports for predictive maintenance."""
from abc import ABC, abstractmethod
from typing import Optional
from backend.core.interfaces.base import IInputPort, IOutputPort
from backend.features.predictive_maintenance.domain.models import AssetDiagnosticReport, RulEstimate, ISO10816Severity


class IPredictiveMaintenanceUseCase(IInputPort, ABC):
    """Driving use case interface."""

    @abstractmethod
    async def diagnose_asset(self, asset_id: str) -> AssetDiagnosticReport:
        pass

    @abstractmethod
    async def estimate_rul(self, asset_id: str) -> RulEstimate:
        pass


class ITelemetryReader(IOutputPort, ABC):
    """Driven port reading telemetry history."""

    @abstractmethod
    async def get_latest_vibration_rms(self, asset_id: str) -> float:
        pass

    @abstractmethod
    async def get_latest_temperature(self, asset_id: str) -> float:
        pass

    @abstractmethod
    async def get_vibration_history(self, asset_id: str, limit: int = 60) -> list[float]:
        pass
