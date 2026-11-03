# Manufacturing Demand Forecasting & Intelligent Operations Platform

An enterprise-grade, constraint-aware manufacturing demand forecasting and operational planning platform built with **FastAPI**, scikit-learn forecasting, an optional **BigQuery** lakehouse and **Streamlit**, with **Meta's Muse Wonder** writing grounded S&OP planning briefs (`GET /api/v1/production/brief`).

![Demand forecasting architecture](../../../docs/architecture/demand-forecasting.png)

---

## 1. Executive Summary & Capabilities

The **Manufacturing Demand Forecasting Platform** connects demand sensing with shop-floor operational realities. Rather than generating unconstrained time-series forecasts in a silo, the platform unifies:
1. **Machine Learning Demand Forecasting**: Multi-horizon probabilistic forecasting ($P_{10}, P_{50}, P_{90}$) evaluating Gradient Boosted Trees (GBDT) and Exponential Smoothing against a strict Seasonal-Naive ($s=7$) baseline using out-of-time chronological validation.
2. **Constraint-Aware Production Planning**: Translates forecast demand into feasible shop-floor work orders governed by machine cycle times, line capacity ceilings, raw material availability, scrap rate allowances, and scheduled maintenance blackout windows.
3. **Multi-Echelon Inventory Optimization**: Tracks stock positions across Raw Materials, WIP, Finished Goods, and MRO Spares; computes Days of Inventory (DOI) and generates dynamic Reorder Point (ROP) replenishment recommendations.
4. **Maintenance & Equipment Reliability**: Monitors asset operational status, historical MTBF and MTTR, and calculates capacity-at-risk from planned maintenance windows.
5. **Quality Engineering Analytics**: Connects First-Pass Yield (FPY), DPMO, and scrap rates directly into production planning to ensure net output meets customer delivery commitments.
6. **What-If Scenario Simulation Engine**: Simulates demand shocks (+25% surge), supply chain lead-time expansions, equipment breakdowns, and scrap spikes with strict data provenance auditing (`SIMULATED` vs `ACTUAL`).
7. **Enterprise Ingestion Pipeline**: Ingests, schema-validates, deduplicates, and quarantines batch extracts from ERP (SAP S/4HANA), MES, and SCADA systems.

---

## 2. Mathematical Formulations & Planning Logic

### A. Net Requirements Calculation
Production planning computes net requirements for each product $i$ over horizon $H$:
$$\text{Net requirements}_i = \max(0, \text{forecast demand}_i + \text{safety stock}_i - \text{usable inventory}_i - \text{confirmed supply}_i)$$

To account for scrap generated during manufacturing, the planned production volume is adjusted by the historical First Pass Yield (FPY) or scrap rate:
$$\text{Planned production}_i = \frac{\text{Net requirements}_i}{1 - \text{scrap rate}_i}$$

### B. Machine Capacity & Downtime Deduction
For production line $L$ over horizon $H$:
$$\text{Effective machine capacity}_L = (\text{daily capacity hours}_L \times H) - \text{scheduled maintenance downtime hours}_L$$

Feasible production is constrained by line hours and raw material availability:
$$\text{Max units by capacity}_L = \frac{\text{Effective machine capacity}_L \times \text{usable yield rate}_i}{\text{cycle time per unit}_i}$$
$$\text{Feasible production}_i = \min(\text{Planned production}_i, \text{Max units by capacity}_L, \text{Material limit}_i)$$
$$\text{Unmet demand}_i = \max(0, \text{Net requirements}_i - \text{Feasible production}_i)$$

### C. Out-of-Time Chronological Validation Metrics
To guarantee zero future data leakage, models are evaluated on out-of-time chronological holdout windows:
- **Mean Absolute Error (MAE)**:
  $$\text{MAE} = \frac{1}{n} \sum_{t=1}^n |y_t - \hat{y}_t|$$
- **Root Mean Squared Error (RMSE)**:
  $$\text{RMSE} = \sqrt{\frac{1}{n} \sum_{t=1}^n (y_t - \hat{y}_t)^2}$$
- **Weighted Absolute Percentage Error (WAPE)**:
  $$\text{WAPE} = \frac{\sum_{t=1}^n |y_t - \hat{y}_t|}{\sum_{t=1}^n y_t}$$
- **Forecast Bias**:
  $$\text{Bias} = \frac{\sum_{t=1}^n (\hat{y}_t - y_t)}{\sum_{t=1}^n y_t}$$
- **Mean Absolute Percentage Error (MAPE)**:
  $$\text{MAPE} = \frac{100\%}{n} \sum_{t=1}^n \left| \frac{y_t - \hat{y}_t}{y_t} \right| \quad (\text{for } y_t > 0)$$

### D. Inventory Health & Replenishment
$$\text{Days of Inventory (DOI)} = \frac{\text{Usable stock on hand}}{\text{Daily consumption run rate}}$$
$$\text{Reorder Point (ROP)} = (\text{Supplier lead time days} \times \text{Daily demand}) + \text{Safety stock}$$
When $\text{Stock on hand} \le \text{ROP}$, a replenishment order is triggered for:
$$\text{Suggested order quantity} = (\text{Target safety stock} \times 1.5) + (\text{ROP} - \text{Stock on hand})$$

---

## 3. Technology Stack & GCP Architecture

