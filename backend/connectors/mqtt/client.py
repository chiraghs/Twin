"""MQTT v5 and Sparkplug B industrial protocol connector."""
from typing import Any
from backend.connectors.base import IOTConnector, TelemetryPacket, TelemetryCallback
from backend.core.telemetry.logger import get_logger

logger = get_logger("connectors.mqtt")


class MqttSparkplugConnector(IOTConnector):
    """MQTT connector parsing Sparkplug B metrics from edge gateways."""

    def __init__(self, broker_url: str = "mqtt://localhost:1883") -> None:
        self.broker_url = broker_url
        self._connected = False
        self._subscriptions: dict[str, list[TelemetryCallback]] = {}

    async def connect(self) -> bool:
        logger.info(f"Connecting to MQTT broker: {self.broker_url}")
        self._connected = True
        return True

    async def disconnect(self) -> None:
        logger.info("Disconnecting from MQTT broker")
        self._connected = False

    async def is_connected(self) -> bool:
        return self._connected

    async def subscribe(self, topic_or_node: str, callback: TelemetryCallback) -> None:
        if topic_or_node not in self._subscriptions:
            self._subscriptions[topic_or_node] = []
        self._subscriptions[topic_or_node].append(callback)
        logger.info(f"Subscribed to MQTT topic: {topic_or_node}")

    async def emit_packet(self, node_id: str, values: dict[str, Any]) -> None:
        """Emits decoded Sparkplug B packet to subscribers."""
        packet = TelemetryPacket(
            source_protocol="mqtt_sparkplug",
            node_id=node_id,
            values=values,
        )
        for cb in self._subscriptions.get(node_id, []):
            await cb(packet)
