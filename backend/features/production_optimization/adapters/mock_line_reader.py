"""Mock line reader adapter for production optimization."""
from backend.features.production_optimization.ports.contracts import ILineStateReader


class InMemoryLineStateReader(ILineStateReader):
    async def get_machine_cycle_times(self, line_id: str) -> dict[str, float]:
        return {
            "A-SMT-01": 12.5,
            "A-ROB-03": 18.2,  # Slowest / Bottleneck station
            "A-TEST-02": 14.0,
            "A-PACK-01": 10.5,
        }

    async def get_operating_hours(self, line_id: str) -> tuple[float, float]:
        return (7.2, 8.0)  # 7.2 hours runtime out of 8 planned hours

    async def get_production_counts(self, line_id: str) -> tuple[int, int]:
        return (1420, 1480)  # 1420 good units out of 1480 total produced
