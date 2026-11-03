# Industrial & Enterprise Connectors (`backend/connectors`)

The **Connectors** module implements secondary adapters that interface with shop-floor Operational Technology (OT) and enterprise Information Technology (IT) systems.

It strictly adheres to **read-only safety guarantees** for shop-floor machinery, ensuring that Twin monitors and analyzes equipment without writing unauthorized control commands to programmable logic controllers (PLCs).

---

## Directory Structure

```
backend/connectors/
├── opcua/           # OPC Unified Architecture (OPC UA) binary client & node subscription
├── mqtt/            # MQTT v5 client with Sparkplug B industrial payload decoding
├── modbus/          # Modbus TCP/RTU driver for legacy field equipment and power meters
├── erp/             # Enterprise Resource Planning adapter (SAP S/4HANA OData, NetSuite)
├── mes/             # Manufacturing Execution System adapter (work orders, routing schedules)
└── tsdb/            # High-throughput Time-Series Database adapters (TimescaleDB, InfluxDB)
```

---

## Connector Contracts & Design

Every connector implements the `IOTConnector` or `IITConnector` interface:

- **Lifecycle Management**: Explicit `connect()`, `disconnect()`, `health_check()`, and auto-reconnection with exponential backoff.
- **Circuit Breaker**: Isolates failing network hops to avoid cascading latency.
- **Sparkplug B Decoder**: Parses compressed industrial protocol state messages and converts them into standardized domain telemetry envelopes.
- **Liskov Substitution**: Any telemetry source can feed the domain pipeline interchangeably whether data originates from real OPC UA nodes or a high-resolution simulated replay.
