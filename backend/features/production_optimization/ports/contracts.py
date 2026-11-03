"""Ports for production optimization."""
from abc import ABC, abstractmethod
from backend.core.interfaces.base import IInputPort, IOutputPort
from backend.features.production_optimization.domain.models import OEEMetrics, LineThroughputAnalysis, BottleneckStation


class IProductionOptimizationUseCase(IInputPort, ABC):
    @abstractmethod
    async def compute_oee(self, line_id: str) -> OEEMetrics:
        pass

    @abstractmethod
    async def analyze_line_throughput(self, line_id: str) -> LineThroughputAnalysis:
        pass


class ILineStateReader(IOutputPort, ABC):
    @abstractmethod
    async def get_machine_cycle_times(self, line_id: str) -> dict[str, float]:
        pass

    @abstractmethod
    async def get_operating_hours(self, line_id: str) -> tuple[float, float]:
        """Returns (operating_hours, planned_hours)."""
        pass

    @abstractmethod
    async def get_production_counts(self, line_id: str) -> tuple[int, int]:
        """Returns (good_count, total_count)."""
        pass
