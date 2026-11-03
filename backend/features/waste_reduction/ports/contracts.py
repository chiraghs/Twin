"""Ports for waste reduction domain."""
from abc import ABC, abstractmethod
from backend.core.interfaces.base import IInputPort, IOutputPort
from backend.features.waste_reduction.domain.models import (
    ScrapAttributionReport,
    MachineEnergyWasteReport,
    CarbonFootprintReport,
)


class IWasteReductionUseCase(IInputPort, ABC):
    @abstractmethod
    async def attribute_scrap(self, line_id: str) -> ScrapAttributionReport:
        pass

    @abstractmethod
    async def evaluate_machine_energy_waste(self, asset_id: str) -> MachineEnergyWasteReport:
        pass

    @abstractmethod
    async def compute_unit_carbon_footprint(self, product_id: str) -> CarbonFootprintReport:
        pass


class IScrapMetricsReader(IOutputPort, ABC):
    @abstractmethod
    async def get_scrap_events(self, line_id: str) -> list[dict[str, Any]]:
        pass

    @abstractmethod
    async def get_power_breakdown(self, asset_id: str) -> tuple[float, float, float]:
        """Returns (idle_kw, friction_kw, active_kw)."""
        pass
