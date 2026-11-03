"""Local JSON lines and in-memory buffer for offline development."""
import json
from pathlib import Path
from typing import Optional
from backend.features.predictive_maintenance.schemas.sensor_reading import SensorReadingEvent


class LocalTelemetryBuffer:
    """Persists telemetry events to local JSONL file for local pipeline execution."""

    def __init__(self, file_path: str = "data/raw_readings.jsonl") -> None:
        self.path = Path(file_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._in_memory: list[SensorReadingEvent] = []

    def append(self, event: SensorReadingEvent) -> None:
        self._in_memory.append(event)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(event.model_dump_json() + "\n")

    def read_all(self) -> list[SensorReadingEvent]:
        if not self.path.exists():
            return list(self._in_memory)
        events: list[SensorReadingEvent] = []
        with open(self.path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    events.append(SensorReadingEvent.model_validate_json(line))
        return events
