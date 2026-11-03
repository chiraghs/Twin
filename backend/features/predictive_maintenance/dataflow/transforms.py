"""Apache Beam DoFn transforms for streaming sensor validation, normalization, and windowing."""
import json
import logging
from datetime import datetime
import numpy as np
from backend.features.predictive_maintenance.schemas.sensor_reading import SensorReadingEvent

logger = logging.getLogger("dataflow.transforms")


class ValidateAndParseSensorEvent:
    """Parses incoming JSON byte strings into validated domain records or dead-letters."""

    def process(self, element: bytes):
        try:
            payload_str = element.decode("utf-8")
            data = json.loads(payload_str)
            event = SensorReadingEvent.model_validate(data)

            # Normalized dictionary for BigQuery machine_readings table
            record = {
                "machine_id": event.machine_id,
                "timestamp": event.timestamp.isoformat(),
                "temperature_celsius": event.temperature_celsius,
                "vibration_mm_s": event.vibration_mm_s,
                "pressure_bar": event.pressure_bar,
                "rpm": event.rpm,
                "operating_hours": event.operating_hours,
                "machine_type": event.machine_type.value,
                "plant_id": event.plant_id.value,
                "ingestion_timestamp": datetime.utcnow().isoformat(),
            }
            yield ("valid", record)
        except Exception as e:
            logger.warning(f"Failed parsing message: {e}")
            yield ("invalid", {
                "rejected_at": datetime.utcnow().isoformat(),
                "raw_payload": str(element),
                "error_message": str(e),
            })


class ComputeHealthFeaturesDoFn:
    """Computes windowed rolling statistics for machine health features."""

    def process(self, element):
        machine_id, readings = element
        if not readings:
            return

        temps = [r["temperature_celsius"] for r in readings]
        vibs = [r["vibration_mm_s"] for r in readings]
        pressures = [r["pressure_bar"] for r in readings]
        rpms = [r["rpm"] for r in readings]

        std_vib = float(np.std(vibs)) if len(vibs) > 1 else 0.0

        yield {
            "machine_id": machine_id,
            "window_start": min(r["timestamp"] for r in readings),
            "window_end": max(r["timestamp"] for r in readings),
            "avg_temperature": float(np.mean(temps)),
            "max_temperature": float(np.max(temps)),
            "avg_vibration": float(np.mean(vibs)),
            "max_vibration": float(np.max(vibs)),
            "std_vibration": std_vib,
            "avg_pressure": float(np.mean(pressures)),
            "avg_rpm": float(np.mean(rpms)),
            "reading_count": len(readings),
        }
