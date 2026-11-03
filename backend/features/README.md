# Feature Domain Modules (`backend/features`)

This directory houses the **7 core manufacturing intelligence domains** of Twin.

Every feature module is developed as an independent, self-contained domain following **Hexagonal Architecture (Ports and Adapters)** and **Domain-Driven Design (DDD)**.

---

## Standardized Hexagonal Module Structure

To ensure consistency, maintainability, and loose coupling, every feature follows an identical subfolder layout:

```
<feature_name>/
├── README.md        # Feature specification, domain model, and integration contracts
├── domain/          # Pure business logic: Entities, Value Objects, Domain Events, Invariants
│                    # (ZERO framework dependencies; no database, no HTTP, no ML library imports)
├── ports/           # Abstract Base Classes (ABCs) / Protocols defining contracts:
│   ├── input/       # Driving ports: Use-case interfaces consumed by APIs, MCP, and CLI
│   └── output/      # Driven ports: Repository contracts, sensor readers, ML inference interfaces
├── services/        # Application services orchestrating domain logic and calling output ports
├── adapters/        # Concrete implementations of driven ports:
│   ├── persistence/ # SQL / NoSQL / Time-Series repository implementations
│   ├── ml/          # Machine learning model inference (ONNX, PyTorch, scikit-learn, OpenCV)
│   └── external/    # Third-party APIs and external service clients
└── api/             # Driving adapters: FastAPI route controllers, request/response DTOs, schemas
```

---

## The 7 Intelligence Domains

1. [Predictive Maintenance](predictive_maintenance/README.md): Remaining Useful Life (RUL), ISO 10816 vibration classification, FFT spectrum anomaly detection.
2. [Visual Quality Inspection](visual_quality_inspection/README.md): Automated Optical Inspection (AOI) with Muse Spark defect classification, SAM 3.1 localisation and grounded advisory explanations, OpenCV golden template homography alignment, IPC-A-610 Class 2 standards, BigQuery lakehouse, and auditable human review.
3. [Production Optimization](production_optimization/README.md): Line OEE calculation, Theory of Constraints bottleneck identification, dynamic dispatching.
4. [Supply Chain Intelligence](supply_chain_intelligence/README.md): Dynamic BOM tree explosion, multi-echelon safety stock, supplier disruption risk.
5. [Demand Forecasting](demand_forecasting/README.md): Hierarchical time-series forecasting, order backlog pacing, Monte Carlo demand scenarios.
6. [Waste Reduction](waste_reduction/README.md): Scrap causal attribution, idle friction energy losses, Scope 1 & 2 carbon accounting.
7. [Operational Copilots](operational_copilots/README.md): Digital SOP conversational guidance, shift-handover summarization, alarm code triage.
