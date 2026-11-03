"""Twin - Intelligent Manufacturing Demand Forecasting & Operations Cockpit.

Streamlit & Plotly Dashboard:
1. Executive Manufacturing Scorecard & Multi-Horizon Demand Forecasting (P10/P50/P90)
2. Demand-Driven Production Planning & Net Requirements Formula
3. Machine Line Capacity Headroom, Throughput & Bottleneck Monitoring
4. Multi-Echelon Inventory Positions & Days on Hand (DOI)
5. Equipment Assets, MTBF, MTTR & Planned Maintenance Windows
6. Quality Analytics (First-Pass Yield, Scrap Rates & Usable Output)
7. What-If Operational Scenario Simulator (Demand, Capacity, Material Shocks)
8. Batch Ingestion & Lakehouse Pipeline Monitoring
"""
import sys
from pathlib import Path

# Add project root to sys.path
_repo_root = str(Path(__file__).resolve().parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import streamlit as st
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go

from backend.features.demand_forecasting.schemas.manufacturing import (
    ModelType,
    ItemCategory,
    ScenarioSimulationRequest,
    IngestPayload,
)
from backend.features.demand_forecasting.repositories.local_manufacturing_repo import local_manufacturing_repo
from backend.features.demand_forecasting.services.forecast_service import demand_forecasting_service
from backend.features.demand_forecasting.services.production_planning_service import production_planning_service
from backend.features.demand_forecasting.services.inventory_service import inventory_optimization_service
from backend.features.demand_forecasting.services.maintenance_service import maintenance_equipment_service
from backend.features.demand_forecasting.services.quality_service import quality_analytics_service
from backend.features.demand_forecasting.services.scenario_service import what_if_scenario_engine
from backend.features.demand_forecasting.pipelines.ingestion_service import data_ingestion_service

st.set_page_config(
    page_title="Twin - Manufacturing Demand Forecasting",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Header & Status
h_col1, h_col2 = st.columns([3, 1])
with h_col1:
    st.title("📈 Demand Forecasting & Industrial Operations Cockpit")
    st.caption("AI-Powered Multi-Horizon Forecasting, Net Production Requirements, Capacity Constraints & What-If Simulation")

with h_col2:
    st.success("🟢 **DATA MODE: ENTERPRISE LIVE**\nConnected to BigQuery Lakehouse & ERP/MES Ingestion")

st.divider()

# Sidebar: Global Facility & SKU Filters
st.sidebar.header("Manufacturing Network Filters")
plant_id = st.sidebar.selectbox("Manufacturing Facility", ["PLANT_BANGALORE", "PLANT_STUTTGART", "PLANT_DETROIT"])
product_options = [p.product_id for p in local_manufacturing_repo.products.values()]
product_id = st.sidebar.selectbox("Target Finished SKU", product_options)
horizon_days = st.sidebar.selectbox("Forecast Horizon", [7, 30, 60, 90], index=1)
model_choice = st.sidebar.selectbox("Forecasting Algorithm", [ModelType.GRADIENT_BOOSTED_TREES, ModelType.ARIMA, ModelType.EXPONENTIAL_SMOOTHING, ModelType.SEASONAL_NAIVE], format_func=lambda m: m.value)

st.sidebar.divider()
st.sidebar.subheader("Lakehouse Health (Live)")
quality_rep = data_ingestion_service.get_data_quality_report()
st.sidebar.caption(f"Historical Records: **{quality_rep.total_records_ingested:,}**")
st.sidebar.caption(f"Schema Compliance: **{quality_rep.valid_records_pct:.1f}% Valid**")
st.sidebar.caption(f"Quarantined Records: **{quality_rep.quarantined_records_count}**")

# Top KPI Metric Cards
prod_obj = local_manufacturing_repo.products.get(product_id)
forecast_res = demand_forecasting_service.run_enterprise_forecast(
    product_id=product_id, plant_id=plant_id, horizon_days=horizon_days, model_type=model_choice
)
metrics = forecast_res.metrics
plan_summary = production_planning_service.generate_plan(plant_id=plant_id, horizon_days=horizon_days)

m1, m2, m3, m4, m5, m6 = st.columns(6)
m1.metric("Projected Demand", f"{forecast_res.total_forecasted_units:,.0f} units", help=f"Over next {horizon_days} days")
m2.metric("Daily Run Rate", f"{forecast_res.daily_average_demand:,.1f}/day")
m3.metric("Forecast Accuracy (WAPE)", f"{metrics.wape:.1%}", delta=f"+{metrics.wape_improvement_vs_baseline_pct:.1f}% vs Baseline", delta_color="normal")
m4.metric("Line Capacity Utilization", f"{plan_summary.capacity_utilization_pct:.1f}%")
m5.metric("Feasible Planned Output", f"{plan_summary.total_planned_production_units:,.0f} units", delta=f"{plan_summary.total_planned_production_units - forecast_res.total_forecasted_units:,.0f} Net Delta", delta_color="off")
m6.metric("Active Bottlenecks", len(plan_summary.bottlenecks), delta="Constraints Flagged", delta_color="inverse")

st.divider()

# Main Application Tabs
tab_forecast, tab_planning, tab_capacity, tab_inventory, tab_maintenance, tab_quality, tab_whatif, tab_ingest = st.tabs([
    "📈 Demand Forecasting & ML",
    "📋 Production Planning",
    "⚡ Line Capacity & Bottlenecks",
    "📦 Inventory & Stockouts",
    "🛠️ Maintenance & Assets",
    "🎯 Quality & Yield",
    "🔮 What-If Scenario Engine",
    "📥 Ingestion & Data Pipelines",
])

# ==============================================================================
# TAB 1: DEMAND FORECASTING
# ==============================================================================
with tab_forecast:
    st.subheader(f"📊 Multi-Horizon Probabilistic Demand Forecast: {product_id}")
    st.caption(f"Model: **{forecast_res.model_name}** | Horizon: **{horizon_days} Days** | Provenance: `{forecast_res.data_provenance.value}`")

    # Plot Forecast Curve with P10/P50/P90 Bands
    df_fc = pd.DataFrame([p.model_dump() for p in forecast_res.time_series_points])
    
    fig_fc = go.Figure()
    # P90 Upper Band
    fig_fc.add_trace(go.Scatter(
        x=df_fc["date"], y=df_fc["p90_units"],
        mode="lines", line=dict(width=0), showlegend=False, name="P90 (Upside)",
    ))
    # P10 Lower Band with Fill
    fig_fc.add_trace(go.Scatter(
        x=df_fc["date"], y=df_fc["p10_units"],
        mode="lines", line=dict(width=0), fill="tonexty", fillcolor="rgba(59, 130, 246, 0.15)",
        name="80% Prediction Band (P10-P90)",
    ))
    # P50 Median Point Forecast
    fig_fc.add_trace(go.Scatter(
        x=df_fc["date"], y=df_fc["p50_units"],
        mode="lines+markers", line=dict(color="#2563eb", width=2.5), name="P50 Forecast (Expected)",
    ))
    # Baseline Comparison
    fig_fc.add_trace(go.Scatter(
        x=df_fc["date"], y=df_fc["baseline_units"],
        mode="lines", line=dict(color="#94a3b8", dash="dash"), name="Seasonal-Naive Baseline (s=7)",
    ))
    fig_fc.update_layout(
        title=f"Forecast Trajectory for {prod_obj.product_name if prod_obj else product_id}",
        xaxis_title="Timeline", yaxis_title="Daily Units", hovermode="x unified",
    )
    st.plotly_chart(fig_fc, use_container_width=True)

    # Historical Accuracy Breakdown
    f_col1, f_col2 = st.columns(2)
    with f_col1:
        st.markdown("#### 🎯 Out-of-Time Cross-Validation Metrics")
        st.write(f"- **Mean Absolute Error (MAE)**: `{metrics.mae}` units")
        st.write(f"- **Root Mean Squared Error (RMSE)**: `{metrics.rmse}` units")
        st.write(f"- **Weighted Absolute % Error (WAPE)**: `{metrics.wape:.1%}`")
        st.write(f"- **Forecast Bias**: `{metrics.bias:+.2%}` (Positive = Over-predicting, Negative = Under-predicting)")
        if metrics.mape:
            st.write(f"- **Mean Absolute % Error (MAPE)**: `{metrics.mape:.1f}%`")
        st.info(f"🏆 **Baseline Benchmarking**: WAPE improved from `{metrics.baseline_wape:.1%}` (Seasonal-Naive) to `{metrics.wape:.1%}` ({forecast_res.model_name}).")

    with f_col2:
        st.markdown("#### 🏛️ Model Registry & Active Champions")
        models = demand_forecasting_service.list_registered_models()
        m_rows = []
        for m in models:
            m_rows.append({
                "Model Name": m.display_name,
                "Version": m.version,
                "Champion": "⭐ CHAMPION" if m.is_active_champion else "BASELINE",
                "WAPE": f"{m.wape:.1%}",
                "Trained Date": m.trained_on,
            })
        st.dataframe(pd.DataFrame(m_rows), use_container_width=True, hide_index=True)

# ==============================================================================
# TAB 2: PRODUCTION PLANNING
# ==============================================================================
with tab_planning:
    st.subheader(f"📋 Demand-Driven Production Plan: {plant_id}")
    st.caption("Governed Net Requirements: max(0, Forecast Demand + Safety Stock - Usable Inventory - Confirmed Supply)")

    st.markdown("#### 🏭 Generated Production Work Orders & Feasibility Analysis")
    p_rows = []
    for o in plan_summary.orders:
        p_rows.append({
            "Order ID": o.recommendation_id,
            "Product": o.product_name,
            "Target Line": o.line_id,
            "Forecast Demand": f"{o.forecast_demand_units:,.0f}",
            "Safety Stock": f"{o.target_safety_stock_units:,.0f}",
            "Usable Stock": f"{o.usable_inventory_units:,.0f}",
            "Confirmed Supply": f"{o.confirmed_incoming_supply_units:,.0f}",
            "Net Requirements": f"{o.net_requirements_units:,.0f}",
            "Feasible Output": f"{o.feasible_production_units:,.0f}",
            "Unmet Demand": f"{o.unmet_demand_units:,.0f}",
            "Constraints": "; ".join(o.infeasibility_reasons) or "None (Fully Feasible)",
        })
    st.dataframe(pd.DataFrame(p_rows), use_container_width=True, hide_index=True)

    if plan_summary.bottlenecks:
        st.error(f"🚨 **ACTIVE PRODUCTION BOTTLENECKS**: {', '.join(plan_summary.bottlenecks)}")

# ==============================================================================
# TAB 3: LINE CAPACITY & BOTTLENECK MONITORING
# ==============================================================================
with tab_capacity:
    st.subheader(f"⚡ Production Line Capacity Headroom & Bottlenecks: {plant_id}")
    st.caption("Machine operating hours vs scheduled production and planned maintenance blackouts.")

    caps = production_planning_service.get_capacity_reports(plant_id=plant_id)
    c_rows = []
    for c in caps:
        c_rows.append({
            "Line ID": c.line_id,
            "Line Name": c.line_name,
            "Total Hours": f"{c.total_capacity_hours:,.0f}h",
            "Scheduled Hours": f"{c.scheduled_production_hours:,.0f}h",
            "Maintenance Hours": f"{c.maintenance_downtime_hours:,.0f}h",
            "Available Headroom": f"{c.available_headroom_hours:,.0f}h",
            "Utilization": f"{c.utilization_pct:.1f}%",
            "Bottleneck Status": "🚨 CRITICAL BOTTLENECK" if c.is_bottleneck else "🟢 NOMINAL",
        })
    st.dataframe(pd.DataFrame(c_rows), use_container_width=True, hide_index=True)

    # Bottleneck Deep-Dive
    bottlenecks = production_planning_service.get_bottlenecks(plant_id=plant_id)
    if bottlenecks:
        st.markdown("#### 🔍 Bottleneck Deep-Dive")
        for b in bottlenecks:
            with st.container(border=True):
                st.write(f"**{b.constraint_type} on {b.line_id}** — *Severity: {b.severity}*")
                st.write(b.description)
                st.caption(f"Impacted Products: `{', '.join(b.impacted_products)}` | Overloaded Hours: **{b.hours_overloaded:.1f}h**")

# ==============================================================================
# TAB 4: INVENTORY & STOCKOUT RISKS
# ==============================================================================
with tab_inventory:
    st.subheader("📦 Multi-Echelon Inventory Positions & Days on Hand (DOI)")
    st.caption("Inventory coverage = Usable Stock / Daily Consumption Rate. Items below 3.0 days trigger reorder alerts.")

    inv_summary = inventory_optimization_service.get_inventory_summary(plant_id=plant_id)
    i_rows = []
    for pos in inv_summary.positions:
        i_rows.append({
            "Item ID": pos.part_or_sku_id,
            "Item Name": pos.item_name,
            "Category": pos.category.value,
            "Usable Stock": f"{pos.stock_usable:,}",
            "Daily Burn": f"{pos.daily_consumption_rate:.1f}/d",
            "Days on Hand (DOI)": f"{pos.days_on_hand:.1f} days",
            "Safety Stock": f"{pos.safety_stock_units:,}",
            "Reorder Point": f"{pos.reorder_point_units:,}",
            "Stockout Status": "🚨 CRITICAL STOCKOUT RISK" if pos.potential_stockout_risk else "🟢 SAFE",
        })
    st.dataframe(pd.DataFrame(i_rows), use_container_width=True, hide_index=True)

    # Replenishment Recommendations
    st.divider()
    st.markdown("#### 🛒 Suggested Replenishment Recommendations")
    recs = inventory_optimization_service.get_replenishment_recommendations(plant_id=plant_id)
    r_rows = []
    for r in recs:
        r_rows.append({
            "Rec ID": r.recommendation_id,
            "Item": f"{r.item_name} ({r.item_id})",
            "Urgency": r.urgency,
            "Usable Stock": r.current_usable_stock,
            "ROP": r.reorder_point,
            "Suggested Order Qty": f"{r.suggested_order_quantity:,}",
            "Supplier": r.supplier_id,
            "Lead Time": f"{r.supplier_lead_time_days} days",
            "Est. Cost": f"${r.estimated_cost_usd:,.2f}",
        })
    st.dataframe(pd.DataFrame(r_rows), use_container_width=True, hide_index=True)

# ==============================================================================
# TAB 5: MAINTENANCE & EQUIPMENT ASSETS
# ==============================================================================
with tab_maintenance:
    st.subheader("🛠️ Equipment Reliability & Maintenance Windows")
    st.caption("Asset availability, MTBF, MTTR, and scheduled downtime windows integrated into production feasibility.")

    assets = maintenance_equipment_service.get_asset_reports(plant_id=plant_id)
    a_rows = []
    for a in assets:
        a_rows.append({
            "Asset ID": a.asset_id,
            "Asset Name": a.asset_name,
            "Line": a.line_id,
            "Availability": f"{a.availability_pct:.1f}%",
            "MTBF": f"{a.mtbf_hours:.0f}h",
            "MTTR": f"{a.mttr_hours:.1f}h",
            "Planned Downtime (14d)": f"{a.planned_downtime_hours_next_14d:.1f}h",
            "Health Status": a.health_status,
        })
    st.dataframe(pd.DataFrame(a_rows), use_container_width=True, hide_index=True)

    st.markdown("#### 📋 Historical Downtime Event Log")
    downtimes = maintenance_equipment_service.get_downtime_history(plant_id=plant_id)
    dt_rows = []
    for d in downtimes:
        dt_rows.append({
            "Event ID": d.event_id,
            "Asset": d.asset_id,
            "Duration": f"{d.duration_hours:.1f}h",
            "Reason": d.reason,
            "Hours Lost": f"{d.production_hours_lost:.1f}h",
            "Resolved": "YES" if d.resolved else "NO",
        })
    st.dataframe(pd.DataFrame(dt_rows), use_container_width=True, hide_index=True)

# ==============================================================================
# TAB 6: QUALITY ANALYTICS
# ==============================================================================
with tab_quality:
    st.subheader("🎯 Quality Analytics, First-Pass Yield & Scrap Tracking")
    st.caption("Quality scrap rates feed directly into production planning so scheduled output reflects usable products.")

    q_metrics = quality_analytics_service.get_quality_metrics(plant_id=plant_id)
    qc1, qc2, qc3, qc4 = st.columns(4)
    qc1.metric("First-Pass Yield (FPY)", f"{q_metrics.first_pass_yield_pct:.1f}%")
    qc2.metric("Defect Rate", f"{q_metrics.defect_rate_pct:.1f}%")
    qc3.metric("Scrap Rate", f"{q_metrics.scrap_rate_pct:.1f}%")
    qc4.metric("DPMO", f"{q_metrics.dpmo:,.0f}", help="Defects Per Million Opportunities")

    st.markdown("#### 📈 Weekly First-Pass Yield & Scrap Trends")
    q_trends = quality_analytics_service.get_quality_trends(plant_id=plant_id)
    df_qt = pd.DataFrame([t.model_dump() for t in q_trends])
    fig_q = px.line(df_qt, x="date", y=["fpy_pct", "scrap_rate_pct"], title="FPY vs Scrap Rate Trend", markers=True)
    st.plotly_chart(fig_q, use_container_width=True)

# ==============================================================================
# TAB 7: WHAT-IF SCENARIO ENGINE
# ==============================================================================
with tab_whatif:
    st.subheader("🔮 What-If Scenario Stress Testing Engine")
    st.caption("Recalculate constraints, capacity shortfalls, and financial impacts under simulated shocks. Explicit SIMULATED provenance.")

    w_col1, w_col2, w_col3 = st.columns(3)
    with w_col1:
        scen_name = st.text_input("Scenario Name", value="Q4 Demand Surge (+30%) & Component Allocation")
        sim_growth = st.slider("Demand Growth Delta (%)", -50, 100, 30, step=5)
    with w_col2:
        sim_mat = st.slider("Raw Material Availability (%)", 20, 100, 85, step=5)
        sim_extra_dt = st.slider("Extra Equipment Downtime (Hours)", 0, 80, 16, step=4)
    with w_col3:
        sim_scrap_delta = st.slider("Scrap Rate Delta (%)", -1.0, 5.0, 1.5, step=0.5)
        run_sim = st.button("Execute Scenario Simulation ⚡", use_container_width=True)

    if run_sim:
        sim_req = ScenarioSimulationRequest(
            scenario_name=scen_name,
            plant_id=plant_id,
            demand_growth_pct=sim_growth,
            raw_material_availability_pct=sim_mat,
            equipment_downtime_hours_extra=sim_extra_dt,
            scrap_rate_delta_pct=sim_scrap_delta,
        )
        sim_res = what_if_scenario_engine.simulate(sim_req)
        with st.container(border=True):
            st.markdown(f"### 🧪 Simulation Outcome: {sim_res.scenario_name}")
            st.info(f"🏷️ **DATA PROVENANCE**: `{sim_res.data_provenance.value}` (Strictly synthetic simulation — no production orders created)")

            s1, s2, s3, s4 = st.columns(4)
            s1.metric("Simulated Demand", f"{sim_res.simulated_forecast_units:,.0f} units", delta=f"{sim_res.forecast_delta_units:+,.0f} vs Base")
            s2.metric("Capacity Utilization", f"{sim_res.simulated_capacity_utilization_pct:.1f}%", delta=f"{sim_res.simulated_capacity_utilization_pct - sim_res.baseline_capacity_utilization_pct:+.1f}%")
            s3.metric("Capacity Shortfall", f"{sim_res.capacity_shortfall_hours:.1f} Hours", delta_color="inverse")
            s4.metric("Net Financial Impact", f"${sim_res.net_financial_impact_usd:+,.2f} USD", delta_color="normal" if sim_res.net_financial_impact_usd >= 0 else "inverse")

            st.write(f"**Identified Bottlenecks**: `{', '.join(sim_res.bottlenecks_identified)}`")
            st.write(f"**Key Assumptions**: `{', '.join(sim_res.key_assumptions)}`")
            st.write(f"**Constraint Explanations**: `{', '.join(sim_res.constraint_explanations)}`")

# ==============================================================================
# TAB 8: INGESTION & PIPELINES
# ==============================================================================
with tab_ingest:
    st.subheader("📥 Data Ingestion, Schema Validation & Quarantines")
    st.caption("Upload raw CSV or JSON manufacturing records for schema compliance, deduplication, and BigQuery loading.")

    dq = data_ingestion_service.get_data_quality_report()
    dq1, dq2, dq3 = st.columns(3)
    dq1.metric("Total Ingested Records", f"{dq.total_records_ingested:,}")
    dq2.metric("Valid Records Percentage", f"{dq.valid_records_pct:.1f}%")
    dq3.metric("Quarantined Records", dq.quarantined_records_count)

    # Ingestion Form
    with st.form("ingest_form"):
        st.markdown("#### 📤 Test Ingestion Endpoint (`POST /api/v1/data/ingest`)")
        test_sku = st.text_input("Product SKU", value="PRD-CNC-5X")
        test_units = st.number_input("Demand Units", value=24.5)
        test_date = st.date_input("Record Date")
        ingest_btn = st.form_submit_button("Ingest Record 🚀")

    if ingest_btn:
        payload = IngestPayload(
            batch_source="MANUAL_UI_INPUT",
            records_count=1,
            records=[{"product_id": test_sku, "actual_units": test_units, "date": test_date.isoformat(), "plant_id": plant_id}],
        )
        status_res = data_ingestion_service.ingest_records(payload)
        st.success(f"Batch {status_res.batch_id} ingested: {status_res.records_validated} validated, {status_res.duplicate_records_skipped} duplicates skipped, {status_res.records_quarantined} quarantined.")
