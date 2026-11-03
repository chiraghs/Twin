# Twin — AI-Powered Supply Chain Intelligence Platform

![Supply chain intelligence architecture](../../../docs/architecture/supply-chain-intelligence.png)

The assistant runs on **Meta's Muse Spark** (grounded answers in any language) and **Muse Wonder** briefs every what-if disruption simulation; all figures come from the deterministic risk and impact engines.

> **Enterprise-grade, GCP-Powered Autonomous Supply Chain Intelligence Platform**  
> Uniting multi-tier supplier delivery tracking, Bill-of-Materials (BOM) downstream plant propagation, in-transit logistics delay detection, governed KPI frameworks, and an AI-powered conversational analytics assistant with what-if disruption simulation.

---

## 1. Executive Summary & Business Objective

Industrial supply chains suffer from fragmented visibility across ERP purchase orders, logistics carrier milestones, shop-floor inventory levels, and customer order delivery commitments. A single delayed component shipment frequently cascades into idle manufacturing lines, missed customer delivery SLAs, and steep contractual penalties.

**Twin Supply Chain Intelligence** bridges the entire value chain into a governed operational graph:
1. **Governed Supply Chain Ontology**: Connects `Supplier` ➔ `Part (BOM)` ➔ `Purchase Order` ➔ `Shipment` ➔ `Warehouse` ➔ `Plant` ➔ `Customer Order` ➔ `Customer`.
2. **Multi-Factor Supplier Risk Scoring**: Evaluates historical On-Time Delivery (OTD), lead-time variance, defect PPM, geopolitical exposure, and financial stability.
3. **Real-Time Logistics Delay Detection**: Tracks in-transit multi-modal shipments, detecting ETA drift, port congestion, and customs clearance holds.
4. **BOM Downstream Plant Propagation**: Traces delayed parts through the Bill of Materials to identify threatened finished assemblies, halted plant shifts, and customer orders at immediate delivery risk.
5. **Governed KPI Framework**: Computes 9 standard enterprise metrics (OTD, Fill Rate, Days of Inventory, Lead-Time Variance, Shipment Delay Rate, Disruption Financial Cost).
6. **Prescriptive Mitigation Action Center**: Ranks corrective actions (Expedited air freight, dual-source reallocation, inventory re-balancing) by net financial benefit ($ cost avoidance) with 1-click human approval.
7. **AI Conversational Analytics & What-If Simulator**: Zero-hallucination conversational interface answering complex operational inquiries and simulating hypothetical supplier failure scenarios.

---

## 2. End-to-End System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              GLOBAL MULTI-SOURCE INPUTS                                │
│                                                                                        │
│   ┌────────────────────┐   ┌────────────────────┐   ┌────────────────┐   ┌─────────┐   │
│   │     ERP Systems    │   │     TMS Systems    │   │  WMS Systems   │   │   OMS   │   │
│   │ SAP S/4HANA POs    │   │ Carrier GPS, ETAs  │   │ Stock Balances │   │ Customer│   │
│   │ & Supplier Master  │   │ & Port Congestion  │   │ & Bin Locations│   │ Orders  │   │
│   └─────────┬──────────┘   └─────────┬──────────┘   └───────┬────────┘   └───┬─────┘   │
└─────────────┼────────────────────────┼──────────────────────┼────────────────┼─────────┘
              │                        │                      │                │
              ▼                        ▼                      ▼                ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        INGESTION & CANONICAL ONTOLOGY LAYER                            │
│                                                                                        │
│   • Google Cloud Pub/Sub (`supply-chain-events` topic)                                 │
│   • Schema Validation, Deduplication, Timestamp Normalization & DLQ Routing            │
│   • Data Provenance Tagging [ACTUAL vs. SIMULATED vs. ESTIMATED]                       │
│   • Cross-System Entity Resolution (`Supplier` -> `Part` -> `PO` -> `Shipment`)        │
└──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                       │
                                       ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         BIGQUERY ENTERPRISE DATA LAKEHOUSE                             │
