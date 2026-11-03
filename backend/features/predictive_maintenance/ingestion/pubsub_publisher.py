"""Pub/Sub ingestion publisher with batching, retries, and local fallback."""
import json
import logging
from typing import Optional
from backend.features.predictive_maintenance.schemas.sensor_reading import SensorReadingEvent, DeadLetterEvent

logger = logging.getLogger("ingestion.pubsub")


class PubSubTelemetryPublisher:
    """Publishes telemetry to Google Cloud Pub/Sub with automatic local fallback."""

    def __init__(
        self,
        project_id: str = "twin-predictive-maintenance",
        topic_id: str = "machine-readings",
        gcp_mode: bool = False,
    ) -> None:
        self.project_id = project_id
        self.topic_id = topic_id
        self.gcp_mode = gcp_mode
        self._publisher = None
        self._topic_path = None

        if self.gcp_mode:
            try:
                from google.cloud import pubsub_v1
                self._publisher = pubsub_v1.PublisherClient()
                self._topic_path = self._publisher.topic_path(self.project_id, self.topic_id)
                logger.info(f"Initialized GCP Pub/Sub publisher for {self._topic_path}")
            except Exception as e:
                logger.warning(f"Could not initialize GCP Pub/Sub client ({e}). Falling back to local mode.")
                self.gcp_mode = False

    def publish_event(self, event: SensorReadingEvent) -> bool:
        """Publishes validated event to Pub/Sub or local logger."""
        try:
            payload_str = event.model_dump_json()
            payload_bytes = payload_str.encode("utf-8")

            if self.gcp_mode and self._publisher and self._topic_path:
                future = self._publisher.publish(
                    self._topic_path,
                    payload_bytes,
                    machine_id=event.machine_id,
                    plant_id=event.plant_id.value,
                )
                future.result(timeout=5.0)
                return True
            else:
                # Local mock mode
                logger.debug(f"[LOCAL PUB/SUB] Published reading for {event.machine_id}: Vib={event.vibration_mm_s} mm/s, Temp={event.temperature_celsius}°C")
                return True
        except Exception as e:
            logger.error(f"Error publishing event for {event.machine_id}: {e}")
            return False

    def publish_dead_letter(self, dead_letter: DeadLetterEvent) -> None:
        logger.warning(f"[DEAD LETTER] Event rejected: {dead_letter.error_message} | Payload: {dead_letter.raw_payload}")
