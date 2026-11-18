"""OPC Unified Architecture (OPC UA) read-only connector (asyncua)."""
from __future__ import annotations

from typing import Any

from backend.connectors.base import IOTConnector, TelemetryCallback, TelemetryPacket
from backend.core.telemetry.logger import get_logger

logger = get_logger("connectors.opcua")

MAX_NODES = 400
TIMEOUT_S = 6


def _plain(v: Any) -> Any:
    if isinstance(v, (bool, int, float, str)) or v is None:
        return v
    return str(v)


async def browse_variables(endpoint: str, max_nodes: int = MAX_NODES) -> list[dict[str, Any]]:
    """Every variable under the Objects folder (skipping the server's own diagnostics), with its value."""
    from asyncua import Client, ua

    out: list[dict[str, Any]] = []
    async with Client(url=endpoint, timeout=TIMEOUT_S) as client:
        server_node = client.get_node(ua.ObjectIds.Server)
        stack = [(client.nodes.objects, "")]
        while stack and len(out) < max_nodes:
            node, path = stack.pop()
            for child in await node.get_children():
                if child.nodeid == server_node.nodeid:
                    continue
                name = (await child.read_browse_name()).Name
                cls = await child.read_node_class()
                full = f"{path}.{name}" if path else name
                if cls == ua.NodeClass.Variable:
                    try:
                        value = await child.read_value()
                    except Exception:  # noqa: BLE001 - unreadable variables are listed without a value
                        value = None
                    out.append({"nodeId": child.nodeid.to_string(), "path": full, "value": _plain(value)})
                    if len(out) >= max_nodes:
                        break
                elif cls == ua.NodeClass.Object:
                    stack.append((child, full))
    return sorted(out, key=lambda r: r["path"])


async def read_values(endpoint: str, node_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Read several variables in one session. Unknown nodes come back with quality BAD."""
    from asyncua import Client

    out: dict[str, dict[str, Any]] = {}
    async with Client(url=endpoint, timeout=TIMEOUT_S) as client:
        for nid in node_ids:
            try:
                out[nid] = {"value": _plain(await client.get_node(nid).read_value()), "quality": "GOOD"}
            except Exception as e:  # noqa: BLE001
                out[nid] = {"value": None, "quality": "BAD", "error": str(e)[:120]}
    return out


class OpcUaConnector(IOTConnector):
    """OPC UA connector: read-only subscriptions to PLC tags (polling)."""

    def __init__(self, endpoint_url: str = "opc.tcp://localhost:4840") -> None:
        self.endpoint_url = endpoint_url
        self._connected = False
        self._subscriptions: dict[str, list[TelemetryCallback]] = {}

    async def connect(self) -> bool:
        try:
            await browse_variables(self.endpoint_url, max_nodes=1)
            self._connected = True
        except Exception as e:  # noqa: BLE001
            logger.info(f"OPC UA endpoint {self.endpoint_url} unreachable: {e}")
            self._connected = False
        return self._connected

    async def disconnect(self) -> None:
        self._connected = False

    async def is_connected(self) -> bool:
        return self._connected

    async def subscribe(self, topic_or_node: str, callback: TelemetryCallback) -> None:
        self._subscriptions.setdefault(topic_or_node, []).append(callback)

    async def poll(self) -> None:
        """Read every subscribed node once and hand each value to its callbacks."""
        if not self._subscriptions:
            return
        values = await read_values(self.endpoint_url, list(self._subscriptions))
        for nid, v in values.items():
            packet = TelemetryPacket(source_protocol="opcua", node_id=nid, values={"value": v["value"]}, quality=v["quality"])
            for cb in self._subscriptions.get(nid, []):
                await cb(packet)

    async def simulate_incoming_reading(self, node_id: str, values: dict[str, Any]) -> None:
        """Forward a reading to the registered callbacks (used in tests and replays)."""
        packet = TelemetryPacket(source_protocol="opcua", node_id=node_id, values=values)
        for cb in self._subscriptions.get(node_id, []):
            await cb(packet)
