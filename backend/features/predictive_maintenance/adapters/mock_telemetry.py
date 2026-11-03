"""Mock telemetry reader adapter for local testing and offline simulation."""
from backend.features.predictive_maintenance.ports.contracts import ITelemetryReader


class InMemoryTelemetryReader(ITelemetryReader):
    """In-memory telemetry adapter initialized with realistic machine curves."""

    def __init__(self) -> None:
        self._data: dict[str, dict[str, Any]] = {
            "A-ROB-03": {
                "vibration_rms": 5.4,
                "temperature_c": 68.2,
                "history": [1.2, 1.3, 1.4, 1.7, 2.1, 2.8, 3.4, 4.2, 4.9, 5.4],
            },
            "A-CNC-01": {
                "vibration_rms": 1.1,
                "temperature_c": 38.0,
                "history": [1.0, 1.1, 1.1, 1.0, 1.1, 1.2, 1.1, 1.1, 1.1, 1.1],
            },
        }

    async def get_latest_vibration_rms(self, asset_id: str) -> float:
        return self._data.get(asset_id, {}).get("vibration_rms", 1.2)

    async def get_latest_temperature(self, asset_id: str) -> float:
        return self._data.get(asset_id, {}).get("temperature_c", 35.0)

    async def get_vibration_history(self, asset_id: str, limit: int = 60) -> list[float]:
        return self._data.get(asset_id, {}).get("history", [1.0] * 10)[-limit:]
