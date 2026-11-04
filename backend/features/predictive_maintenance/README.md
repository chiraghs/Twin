# Twin — Predictive Maintenance, ROI Intelligence & GenAI Copilot

![Predictive maintenance architecture](../../../docs/architecture/predictive-maintenance.png)

The maintenance copilot runs on **Meta's Muse Spark** (Meta Model API): it answers in any language from the assembled evidence (sensors, ML prediction, RAG incidents, approved SOPs), every figure is checked against that evidence, and the deterministic template is the fallback.

> **Enterprise-grade Autonomous Predictive Maintenance & ROI Intelligence Platform**  
> Uniting Industrial IoT telemetry, multi-source OT/IT connectivity (PLC, CMMS, MES, ERP), supervised failure prediction, Criticality-Adjusted Risk Index (CARI) advisories, auditable financial ROI ledgers, and a grounded GenAI Maintenance Copilot.

---

## 1. Executive Summary & Value Proposition

Traditional industrial predictive maintenance stops at statistical anomaly alerts, forcing plant engineers to manually sift through SCADA graphs, cross-reference ERP spare-part inventory, and guess downtime costs.

**Twin** transforms raw machinery telemetry into governed operational and financial decisions:
1. **Multi-Source OT/IT Convergence**: Bridges shop-floor telemetry (PLC/SCADA) with maintenance history (CMMS), production lines (MES), and asset/inventory financials (ERP).
2. **Standardized ISO 10816-3 Physics**: Real-time vibration velocity RMS zone classification ($A, B, C, D$) combined with supervised Random Forest failure probabilities ($24\text{h}$ prediction horizon).
3. **CARI Recommendation Engine**: Scores and ranks maintenance advisories by business risk, cross-checks ERP spare-part stock, and enforces human-in-the-loop signoff.
4. **Auditable Financial ROI Ledger (`fact_roi_ledger`)**: Compares avoided downtime against unmonitored plant baselines, tracking realized vs. estimated savings and platform payback period.
5. **GenAI Maintenance Copilot**: Autonomous conversational assistant grounded in verified telemetry, historical incident RAG, approved SOPs with mandatory LOTO safety protocols, prompt-injection defense, and multilingual support (English, German, Hindi).

---

## 2. End-to-End System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                SHOP-FLOOR & ENTERPRISE SOURCES                          │
│                                                                                        │
│   ┌────────────────────┐   ┌────────────────────┐   ┌────────────────┐   ┌─────────┐   │
│   │     PLC / SCADA    │   │     CMMS Maximo    │   │  MES Opcenter  │   │ ERP SAP │   │
│   │ Telemetry, Alarms  │   │  Work Orders, WOs  │   │ Downtime, OEE  │   │ Parts, $│   │
│   └─────────┬──────────┘   └─────────┬──────────┘   └───────┬────────┘   └───┬─────┘   │
└─────────────┼────────────────────────┼──────────────────────┼────────────────┼─────────┘
              │                        │                      │                │
              ▼                        ▼                      ▼                ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        INGESTION & CANONICAL ADAPTER LAYER                             │
│                                                                                        │
│   • MQTT telemetry (Mosquitto / EMQX) and the local telemetry buffer                   │
│   • Schema validation and rolling-window feature engineering in the backend            │
│   • Source System Connectors with Data Provenance Tracking [ACTUAL vs. SIMULATED]      │
│   • Cross-System Entity Bridge (`bridge_asset_source_id` mapping native IDs)           │
└──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                       │
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                 CANONICAL DATA MODEL · SQLite (pm_ tables) + DuckDB                    │
│                                                                                        │
│   • dim_asset                     • fact_sensor_reading          • fact_work_order     │
│   • bridge_asset_source_id        • fact_machine_prediction      • fact_inventory_cost │
│   • fact_machine_state            • fact_maintenance_outcome     • fact_roi_ledger     │
└──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌───────────────────────────────────────┐   ┌────────────────────────────────────────────┐
│      PREDICTIVE ML & RISK ENGINE      │   │          GENAI MAINTENANCE COPILOT         │
│                                       │   │                                            │
│ • Random Forest Supervised Classifier │   │ • Multi-Source Grounded Synthesis          │
│ • ISO 10816-3 Vibration Severity      │   │ • Historical Incident RAG Retrieval        │
│ • CARI Recommendation Engine          │   │ • Approved SOPs with LOTO Protocols        │
│ • Spare Parts Stockout Validation     │   │ • Prompt-Injection Defense Sanitizer       │
│ • Volume-Adjusted ROI Accounting      │   │ • Multilingual Generation (EN / DE / HI)   │
│ • Dynamic Config Store (REST API)     │   │ • Technician Feedback & Ledger Linkage     │
└───────────────────┬───────────────────┘   └─────────────────────┬──────────────────────┘
                    │                                             │
                    └──────────────────────┬──────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          FASTAPI BACKEND & ENTERPRISE UI                               │
