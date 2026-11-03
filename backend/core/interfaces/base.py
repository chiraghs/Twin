"""Core foundational interfaces and base abstractions adhering to SOLID principles."""
from abc import ABC, abstractmethod
from typing import TypeVar, Generic, Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field

T = TypeVar("T")
ID = TypeVar("ID")


class BaseValueObject(BaseModel):
    """Immutable domain value object. Equality is based on attributes, not identity."""
    model_config = {"frozen": True}


class BaseEntity(BaseModel):
    """Domain Entity with unique identity lifecycle."""
    id: str = Field(..., description="Unique entity identifier")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def __eq__(self, other: Any) -> bool:
        if not isinstance(other, BaseEntity):
            return False
        return self.id == other.id

    def __hash__(self) -> int:
        return hash(self.id)


class IRepository(ABC, Generic[T, ID]):
    """Generic repository abstraction for persistence isolation (Dependency Inversion)."""

    @abstractmethod
    async def get_by_id(self, entity_id: ID) -> Optional[T]:
        """Fetch an entity by its identifier."""
        pass

    @abstractmethod
    async def list_all(self, limit: int = 100, offset: int = 0) -> list[T]:
        """List entities with pagination."""
        pass

    @abstractmethod
    async def save(self, entity: T) -> T:
        """Persist or update an entity."""
        pass

    @abstractmethod
    async def delete(self, entity_id: ID) -> bool:
        """Delete an entity by its identifier."""
        pass


class IInputPort(ABC):
    """Marker interface for driving use cases (Application Services)."""
    pass


class IOutputPort(ABC):
    """Marker interface for driven ports (Repositories, Gateways, Adapters)."""
    pass