│                                                                                        │
│   • dim_supplier                  • fact_inventory_balance       • fact_customer_order │
│   • dim_part                      • fact_purchase_order          • fact_disruption     │
│   • dim_bill_of_materials         • fact_shipment                • fact_mitigation     │
└──────────────────────────────────────┬─────────────────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌───────────────────────────────────────┐   ┌────────────────────────────────────────────┐
│     INTELLIGENCE & RISK ENGINE        │   │          CONVERSATIONAL AI ASSISTANT       │
│                                       │   │                                            │
│ • Multi-Factor Supplier Risk Scoring  │   │ • Multi-Source Grounded Synthesis          │
│ • Real-Time ETA Drift & Port Delay    │   │ • Strict Zero-Hallucination Guardrails     │
│ • Days of Inventory (DOI) Forecasting │   │ • Downstream BOM & SLA Impact Tracing      │
│ • Single-Source Concentration (HHI)   │   │ • What-If Disruption Scenario Simulator    │
│ • Prescriptive Mitigation ROI Ranking │   │ • Prompt-Injection Defense Sanitizer       │
│ • Governed Enterprise KPI Framework   │   │ • Multilingual Generation (EN / DE / HI)   │
└───────────────────┬───────────────────┘   └─────────────────────┬──────────────────────┘
                    │                                             │
                    └──────────────────────┬──────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         FASTAPI BACKEND & ENTERPRISE UI                                │
│                                                                                        │
│   • High-Performance Async REST API (`/api/v1/supply-chain/*`)                         │
│   • Interactive Streamlit Operations Cockpit (`dashboard/supply_chain_app.py`)        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Governed Business Ontology & Entities

The platform implements an explicit enterprise relational graph:

```
Supplier ──(supplies)──> Part ──(BOM)──> Finished Assembly
    │                     │
(issues)             (carried by)
    │                     │
    ▼                     ▼
Purchase Order ─────> Shipment ──(delivers to)──> Warehouse ──> Plant
                                                                  │
                                                          (manufactures for)
                                                                  │
                                                                  ▼
                                                            Customer Order ──> Customer
```

### Table Catalog:
| Entity / Table | Primary Key | Description | Key Foreign Keys |
|---|---|---|---|
| `dim_supplier` | `supplier_id` | Tier 1/2/3 global vendors with lead times and OTD rates | — |
| `dim_part` | `part_id` | Component catalog, unit costs, safety stocks, dual-sourcing | `primary_supplier_id`, `alternate_supplier_id` |
| `dim_bill_of_materials` | Composite | Maps component parts into finished assemblies | `finished_assembly_id`, `part_id` |
| `fact_inventory_balance` | `inventory_id` | Real-time stock on hand, allocated, available, and DOI | `part_id`, `warehouse_id`, `plant_id` |
| `fact_purchase_order` | `po_id` | Commercial purchase orders with promise and arrival dates | `supplier_id`, `part_id`, `destination_plant_id` |
| `fact_shipment` | `shipment_id` | Logistics tracking with transport mode and ETA drift | `po_id` |
| `fact_customer_order` | `order_id` | Customer delivery commitments, revenues, and SLA penalties | `finished_assembly_id`, `plant_id` |
| `fact_disruption_event` | `disruption_id` | Detected bottleneck events and daily financial exposure | Array of affected suppliers, parts, orders |
| `fact_mitigation_recommendation` | `recommendation_id` | Prescriptive mitigation actions with ROI calculations | `disruption_id`, `target_part_id` |

---

## 4. Governed KPI Framework & Mathematical Formulas

Every KPI in the platform is strictly defined and verifiable:

### 1. On-Time Delivery Rate (OTD)
$$\text{OTD} = \frac{\sum \text{Completed Shipments Delivered on or before Promise Date}}{\text{Total Completed Shipments}} \times 100\%$$

### 2. Order Fill Rate
$$\text{Order Fill Rate} = \frac{\text{Customer Orders Fulfilled Complete Without Backorder}}{\text{Total Customer Orders Placed}} \times 100\%$$

### 3. Days of Inventory (DOI)
$$\text{DOI} = \frac{\text{Stock On Hand (Units)}}{\text{Average Daily Consumption Rate (Units/Day)}}$$
*Breaches below 3.0 days trigger immediate critical stockout warnings.*

### 4. Supplier Reliability Index (0–100)
Blends four operational parameters:
$$\text{Reliability} = 0.40 \cdot (\text{OTD} \times 100) + 0.25 \cdot \max(0, 100 - 12 \sigma_{\text{lead}}) + 0.20 \cdot (\text{FinScore} \times 100) + 0.15 \cdot \max(0, 100 - \text{PPM}/10)$$

### 5. Lead-Time Variability ($\sigma_{\text{lead}}$)
$$\sigma_{\text{lead}} = \sqrt{\frac{1}{N-1} \sum_{i=1}^N (L_i - \bar{L})^2}$$
*Measures standard deviation in days between promised and actual shipment arrival.*

