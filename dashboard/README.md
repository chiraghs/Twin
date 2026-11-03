# Twin Operations Cockpit Dashboards

Interactive Streamlit & Plotly dashboards providing real-time visibility, predictive analytics, and conversational intelligence.

## 1. Predictive Maintenance Cockpit (`app.py`)
- Real-time asset vibration & temperature tracking (ISO 10816-3 zones)
- CARI-ranked maintenance advisories with 1-click human approval
- Auditable financial ROI waterfall and `fact_roi_ledger`
- OT/IT source connectivity with data provenance badges
- Maintenance Copilot (Muse Spark) with multi-source grounding & technician feedback loop

```bash
cd dashboard
streamlit run app.py --server.port 8501
```

## 2. Supply Chain Intelligence Cockpit (`supply_chain_app.py`)
- Multi-tier supplier delivery risk scorecards & lead-time variability
- Bill-of-Materials (BOM) downstream plant propagation & line stoppages
- In-transit logistics tracking with port congestion & customs hold alerts
- Disruption & Mitigation Action Center with 1-click approval
- Conversational AI Supply Chain Assistant & What-If Disruption Scenario Simulator

```bash
cd dashboard
streamlit run supply_chain_app.py --server.port 8502
```
