"""OPC Unified Architecture (OPC UA) read-only connector."""
from typing import Any
from backend.connectors.base import IOTConnector, TelemetryPacket, TelemetryCallback
from backend.core.telemetry.logger import get_logger

logger = get_logger("connectors.opcua")


class OpcUaConnector(IOTConnector):
    """OPC UA connector implementing read-only subscriptions to industrial PLC tags."""

    def __init__(self, endpoint_url: str = "opc.tcp://localhost:4840") -> None:
        self.endpoint_url = endpoint_url
        self._connected = False
        self._subscriptions: dict[str, list[TelemetryCallback]] = {}

    async def connect(self) -> bool:
        logger.info(f"Connecting to OPC UA endpoint: {self.endpoint_url}")
        self._connected = True
        return True

    async def disconnect(self) -> None:
        logger.info("Disconnecting from OPC UA endpoint")
        self._connected = False

    async def is_connected(self) -> bool:
        return self._connected

    async def subscribe(self, topic_or_node: str, callback: TelemetryCallback) -> None:
        if topic_or_node not in self._subscriptions:
            self._subscriptions[topic_or_node] = []
        self._subscriptions[topic_or_node].append(callback)
        logger.info(f"Subscribed to OPC UA node: {topic_or_node}")

    async def simulate_incoming_reading(self, node_id: str, values: dict[str, Any]) -> None:
        """Injects or forwards incoming node update to registered callbacks."""
        packet = TelemetryPacket(
            source_protocol="opcua",
            node_id=node_id,
            values=values,
        )
        for cb in self._subscriptions.get(node_id, []):
            await cb(packet)