### 6. Stockout Risk Index
$$\text{Stockout Risk} = \frac{\text{Active SKUs with Stockout Risk} > 50\% \text{ or DOI} < 3\text{ Days}}{\text{Total Monitored SKUs}} \times 100\%$$

### 7. Shipment Delay Rate
$$\text{Delay Rate} = \frac{\text{In-Transit Shipments with ETA Drift} > 0}{\text{Total Active In-Transit Shipments}} \times 100\%$$

### 8. Orders at Risk
Count and USD revenue valuation of customer orders whose required BOM parts are delayed or out of stock.

### 9. Estimated Disruption Cost
$$\text{Cost} = \sum_{\text{Disruptions}} \Big( \text{Daily Plant Downtime Loss} \times \text{Days} + \sum_{\text{Orders}} \text{Daily SLA Penalty} \times \text{Days} \Big)$$

---

## 5. Conversational AI Assistant & What-If Simulator

The Conversational AI operates under a **Strict Zero-Hallucination Policy**:
- All stock balances, supplier OTD rates, and customer orders originate from verified repository services.
- User queries are passed through pre-execution regex sanitization (`sanitize_supply_chain_text`) neutralizing prompt-injection attempts.
- Output strictly separates **[Verified Facts]**, **[Risk Predictions]**, **[Downstream BOM Impact]**, and **[Prescriptive Mitigations]**.
- Multilingual support for English (`en`), German (`de`), and Hindi (`hi`), strictly preserving technical tags (`PRT-MCU-8841`, `SUP-MICRO-01`) and financial currencies.

### What-If Disruption Scenario Simulator
Simulates hypothetical supply disruptions (e.g., complete delivery shutdown of a supplier or port closure for 14 days):
- Computes projected factory idle hours across affected production lines.
- Quantifies total financial exposure (lost throughput $+$ customer SLA penalties).
- Lists all depleted component SKUs and threatened customer order numbers.
- Formulates an actionable contingency plan (air-freight expedite, secondary supplier activation).

---

## 6. REST API Reference

All endpoints are hosted under `/api/v1/supply-chain`:

| Group | Method | Endpoint | Description |
|---|---|---|---|
| **KPIs** | `GET` | `/kpis/summary` | Enterprise scorecard (OTD, Fill Rate, DOI, Disruption Cost) |
| **Suppliers** | `GET` | `/suppliers` | List all suppliers with risk tiers and country origin |
| | `GET` | `/suppliers/{id}` | Detailed supplier profile and contract terms |
| | `GET` | `/suppliers/risks/evaluated` | Multi-factor composite delivery risk scores |
| | `GET` | `/suppliers/concentration` | Single-source dependency analysis and concentration alerts |
| **Inventory** | `GET` | `/parts` | Component parts catalog with dual-sourcing status |
| | `GET` | `/parts/{id}` | Component details, unit costs, and safety stock |
| | `GET` | `/inventory` | Real-time stock on hand, daily consumption, and DOI |
| | `GET` | `/parts/{id}/bom-impact` | Trace part through BOM to affected assemblies and orders |
| | `GET` | `/inventory/excess` | Excess inventory analytics & tied-up working capital ($228,500) |
| **Multi-Echelon** | `GET` | `/carriers` | Logistics service providers & carrier on-time performance |
| | `GET` | `/warehouses` | Dedicated regional warehouses with utilization & holding rates |
| | `GET` | `/production-schedules`| Plant production schedules & component line starvation countdowns |
| | `GET` | `/demand-forecasts` | Probabilistic demand forecasts ($P_{10}, P_{50}, P_{90}$) with surge flags |
| | `GET` | `/alternative-contracts`| Pre-negotiated backup and dual-sourcing contracts |
| **Logistics** | `GET` | `/shipments` | In-transit shipments with milestone updates |
| | `GET` | `/shipments/delayed` | Shipments experiencing ETA drift, port holds, or customs holds |
| **Orders** | `GET` | `/orders` | Customer orders, revenue values, and delivery deadlines |
| | `GET` | `/orders/at-risk` | Customer orders exposed to component stockouts |
| **Analytics** | `GET` | `/analytics/demand-supply-mismatch` | Multi-echelon demand-supply balance evaluation |
| | `GET` | `/analytics/plant-vulnerability` | Plant operational vulnerability & line starvation rankings |
| | `POST` | `/impact/trace/{id}` | Deterministic end-to-end impact trace from disruption to SLA penalties |
| | `POST` | `/simulation/run` | Multi-vector What-If stress test (`SIMULATED_SCENARIO` provenance) |
| **Disruptions** | `GET` | `/disruptions` | Active supply chain disruptions and daily financial losses |
| | `GET` | `/mitigations` | Prescriptive mitigation recommendations ranked by ROI |
| | `POST` | `/mitigations/{id}/approve` | Approve mitigation (updates status to `APPROVED`) |
| **AI Assistant** | `POST` | `/assistant/chat` | Conversational query with multi-source grounded evidence |
| | `POST` | `/assistant/what-if` | Run What-If disruption scenario simulation |
| **Config** | `GET` | `/config` | Read active supply chain thresholds |
| | `PUT` | `/config` | Dynamically update critical days of inventory or targets |

