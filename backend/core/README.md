# Core Kernel (`backend/core`)

The **Core Kernel** provides cross-cutting domain abstractions, architectural contracts, standard physical units, dependency injection primitives, event routing, and distributed telemetry.

It contains **zero external framework dependencies** beyond typing, serialization, and telemetry standards.

---

## Directory Structure

```
backend/core/
├── interfaces/      # Abstract base interfaces (BaseEntity, IRepository, IEventBus, IPort)
├── models/          # Primitives: physical units (VibrationMmS, TemperatureC, kW), TimeRange
├── events/          # Domain event envelopes, EventPublisher, EventSubscriber abstractions
├── di/              # Lightweight Dependency Injection (DI) container
├── config/          # Pydantic BaseSettings for runtime configuration & environment variables
└── telemetry/       # OpenTelemetry spans, metrics instruments, and structured JSON logging
```

---

## Key Design Patterns & SOLID Abstractions

1. **Domain Primitives (`models/`)**: Strongly typed value objects representing physical physical quantities to prevent unit-mixing bugs (e.g. converting inches/second to mm/s).
2. **Interface Segregation (`interfaces/`)**: Narrow ports ensuring consumers only implement what they use.
3. **Dependency Inversion (`di/`)**: The DI container binds interfaces (e.g., `ITelemetryRepository`) to concrete adapters at runtime without domain code knowing about the database.
4. **Decoupled Event Bus (`events/`)**: Domain events (e.g., `VibrationThresholdExceededEvent`, `QualityDefectDetectedEvent`) are dispatched asynchronously, enabling independent reaction from multiple features.
