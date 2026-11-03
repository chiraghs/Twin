# Twin AI — Enterprise Intelligence Backend

The **Twin Backend** is a modular, event-driven industrial AI backend designed to provide high-performance physical modeling, predictive analytics, autonomous multi-agent orchestration, and operational copilots for smart manufacturing facilities.

Built following strict **Domain-Driven Design (DDD)**, **Hexagonal Architecture (Ports and Adapters)**, and **SOLID Object-Oriented Principles**, it is completely decoupled from any single frontend or transport layer. It exposes capabilities through **REST/WebSocket APIs**, **gRPC**, and the **Model Context Protocol (MCP)**.

---

## Architecture Blueprint

```
backend/
├── core/                         # Cross-cutting abstractions, interfaces, DI container, config, telemetry
│   ├── db/                       # SQLite: declared tables, write-through collections, configs + history, run history
│   ├── ai/                       # Meta Model API client (Muse Spark / Wonder, SAM 3.1, Muse Image), grounded narration
│   └── api/                      # Data API: data model, run history, config history, AI activity
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

## Runtime, persistence and AI

- **Part of Twin.** The web app (Next.js) calls this backend through its `/api/backend/*` proxy and shows it on the **Intelligence Backend** page. Run it with `npm run backend` from the repository root (port 8000).
- **SQLite system of record.** The backend shares `.data/twin.db` with the web app (WAL mode; `TWIN_DB_PATH` / `TWIN_DATA_DIR` to move it). Every repository attribute is a write-through collection bound to a declared table (`pm_*`, `vq_*`, `sc_*`, `df_*`, `oc_*`), feature configurations live in `app_config` with full history, and results of write endpoints are kept as run history. Demo data is seeded only into an empty database. Catalogue: [docs/data-model.md](../docs/data-model.md).
- **Meta Model API only.** Muse Spark writes copilot answers and AOI classifications, SAM 3.1 localises defects, Muse Wonder writes what-if and S&OP briefs. Every answer is grounding-checked against the deterministic evidence, and every feature has a deterministic fallback when `MODEL_API_KEY` is not set. `GET /ai/status` and `GET /api/v1/data/ai-activity` show what ran.
- **Tests.** `npm run test:backend` (pytest, isolated temporary database).

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