---

## 7. Streamlit Control Tower Cockpit

Launch the interactive operations dashboard:

```bash
cd dashboard
streamlit run supply_chain_app.py --server.port 8502
```

### Dashboard Tabs:
1. **🏭 Suppliers & Delivery Risk**: Multi-tier supplier scorecard, lead-time variance vs OTD scatter plot, single-source concentration alert card.
2. **📦 Inventory, Working Capital & BOM**: Real-time stock balances, excess working capital ($228,500), annual holding costs ($50,270), demand-supply mismatch analysis ($P_{50} / P_{90}$), interactive BOM drill-down.
3. **🚢 Logistics, Carriers & Warehouses**: Logistics carrier performance (OTD, carbon rating, transit delays), regional dedicated warehouses, active in-transit shipments and port delays.
4. **⏱️ Control Tower: Starvation & E2E Tracing**: Plant operational vulnerability rankings, production line starvation countdown timers, multi-echelon end-to-end disruption tracer ($TTD = \frac{\text{Stock Available}}{\text{Daily Consumption Rate}} \times 24\,\text{h}$).
5. **🎯 Disruption & Mitigation Center**: Pre-negotiated backup contracts, active disruption mitigation cards with net benefit calculation, and 1-click executive approval workflow.
6. **🔮 Multi-Scenario What-If Simulator**: Multi-vector stress testing (Demand Surge, Corridor Chokepoint, Supplier Shutdown) with explicit `SIMULATED_SCENARIO` provenance badge.
7. **🤖 Conversational AI Assistant**: Grounded natural language Q&A with prompt-injection defense, quick operational prompts, multilingual output (English, German, Hindi), and collapsible evidence inspection.

---

## 8. Automated Testing & Verification

Run the test suite with 100% offline fallback compatibility:

```bash
# Run Supply Chain Intelligence test suite
python3 backend/tests/supply_chain_intelligence/test_supply_chain_intelligence.py

# Run cross-feature compatibility tests
PYTHONPATH=. python3 backend/tests/test_features.py
PYTHONPATH=. python3 backend/tests/test_core.py
```

### Test Coverage (13 Automated Test Suites):
- `test_prompt_injection_sanitization`: Verifies regex neutralizing instruction-override attacks.
- `test_supply_chain_kpi_calculations`: Validates mathematical consistency across all 9 KPIs.
- `test_supplier_risk_scoring_and_concentration`: Validates composite risk ranking and single-source alerts.
- `test_bom_downstream_impact_propagation`: Confirms component stockout propagates to finished products and orders.
- `test_disruption_detection_and_mitigation_workflow`: Confirms approval workflow auto-resolves disruptions.
- `test_ai_conversational_analytics_grounding`: Confirms zero-hallucination multi-source evidence.
- `test_what_if_scenario_simulation`: Validates quantitative modeling of hypothetical supplier failures.
- `test_multilingual_synthesis`: Confirms unit, currency, and tag preservation in German and Hindi.
- `test_end_to_end_impact_trace`: Verifies deterministic multi-echelon impact tracing ($TTD$, starved lines, customer SLA loss).
- `test_demand_supply_mismatches_and_excess_inventory`: Verifies deficit/surplus detection and excess working capital metrics.
- `test_plant_vulnerability_and_line_starvation`: Verifies plant operational vulnerability scoring and line starvation countdowns.
- `test_multi_vector_scenario_simulation`: Verifies What-If stress test carrying explicit `SIMULATED_SCENARIO` provenance.
- `test_carriers_and_warehouses_ontology`: Verifies carriers, warehouses, and dual-sourcing contracts integrity.

