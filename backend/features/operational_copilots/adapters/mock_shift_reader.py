"""Mock shift log reader adapter."""
from backend.features.operational_copilots.ports.contracts import IShiftLogReader


class InMemoryShiftLogReader(IShiftLogReader):
    async def get_shift_metrics(self, line_id: str) -> tuple[int, float, list[str]]:
        return (
            1420,
            3.8,
            ["Vibration alert on A-ROB-03 at 14:22", "SMT reel buffer low alert at 16:05"],
        )
