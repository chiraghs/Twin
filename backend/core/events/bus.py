"""Asynchronous event bus and domain event envelope."""
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Callable, Coroutine, Type, TypeVar
import uuid
from pydantic import BaseModel, Field

E = TypeVar("E", bound="DomainEvent")
EventHandler = Callable[[Any], Coroutine[Any, Any, None]]


class DomainEvent(BaseModel):
    """Immutable envelope for all system domain events."""
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str
    occurred_at: datetime = Field(default_factory=datetime.utcnow)
    payload: dict[str, Any] = Field(default_factory=dict)
    source: str = "twin-backend"


class IEventBus(ABC):
    """Abstract event bus interface (Dependency Inversion)."""

    @abstractmethod
    async def publish(self, event: DomainEvent) -> None:
        """Publish an event to all registered subscribers."""
        pass

    @abstractmethod
    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        """Subscribe an async handler to a specific event type."""
        pass


class InMemoryEventBus(IEventBus):
    """Production-grade in-memory asynchronous event bus with decoupled error isolation."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[EventHandler]] = {}

    def subscribe(self, event_type: str, handler: EventHandler) -> None:
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(handler)

    async def publish(self, event: DomainEvent) -> None:
        handlers = self._subscribers.get(event.event_type, [])
        for handler in handlers:
            try:
                await handler(event)
            except Exception as e:
                # Event handler errors must not break publishing flow (Decoupled execution)
                print(f"[EventBus] Error in handler for {event.event_type}: {e}")
