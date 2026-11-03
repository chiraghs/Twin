# Twin AI — Enterprise Intelligence Backend

The **Twin Backend** is a modular, event-driven industrial AI backend designed to provide high-performance physical modeling, predictive analytics, autonomous multi-agent orchestration, and operational copilots for smart manufacturing facilities.

Built following strict **Domain-Driven Design (DDD)**, **Hexagonal Architecture (Ports and Adapters)**, and **SOLID Object-Oriented Principles**, it is completely decoupled from any single frontend or transport layer. It exposes capabilities through **REST/WebSocket APIs**, **gRPC**, and the **Model Context Protocol (MCP)**.

---

## Architecture Blueprint

```
backend/
├── core/                         # Cross-cutting abstractions, interfaces, DI container, config, telemetry
├── connectors/                   # Physical OT (OPC-UA, MQTT, Modbus) and IT (ERP, MES, TSDB) adapters
├── mcp/                          # Model Context Protocol servers, tools, resources, and prompts
├── rag/                          # Industrial Hybrid RAG & Knowledge Graph engine
├── agents/                       # Multi-agent swarm, coordinator, specialist supervisors, state graphs
└── features/                     # Domain intelligence feature modules
    ├── predictive_maintenance/   # RUL estimation, ISO 10816 vibration, FFT anomaly detection
    ├── visual_quality_inspection/# AOI, golden template registration, defect classification
    ├── production_optimization/  # OEE analysis, bottleneck detection, dynamic dispatch
    ├── supply_chain_intelligence/# BOM explosion, multi-echelon buffer stock, supplier risk
    ├── demand_forecasting/       # Multi-horizon forecasting, backlog pacing, Monte Carlo
    ├── waste_reduction/          # Scrap root-cause attribution, energy waste, GHG tracking
    └── operational_copilots/     # Shift-handover, SOP interactive guidance, alarm triage
```

---

## SOLID Principles in Practice

- **Single Responsibility (SRP)**: Domain models only encode physical and manufacturing invariants. Persistence, transport, and external ML inference are isolated in dedicated adapters.
- **Open/Closed (OCP)**: New machine archetypes, telemetry sensors, and defect detection algorithms plug in via abstract ports without modifying existing orchestration engines.
- **Liskov Substitution (LSP)**: Connector implementations (`MqttConnector`, `OpcUaConnector`) and forecasters (`ProphetForecaster`, `TFTForecaster`) satisfy strict behavioral contracts and can be swapped transparently.
- **Interface Segregation (ISP)**: Clients depend solely on fine-grained interfaces (e.g. `ITelemetryReader`, `ITrendAnalyzer`) rather than fat monolithic interfaces.
- **Dependency Inversion (DIP)**: High-level business logic depends strictly on abstract interfaces. Infrastructure dependencies are injected at runtime via the Dependency Injection container.

---

## Directory Navigation

- [Core Kernel](core/README.md): Primitives, base interfaces, event bus, and telemetry.
- [Industrial Connectors](connectors/README.md): OPC UA, MQTT Sparkplug B, Modbus, ERP/MES bridges.
- [Model Context Protocol (MCP)](mcp/README.md): Standardized tool specifications and server.
- [Industrial RAG](rag/README.md): Vector search, GraphRAG equipment ontology, and industrial manual chunking.
- [Autonomous Agents](agents/README.md): Multi-agent coordinator, supervisor graph, and human-in-the-loop governance.
- [Feature Modules](features/README.md): The seven specialized intelligence domains.