| Layer | Technology | Purpose |
|---|---|---|
| **API Backend** | Python 3.12+, FastAPI, Pydantic | REST APIs, business validation, planning engine |
| **Data Lakehouse** | Google Cloud BigQuery | Partitioned/clustered tables for demand, orders, capacity, inventory, and quality |
| **Raw Storage** | Google Cloud Storage (GCS) | Staging bucket for incoming CSV/JSON batch files and quarantine dumps |
| **Streaming / Triggers**| Google Cloud Pub/Sub | Real-time event notifications and pipeline triggers |
| **Machine Learning** | Scikit-Learn (in the backend container) | Champion GBDT with lag/calendar features vs Seasonal-Naive baseline |
| **AI briefing** | Meta Model API · Muse Wonder (`muse-wonder-1.0`) | S&OP brief from the plan, bottlenecks, stock-out risks and replenishment; grounding-checked, deterministic fallback |
| **Deployment** | Google Cloud Run | Serverless autoscaling containerized backend |
| **IaC** | Terraform (`infra/terraform/demand_forecasting.tf`)| Automated provisioning of BigQuery, GCS, Pub/Sub, Cloud Run, and Cloud Scheduler |
| **Operations Cockpit** | Streamlit (`dashboard/demand_forecasting_app.py`)| Interactive 8-tab manufacturing operations dashboard |

---

## 4. REST API Reference

The router is mounted at `/api/v1/demand-forecasting` in [`backend/main.py`](file:///Volumes/DiskD/HACKATHONS/Twin/backend/main.py).

### Demand & Forecasting Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/forecast/historical` | Query historical daily demand time-series with date and plant filters |
| `POST` | `/forecast/generate` | Run multi-horizon forecast ($P_{10}/P_{50}/P_{90}$) with selected ML model |
| `GET` | `/forecast/latest` | Retrieve active forecasts across monitored product SKUs |
| `GET` | `/forecast/models` | List model registry champions, versions, and validation metrics |
| `GET` | `/forecast/evaluation` | Get out-of-time cross-validation metrics (MAE, RMSE, WAPE, Bias, MAPE) |

### Production Planning & Operations Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/planning/generate` | Generate constraint-aware production plan with net requirements |
| `GET` | `/planning/capacity` | Get line utilization, scheduled hours, headroom, and bottleneck flags |
| `GET` | `/planning/bottlenecks`| List active shop-floor capacity, material, or quality bottlenecks |

### Inventory, Maintenance & Quality Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/inventory/summary` | Multi-echelon stock levels (Raw, WIP, FG, Spare) and Days on Hand (DOI) |
| `GET` | `/inventory/replenishment`| Dynamic purchase and work order replenishment recommendations |
| `GET` | `/maintenance/assets` | Equipment operational status, MTBF, MTTR, and health states |
| `GET` | `/maintenance/downtime` | Historical downtime event logs and root causes |
| `GET` | `/maintenance/risks` | Capacity-at-risk analysis from scheduled maintenance windows |
| `GET` | `/quality/metrics` | First-Pass Yield (FPY), defect rate, scrap rate, and DPMO |
| `GET` | `/quality/trends` | Historical daily FPY and scrap rate trend trajectories |

### Simulation & Ingestion Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/scenarios/simulate` | Execute What-If simulation with strict `SIMULATED` provenance |
| `GET` | `/scenarios/history` | List previously executed scenario simulation runs |
| `POST` | `/ingestion/batch` | Batch ingest ERP/MES records with schema validation and quarantine |
| `GET` | `/ingestion/status` | Ingestion pipeline run statuses and data quality health report |

---

## 5. Local Mode vs Cloud Deployment

### Local Development Mode (Zero Cloud Credentials Required)
The platform includes an in-memory repository initialized with **24 months of synthetic manufacturing history** across multiple plants and industrial products:
```bash
# Set PYTHONPATH
export PYTHONPATH=.

# Run FastAPI backend locally
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# In another terminal, launch the Streamlit Operations Cockpit
streamlit run dashboard/demand_forecasting_app.py --server.port 8501
```

### Google Cloud Platform Deployment
1. **Deploy Infrastructure with Terraform**:
   ```bash
   cd infra/terraform
   terraform init
   terraform apply -target=module.demand_forecasting
   ```
2. **Build and Deploy Container to Cloud Run**:
   ```bash
   gcloud builds submit --tag gcr.io/$PROJECT_ID/manufacturing-backend:latest
   gcloud run deploy manufacturing-backend \
     --image gcr.io/$PROJECT_ID/manufacturing-backend:latest \
     --platform managed \
     --region us-central1 \
     --set-env-vars GCP_PROJECT_ID=$PROJECT_ID,BIGQUERY_DATASET=manufacturing_lakehouse
   ```

---

## 6. Verification & Automated Testing

A comprehensive automated test suite covers all domain services, algorithmic calculations, and backward compatibility:

```bash
PYTHONPATH=. python3 backend/tests/demand_forecasting/test_demand_forecasting.py
```

### Test Coverage Highlights:
- ✅ Master Data & 24-Month Demand History Lakehouse Repo Initialization
- ✅ ML Time-Series Forecasting Engine & Out-of-Time Metrics (MAE, RMSE, WAPE, Bias, MAPE)
- ✅ Prediction Uncertainty Intervals ($P_{10} \le P_{50} \le P_{90}$)
- ✅ Net Requirements Calculation: $\max(0, \text{Demand} + \text{SafetyStock} - \text{UsableStock} - \text{ConfirmedSupply})$
- ✅ Scrap Rate Adjustment & Scheduled Maintenance Downtime Deductions
- ✅ Inventory Days of Inventory (DOI), Safety Stock & Dynamic Replenishment Alerts
- ✅ Equipment Reliability (MTBF, MTTR, Availability & Capacity-at-Risk)
- ✅ Quality Analytics (First Pass Yield, Scrap Rate, DPMO) & Usable Output Feeding Planning
- ✅ What-If Operational Simulation & Strict `SIMULATED` Provenance Tagging
- ✅ Ingestion Pipeline Batch Schema Validation, Deduplication & Quarantine
- ✅ Backward Compatibility with Legacy Ports (`forecast_product_demand`, `check_capacity_headroom`)
