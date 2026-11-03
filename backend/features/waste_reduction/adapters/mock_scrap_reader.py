"""Mock scrap and power metrics adapter."""
from typing import Any
from backend.features.waste_reduction.ports.contracts import IScrapMetricsReader


class InMemoryScrapMetricsReader(IScrapMetricsReader):
    async def get_scrap_events(self, line_id: str) -> list[dict[str, Any]]:
        return [
            {"category": "MECHANICAL_WEAR", "asset_id": "A-ROB-03", "count": 48},
            {"category": "THERMAL_DRIFT", "asset_id": "A-OVEN-01", "count": 14},
            {"category": "MATERIAL_DEFECT", "asset_id": None, "count": 8},
        ]

    async def get_power_breakdown(self, asset_id: str) -> tuple[float, float, float]:
        if asset_id == "A-ROB-03":
            return (1.8, 2.2, 5.5)  # 2.2 kW friction waste due to worn bearing!
        return (1.2, 0.2, 4.8)
