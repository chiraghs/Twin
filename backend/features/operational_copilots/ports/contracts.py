"""Ports for operational copilots."""
from abc import ABC, abstractmethod
from backend.core.interfaces.base import IInputPort, IOutputPort
from backend.features.operational_copilots.domain.models import (
    SOPStep,
    ShiftHandoverReport,
    AlarmDiagnostic,
)


class IOperationalCopilotUseCase(IInputPort, ABC):
    @abstractmethod
    async def get_sop_step(self, procedure_id: str, step_number: int) -> SOPStep:
        pass

    @abstractmethod
    async def generate_shift_handover(self, line_id: str, shift_name: str) -> ShiftHandoverReport:
        pass

    @abstractmethod
    async def diagnose_alarm(self, asset_id: str, alarm_code: str) -> AlarmDiagnostic:
        pass


class IShiftLogReader(IOutputPort, ABC):
    @abstractmethod
    async def get_shift_metrics(self, line_id: str) -> tuple[int, float, list[str]]:
        """Returns (units_produced, scrap_rate, incidents)."""
        pass
