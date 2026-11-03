"""Lightweight, type-safe Dependency Injection (DI) container adhering to DIP."""
from typing import Any, Callable, Type, TypeVar, Optional

T = TypeVar("T")


class Container:
    """Dependency Injection Container managing service lifecycles (Singleton vs. Factory)."""

    def __init__(self) -> None:
        self._singletons: dict[Type[Any], Any] = {}
        self._factories: dict[Type[Any], Callable[[], Any]] = {}
        self._instances: dict[Type[Any], Any] = {}

    def register_singleton(self, interface: Type[T], instance: T) -> None:
        """Register a pre-built singleton instance for an interface."""
        self._singletons[interface] = instance

    def register_factory(self, interface: Type[T], factory: Callable[[], T]) -> None:
        """Register a factory callable that creates an instance on demand."""
        self._factories[interface] = factory

    def resolve(self, interface: Type[T]) -> T:
        """Resolve an implementation for a given interface."""
        if interface in self._singletons:
            return self._singletons[interface]

        if interface in self._instances:
            return self._instances[interface]

        if interface in self._factories:
            instance = self._factories[interface]()
            return instance

        raise KeyError(f"No binding registered for interface: {interface.__name__}")


# Global default container instance
global_container = Container()