│                                                                                        │
│   • High-Performance Async REST API (`/api/v1/predictive-maintenance/*`)              │
│   • Interactive Streamlit Dashboard (5 Tabs: Fleet, Advisories, ROI, Sources, Copilot) │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Subsystem Organization & Codebase Map

The codebase is modularized under [`backend/features/predictive_maintenance/`](file:///Volumes/DiskD/HACKATHONS/Twin/backend/features/predictive_maintenance):

```
backend/features/predictive_maintenance/
├── api/                    # FastAPI route handlers & dependency injection
│   └── router.py           # Unified REST routes (fleet, recs, ROI, sources, config, copilot)
├── adapters/               # Hexagonal outbound adapters for external services
│   └── machine_repository_adapter.py
├── config/                 # Dynamic runtime configuration store & Pydantic schemas
│   └── models.py           # ISO 10816 thresholds, model hyperparameters, CARI weights
├── connectors/             # Industrial OT/IT system connectors with data provenance
│   ├── base.py             # Abstract BaseConnector, SourceSystemState, DataProvenance
│   ├── plc_connector.py    # OPC-UA / Modbus / MQTT PLC stream connector
│   ├── cmms_connector.py   # IBM Maximo / SAP PM work order connector
│   ├── mes_connector.py    # Opcenter production downtime connector
│   ├── erp_connector.py    # SAP S/4HANA spare parts & labor rate connector
│   └── manager.py          # Unified SourceSystemManager fleet coordinator
├── copilot/                # Twin GenAI Maintenance Copilot
│   ├── __init__.py         # Exported copilot package symbols
│   ├── models.py           # Chat requests, grounded evidence, incidents, SOPs, feedback
│   ├── rag_service.py      # Governed RAG retrieval, prompt-injection defense, SOP index
│   ├── copilot_service.py  # Multi-source grounded synthesis & multilingual generator
│   └── feedback_service.py # Technician feedback recording & fact_roi_ledger linkage
├── domain/                 # Domain logic and value objects
│   ├── models.py           # MachineEntity, RiskCategory, ISO10816Severity
│   └── vibration_standard.py # ISO 10816-3 calculation logic
├── feature_engineering/    # Real-time feature calculation
│   └── rolling_aggregators.py # RMS vibration, mean temp, stability index, friction drift
├── ingestion/              # Telemetry ingestion
│   └── local_buffer.py     # Buffered readings before persistence
├── ml/                     # Machine learning pipelines & local model registry
│   ├── training/           # Offline model training & synthetic dataset generator
│   ├── inference/          # FailurePredictor with scikit-learn
│   ├── evaluation/         # Precision, recall, ROC-AUC, PR-AUC evaluation metrics
│   └── registry/           # Local versioned model registry (sha256, metrics, human-approved promotion)
├── ports/                  # Hexagonal ports / repository interfaces
│   └── machine_repository_port.py
├── repositories/           # Data persistence layer
│   ├── tables.py           # SQLite table declarations (pm_ tables)
│   └── local_mock_repo.py  # Seeded repository, persisted to SQLite
├── schemas/                # Pydantic data schemas
│   ├── sensor_reading.py   # Telemetry event validation (ranges, units, timestamps)
│   └── canonical_models.py # Canonical data model schemas
├── services/               # Core application domain services
│   ├── canonical_mapping_service.py # Entity resolution & cross-system bridge
│   ├── machine_service.py           # Fleet state & time-series retrieval
│   ├── recommendation_engine.py     # CARI advisory generation & signoff workflow
│   └── roi_intelligence_service.py  # Financial value waterfall & fact_roi_ledger
└── simulator/              # Industrial physics telemetry generator
    ├── generator.py        # 20+ assets, 5 archetypes, gradual degradation, faults
    └── config.py           # Simulator parameters, random seed, cadence
```

---

## 4. Canonical Multi-Source Data Model

All telemetry, maintenance, and enterprise records map to canonical schemas (persisted in SQLite, analysed with DuckDB):

| Table Name | Description | Key Fields |
|---|---|---|
| `dim_asset` | Master machinery register across all plants | `asset_id`, `plant_id`, `line_id`, `criticality`, `hourly_downtime_cost_usd` |
| `bridge_asset_source_id` | Cross-system tag bridge (PLC Tag <-> Maximo ID <-> SAP Asset #) | `canonical_asset_id`, `system_id`, `native_source_id`, `is_primary` |
| `fact_sensor_reading` | High-frequency physical telemetry records | `reading_id`, `asset_id`, `timestamp`, `vibration_mm_s`, `temperature_celsius` |
| `fact_machine_prediction`| Model inference outputs & anomaly scores | `prediction_id`, `asset_id`, `failure_probability`, `risk_category`, `horizon_hours` |
| `fact_maintenance_recommendation` | Actionable advisories requiring human signoff | `recommendation_id`, `asset_id`, `cari_score`, `urgency`, `approval_status` |
| `fact_work_order` | Ingested CMMS maintenance events | `work_order_id`, `asset_id`, `failure_code`, `actual_cost_usd`, `downtime_hours` |
| `fact_roi_ledger` | Immutable financial audit trail of avoided costs | `ledger_id`, `asset_id`, `entry_type`, `amount_usd`, `cumulative_net_benefit_usd` |

### Entity Bridge Example (`bridge_asset_source_id`)
```json
{
  "canonical_asset_id": "CNC-001",
  "plc_tag": "TAG_BLR_CNC-001_VIB_RMS",
  "cmms_maximo_id": "MX-EQ-1001",
  "mes_station_id": "OPC-ST-CNC-001",
  "erp_sap_asset": "SAP-AST-8001",
  "hourly_downtime_cost": 3500.00
}
```

---

## 5. Mathematical Formulations & Decision Logic

### A. ISO 10816-3 Vibration Severity Standard
Evaluates broadband vibration velocity RMS ($10\text{ Hz} - 1000\text{ Hz}$):
- **Zone A (Good)**: $V_{\text{RMS}} < 1.8\text{ mm/s}$ — newly commissioned machinery.
- **Zone B (Acceptable)**: $1.8 \le V_{\text{RMS}} < 4.5\text{ mm/s}$ — normal long-term running.
- **Zone C (Unsatisfactory)**: $4.5 \le V_{\text{RMS}} < 7.1\text{ mm/s}$ — remedial action required.
- **Zone D (Unacceptable)**: $V_{\text{RMS}} \ge 7.1\text{ mm/s}$ — danger of imminent breakdown; trip condition.

*Note: All thresholds are fully dynamic and configurable at runtime via the `/config` API.*

### B. Criticality-Adjusted Risk Index (CARI)
Determines maintenance prioritization by blending predictive risk, physical degradation, asset criticality, and financial exposure:

$$\text{CARI} = w_1 \cdot P(\text{failure}_{24\text{h}}) + w_2 \cdot \min\left(1.0, \frac{V_{\text{RMS}}}{V_{\text{trip}}}\right) + w_3 \cdot W_{\text{criticality}} + w_4 \cdot \min\left(1.0, \frac{C_{\text{downtime}}}{C_{\text{max}}}\right)$$

- Default Weights: $w_1 = 0.40, w_2 = 0.30, w_3 = 0.15, w_4 = 0.15$
- Asset Criticality Weights: Class A (1.0), Class B (0.6), Class C (0.3)

### C. Financial ROI Accounting & Ledger
- **Baseline Annual Loss**: $N_{\text{unmonitored breakdowns}} \times \text{Mean Downtime Hours} \times \text{Cost per Hour}$
- **Net Avoided Downtime Benefit**:
$$\text{Net Benefit} = (\text{Catastrophic Downtime Avoided} - \text{Planned Service Downtime}) \times \text{Hourly Rate} - \text{Maint Cost}$$
- **Payback Period (Months)**:
$$\text{Payback} = \frac{\text{Platform Implementation Cost} + \text{Annual OpEx}}{\text{Net Annual Realized Savings}} \times 12$$

---

## 6. GenAI Maintenance Copilot

The Copilot is an intelligent maintenance assistant that operates under a **Strict Zero-Hallucination Policy**: all telemetry, ML metrics, and costs originate from repository services.

### Core Capabilities:
1. **Multi-Source Factual Grounding**: Separates verified facts (PLC, ERP), ML predictions, and historical observations from generative explanations.
2. **Governed RAG Retrieval**: Metadata-aware retrieval over CMMS work orders, failure codes, root causes, and verified post-repair outcomes.
3. **Approved SOP Retrieval**: Delivers governed standard procedures (`SOP-MECH-BRG-04`, `SOP-LOTO-01`, `SOP-ROB-GEAR-02`) complete with required tools, replacement part numbers, and mandatory **Lockout/Tagout (LOTO)** zero-energy isolation steps.
4. **Prompt-Injection Defense**: Pre-execution regex sanitizer (`sanitize_maintenance_text`) neutralizes instruction-override vectors (`ignore previous instructions`, `system prompt`, `<script>`).
5. **Multilingual Synthesis**: Answers natively in English (`en`), German (`de`), and Hindi (`hi`), strictly preserving technical asset tags (`CNC-001`), numerical readings, and units (`mm/s`, `°C`, `bar`).
6. **Technician Feedback Closure**: Captures human-in-the-loop decisions (`ACCEPTED`, `REJECTED`, `DEFERRED`), usefulness scores (1-5), and observed conditions. Accepted resolutions automatically append auditable value to `fact_roi_ledger`.

---

## 7. REST API Reference

All endpoints are hosted under `/api/v1/predictive-maintenance`:

| Group | Method | Endpoint | Description |
|---|---|---|---|
| **Fleet** | `GET` | `/machines` | List monitored assets with health states and failure probabilities |
| | `GET` | `/machines/{id}` | Real-time telemetry, operating hours, and risk category |
| | `GET` | `/machines/{id}/history` | Historical time-series sensor readings |
| | `GET` | `/analytics/summary` | Fleet reliability score, active alerts, and plant distribution |
| **Advisories** | `GET` | `/recommendations` | Active CARI maintenance advisories with ERP parts check |
| | `POST` | `/recommendations/{id}/approve` | Sign off on recommendation (transitions to `APPROVED`) |
| | `POST` | `/recommendations/{id}/reject` | Reject recommendation with documented reasoning |
| **ROI** | `GET` | `/roi/summary` | Financial waterfall, realized vs estimated savings, payback period |
| | `GET` | `/roi/ledger` | Auditable `fact_roi_ledger` entries proving avoided costs |
| **Sources** | `GET` | `/sources/health` | OT/IT connectivity status (PLC, CMMS, MES, ERP) & provenance |
| | `GET` | `/canonical/assets` | Canonical asset register with cross-system bridge mappings |
| **Config** | `GET` | `/config` | Read active ISO thresholds, CARI weights, and ML parameters |
| | `PUT` | `/config` | Dynamically update vibration thresholds or model thresholds |
| **Copilot** | `POST` | `/copilot/chat` | Natural language conversational query with multi-source grounding |
| | `GET` | `/copilot/incidents/similar` | RAG retrieval of historical CMMS incidents with verified outcomes |
| | `GET` | `/copilot/procedures/approved` | Governed Standard Operating Procedures (SOPs) |
| | `GET` | `/copilot/asset-context/{id}` | 360° asset context uniting telemetry, ERP costs, and active alerts |
| | `POST` | `/copilot/feedback` | Record technician operational feedback and update `fact_roi_ledger` |
| | `GET` | `/copilot/feedback` | Retrieve historical technician feedback audit log |

---

## 8. Streamlit Enterprise Dashboard

The dashboard provides a unified 5-tab operations cockpit:

```bash
# Launch interactive Streamlit dashboard
cd dashboard && streamlit run app.py --server.port 8501
```

- **Tab 1: 🏭 Fleet Health & Physics**: Top KPI metrics, Asset Health Matrix, ISO 10816 vibration drift line charts with color-coded severity zones.
- **Tab 2: 🎯 CARI Recommendations**: CARI-ranked actionable advisories, ERP parts stockout warnings, downtime avoided metrics, and 1-click Approve/Reject buttons.
- **Tab 3: 💰 Financial ROI & Ledger**: Enterprise value waterfall chart, realized vs. estimated savings cards, payback period metric, and immutable `fact_roi_ledger` audit table.
- **Tab 4: 🔌 Connected OT/IT Sources & Lineage**: Live health status for PLC, CMMS, MES, and ERP connectors, data provenance badges (`ACTUAL` vs `SIMULATED`), and the cross-system entity bridge table.
- **Tab 5: 🤖 GenAI Maintenance Copilot**: Natural-language conversational query interface with quick-action prompts, grounded evidence inspection tabs (Facts, Predictions, Incidents, SOPs, Data Gaps), and the governed technician feedback capture form.

---

## 9. Automated Testing & Verification

The test suite runs with 100% offline fallback compatibility without external cloud services or database servers:

```bash
# 1. Run the GenAI Maintenance Copilot test suite
python3 backend/tests/predictive_maintenance/test_genai_copilot.py

# 2. Run the Twin Business Value & ROI test suite
PYTHONPATH=. python3 backend/tests/predictive_maintenance/test_business_value_platform.py

# 3. Run sensor simulator & feature engineering tests
PYTHONPATH=. python3 backend/tests/predictive_maintenance/test_simulator.py
PYTHONPATH=. python3 backend/tests/predictive_maintenance/test_feature_engineering.py
PYTHONPATH=. python3 backend/tests/predictive_maintenance/test_ml_pipeline.py

# 4. Run cross-feature backend test suites
PYTHONPATH=. python3 backend/tests/test_features.py
PYTHONPATH=. python3 backend/tests/test_core.py
```

### Verification Coverage:
- `test_prompt_injection_sanitization`: Verifies regex redaction of instruction-override attacks.
- `test_rag_historical_incident_retrieval`: Validates metadata-aware hybrid relevance ranking of CMMS records.
- `test_rag_approved_procedure_retrieval`: Validates governed SOP retrieval with LOTO safety warnings.
- `test_copilot_grounded_conversational_response`: Confirms zero-hallucination multi-source grounding.
- `test_copilot_multilingual_synthesis`: Confirms unit and tag preservation across German and Hindi.
- `test_technician_feedback_and_roi_ledger_capture`: Confirms end-to-end feedback logging and `fact_roi_ledger` credit.

---

## 10. Deployment & Infrastructure

### Local Development Mode
No cloud credentials required. The platform uses:
- `LocalMockMachineRepository` seeded with 20 realistic assets, persisted to the shared SQLite database.
- Simulated telemetry with provenance explicitly marked as `[SIMULATED]`; MQTT ingestion when a broker is configured.

### Deployment
- **Docker Compose**: `docker compose up --build` runs the backend next to the web app on the shared `twin-data` volume.
- **Data model**: [docs/data-model.md](../../../docs/data-model.md) lists every `pm_` table with its columns and indexes.
- **Scaling**: PostgreSQL for the tables, ClickHouse or Iceberg + Trino/Presto for analytics, Kubernetes for the containers (see the top-level README).
