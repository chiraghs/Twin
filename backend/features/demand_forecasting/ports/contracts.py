"""Ports for demand forecasting."""
from abc import ABC, abstractmethod
from backend.core.interfaces.base import IInputPort, IOutputPort
from backend.features.demand_forecasting.domain.models import ProbabilisticForecast, CapacityHeadroomReport


class IDemandForecastingUseCase(IInputPort, ABC):
    @abstractmethod
    async def forecast_product_demand(self, product_id: str, horizon_weeks: int = 4) -> ProbabilisticForecast:
        pass

    @abstractmethod
    async def check_capacity_headroom(self, line_id: str, horizon_weeks: int = 4) -> CapacityHeadroomReport:
        pass


class IOrderHistoryReader(IOutputPort, ABC):
    @abstractmethod
    async def get_historical_demand(self, product_id: str) -> list[float]:
        pass

    @abstractmethod
    async def get_line_rated_capacity(self, line_id: str) -> float:
        pass
