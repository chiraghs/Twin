"""Mock order history adapter."""
from backend.features.demand_forecasting.ports.contracts import IOrderHistoryReader


class InMemoryOrderReader(IOrderHistoryReader):
    async def get_historical_demand(self, product_id: str) -> list[float]:
        return [1100.0, 1150.0, 1180.0, 1220.0, 1260.0]

    async def get_line_rated_capacity(self, line_id: str) -> float:
        return 1400.0  # 1400 units/week
