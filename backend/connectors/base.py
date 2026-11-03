"""Base contracts and protocols for Industrial OT and IT connectors."""
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Callable, Coroutine
from pydantic import BaseModel, Field

TelemetryCallback = Callable[["TelemetryPacket"], Coroutine[Any, Any, None]]


class TelemetryPacket(BaseModel):
    """Standardized physical telemetry message received from shop-floor devices."""
    source_protocol: str = Field(..., description="opcua | mqtt_sparkplug | modbus")
    node_id: str = Field(..., description="Asset or sensor tag identifier")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    values: dict[str, Any] = Field(default_factory=dict)
    quality: str = Field(default="GOOD", description="GOOD | BAD | UNCERTAIN")


class IOTConnector(ABC):
    """Abstract interface for shop-floor OT connectors (Strictly Read-Only)."""

    @abstractmethod
    async def connect(self) -> bool:
        """Establish connection with industrial gateway/broker."""
        pass

    @abstractmethod
    async def disconnect(self) -> None:
        """Gracefully terminate connection."""
        pass

    @abstractmethod
    async def is_connected(self) -> bool:
        """Check connection liveness."""
        pass

    @abstractmethod
    async def subscribe(self, topic_or_node: str, callback: TelemetryCallback) -> None:
        """Subscribe to real-time telemetry changes."""
        pass


class IITConnector(ABC):
    """Abstract interface for enterprise IT systems (ERP, MES, WMS)."""

    @abstractmethod
    async def query(self, entity_type: str, query_params: dict[str, Any]) -> list[dict[str, Any]]:
        """Query enterprise records."""
        pass
