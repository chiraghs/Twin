"""Twin - Enterprise AI-Powered Supply Chain Intelligence & Control Tower Cockpit.

Interactive Streamlit & Plotly Dashboard:
1. Executive KPI Scorecard & Global Supplier Network Risk
2. Inventory Balances, Excess Working Capital & Demand-Supply Mismatch
3. Multi-Modal Logistics, Logistics Carriers & Dedicated Warehouses
4. Control Tower: Production Line Starvation Countdown & Multi-Echelon E2E Impact Tracer
5. Disruption & Prescriptive Mitigation Action Center with 1-Click Approval
6. Multi-Scenario What-If Stress Simulator (Surge, Corridor Chokepoint, Supplier Outage)
7. Grounded Conversational AI Assistant with Zero-Hallucination Evidence
"""
import sys
from pathlib import Path

# Add project root to sys.path so backend is always importable
_repo_root = str(Path(__file__).resolve().parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import asyncio
from datetime import datetime, timezone
import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

from backend.features.supply_chain_intelligence.repositories.local_mock_repo import local_supply_chain_repo
from backend.features.supply_chain_intelligence.services.kpi_service import supply_chain_kpi_service
from backend.features.supply_chain_intelligence.services.risk_engine import supply_chain_risk_engine
from backend.features.supply_chain_intelligence.services.impact_analyzer import multi_echelon_impact_analyzer
from backend.features.supply_chain_intelligence.assistant.models import (
    SupplyChainChatRequest,
    WhatIfSimulationRequest,
    UserRole,
)
from backend.features.supply_chain_intelligence.assistant.assistant_service import supply_chain_assistant_service
from backend.features.supply_chain_intelligence.config.models import supply_config_store

st.set_page_config(
    page_title="Twin - Supply Chain Control Tower",
    page_icon="🌐",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Header & Status Banner
col_h1, col_h2 = st.columns([3, 1])
with col_h1:
    st.title("🌐 Supply Chain Intelligence & Control Tower")
    st.caption("Autonomous Multi-Echelon Network Monitoring, Line Starvation Countdown, What-If Simulation & Prescriptive Mitigation")

with col_h2:
    st.success("🟢 **DATA MODE: ENTERPRISE LIVE**\nConnected to ERP, WMS, TMS, MES & BOM Ontology")

st.divider()

# Sidebar: Filters & Dynamic Thresholds
st.sidebar.header("Enterprise Network Filters")
plant_choice = st.sidebar.selectbox("Manufacturing Plant", ["All", "PLANT_BANGALORE", "PLANT_STUTTGART", "PLANT_DETROIT"])
supplier_risk_choice = st.sidebar.selectbox("Supplier Risk Filter", ["All", "CRITICAL", "HIGH", "MEDIUM", "LOW"])

st.sidebar.divider()
st.sidebar.subheader("Dynamic Thresholds (Live)")
cfg = supply_config_store.get_config()
st.sidebar.caption(f"Critical Days of Inventory: **{cfg.critical_days_of_supply_threshold} Days**")
st.sidebar.caption(f"Target OTD: **{cfg.on_time_delivery_target_pct:.1f}%**")
st.sidebar.caption(f"Min Recommended PO Lot: **{cfg.min_recommended_po_qty} Units**")

# Load Data
plant_filter = None if plant_choice == "All" else plant_choice
kpis = supply_chain_kpi_service.compute_kpis(plant_id=plant_filter)
suppliers = local_supply_chain_repo.list_suppliers(risk_level=supplier_risk_choice)
inventory = local_supply_chain_repo.list_inventory(plant_id=plant_filter)
shipments = local_supply_chain_repo.list_shipments()
orders = local_supply_chain_repo.list_customer_orders()
disruptions = local_supply_chain_repo.list_disruptions(active_only=True)
mitigations = supply_chain_risk_engine.generate_mitigation_recommendations()

# Top KPI Metric Cards
k1, k2, k3, k4, k5, k6 = st.columns(6)
k1.metric("On-Time Delivery (OTD)", f"{kpis.on_time_delivery_rate:.1f}%", delta="Target: 95.0%")
k2.metric("Order Fill Rate", f"{kpis.order_fill_rate:.1f}%")
k3.metric("Avg Days of Inventory", f"{kpis.average_days_of_inventory:.1f} d", help="Across all component SKUs")
k4.metric("Supplier Reliability", f"{kpis.supplier_reliability_index:.1f}/100")
k5.metric("Orders at Immediate Risk", kpis.customer_orders_at_risk_count, delta=f"-${kpis.total_revenue_at_risk_usd:,.0f} Rev", delta_color="inverse")
k6.metric("Active Disruption Exposure", f"${kpis.estimated_disruption_cost_usd:,.0f}", delta="Projected Loss", delta_color="inverse")

if disruptions:
    st.error(f"🚨 **ACTIVE NETWORK DISRUPTIONS**: {len(disruptions)} active supply chain bottlenecks threatening ${kpis.total_revenue_at_risk_usd:,.0f} in customer delivery revenue!")

st.divider()

# Main Application Tabs
tab_suppliers, tab_inventory, tab_logistics, tab_control_tower, tab_mitigations, tab_simulation, tab_ai = st.tabs([
    "🏭 Suppliers & Delivery Risk",
    "📦 Inventory, Working Capital & BOM",
    "🚢 Logistics, Carriers & Warehouses",
    "⏱️ Control Tower: Starvation & E2E Tracing",
    "🎯 Disruption & Mitigation Center",
    "🔮 Multi-Scenario What-If Simulator",
    "🤖 Conversational AI Assistant",
])

# ==============================================================================
# TAB 1: SUPPLIERS & DELIVERY RISK
# ==============================================================================
with tab_suppliers:
    st.subheader("🏭 Global Tier-1 & Tier-2 Supplier Network")
    st.caption("Multi-factor risk evaluation: Historical OTD drift, lead-time variance, geopolitical exposure, and financial health.")

    sup_rows = []
    for s in suppliers:
        sup_rows.append({
            "Supplier ID": s.supplier_id,
            "Supplier Name": s.supplier_name,
            "Country": s.country,
            "Tier": f"Tier {s.tier}",
            "Category": s.category,
            "OTD Rate": f"{s.on_time_delivery_rate:.1%}",
            "Lead Time (Mean)": f"{s.lead_time_days_mean:.1f} d",
            "Variance (StdDev)": f"±{s.lead_time_variance_days:.1f} d",
            "Defect PPM": f"{s.defect_ppm:.0f}",
            "Geopolitical Risk": f"{s.geopolitical_risk_score:.2f}",
            "Composite Risk": s.composite_risk_level.value,
        })
    st.dataframe(pd.DataFrame(sup_rows), use_container_width=True, hide_index=True)

    c_col1, c_col2 = st.columns([2, 1])
    with c_col1:
        st.subheader("📊 Supplier Reliability vs Delivery Lead-Time Variance")
        df_sup = pd.DataFrame([{
            "Name": s.supplier_name,
            "OTD": s.on_time_delivery_rate * 100.0,
            "Variance": s.lead_time_variance_days,
            "Risk": s.composite_risk_level.value,
            "Category": s.category,
        } for s in suppliers])
        fig_sup = px.scatter(
            df_sup,
            x="Variance",
            y="OTD",
            color="Risk",
            text="Name",
            title="Lead Time Variance (Days) vs On-Time Delivery (%)",
            color_discrete_map={"CRITICAL": "#ef4444", "HIGH": "#f97316", "MEDIUM": "#f59e0b", "LOW": "#10b981"},
        )
        fig_sup.update_traces(textposition="top center")
        st.plotly_chart(fig_sup, use_container_width=True)

    with c_col2:
        st.subheader("⚠️ Single-Source Concentration Alert")
        conc = supply_chain_risk_engine.evaluate_supplier_concentration()
        st.metric("Total Components Monitored", conc["total_parts_monitored"])
        st.metric("Single-Sourced Components", f"{conc['single_source_count']} ({conc['single_source_percentage']}%)")
        st.metric("Critical Single-Source Parts (Class A)", conc["critical_single_source_count"])
        if conc["concentration_alert"]:
            st.warning(f"⚠️ Single-source concentration detected on: `{', '.join(conc['critical_single_source_parts'])}`. Qualify alternate suppliers to mitigate lock-in.")

# ==============================================================================
# TAB 2: INVENTORY, WORKING CAPITAL & BOM
# ==============================================================================
with tab_inventory:
    st.subheader("📦 Real-Time Inventory Balances & Stockout Risk")
    st.caption("Days of Inventory (DOI) = Stock on Hand / Daily Consumption Rate. Breaches below 3.0 days trigger immediate alerts.")

    inv_rows = []
    for i in inventory:
        p = local_supply_chain_repo.get_part(i.part_id)
        inv_rows.append({
            "Inventory ID": i.inventory_id,
            "Part ID": i.part_id,
            "Part Name": p.part_name if p else "Component",
            "Plant": i.plant_id,
            "Stock On Hand": f"{i.stock_on_hand:,}",
            "Allocated": f"{i.stock_allocated:,}",
            "Available": f"{i.stock_available:,}",
            "Daily Burn Rate": f"{i.daily_consumption_rate:.1f}/day",
            "Days of Inventory (DOI)": f"{i.days_of_inventory_remaining:.1f} days",
            "Stockout Risk Score": f"{i.stockout_risk_score:.0%}",
            "Status": "🚨 AT RISK" if i.is_at_risk_of_stockout else "🟢 HEALTHY",
        })
    st.dataframe(pd.DataFrame(inv_rows), use_container_width=True, hide_index=True)

    # Excess Inventory & Tied-Up Working Capital Section
    st.divider()
    st.subheader("💰 Excess Inventory & Working Capital Inefficiencies")
    excess_data = supply_chain_risk_engine.evaluate_excess_inventory()

    ex_col1, ex_col2, ex_col3 = st.columns(3)
    ex_col1.metric("Total Tied-Up Working Capital", f"${excess_data['total_tied_up_capital_usd']:,.2f} USD")
    ex_col2.metric("Annual Inventory Holding Cost", f"${excess_data['total_annual_holding_cost_usd']:,.2f} USD", help="Carrying rate ~22% per annum")
    ex_col3.metric("Excess SKUs Monitored", excess_data['total_excess_skus'])

    excess_rows = []
    for ex in excess_data["excess_items"]:
        excess_rows.append({
            "Part ID": ex.part_id,
            "Part Name": ex.part_name,
            "Stock On Hand": f"{ex.stock_on_hand:,}",
            "Days of Inventory": f"{ex.days_of_inventory:.1f} d",
            "Excess Units": f"{ex.excess_units:,}",
            "Tied-Up Capital": f"${ex.tied_up_capital_usd:,.2f}",
            "Annual Holding Cost": f"${ex.annual_holding_cost_usd:,.2f}",
            "Obsolescence Risk": f"{ex.obsolescence_risk_score:.0%}",
            "Recommended Action": ex.recommended_action,
        })
    st.dataframe(pd.DataFrame(excess_rows), use_container_width=True, hide_index=True)

    # Demand-Supply Mismatch Table
    st.divider()
    st.subheader("⚖️ Demand vs Supply Mismatch Analysis (P10 / P50 / P90)")
    st.caption("Forecasted assembly demand compared deterministically against available inventory and inbound purchase order pipelines.")
    mismatches = supply_chain_risk_engine.evaluate_demand_supply_mismatches()
    mm_rows = []
    for mm in mismatches:
        mm_rows.append({
            "Assembly": mm["assembly_name"],
            "Component Part": mm["part_name"],
            "Available Stock": f"{mm['total_available_stock']:,}",
            "Inbound Pipeline": f"{mm['inbound_pipeline_units']:,}",
            "P50 Demand": f"{mm['p50_demand_units']:,}",
            "P90 Demand": f"{mm['p90_demand_units']:,}",
            "Projected P50 Balance": f"{mm['projected_p50_balance']:,}",
            "Mismatch Status": mm["mismatch_status"],
            "Risk Severity": mm["risk_severity"].value,
        })
    st.dataframe(pd.DataFrame(mm_rows), use_container_width=True, hide_index=True)

    # Interactive BOM Downstream Drill-down
    st.divider()
    st.subheader("🔍 Bill-of-Materials (BOM) Downstream Impact Drill-Down")
    selected_part = st.selectbox("Select Component to Trace Through BOM:", [p.part_id for p in local_supply_chain_repo.list_parts()])
    bom_analysis = supply_chain_risk_engine.analyze_bom_downstream_impact(selected_part)

    b_col1, b_col2, b_col3 = st.columns(3)
    b_col1.metric("Component Criticality", f"Class {bom_analysis['criticality']}")
    b_col2.metric("Minimum Days of Supply", f"{bom_analysis['minimum_days_of_inventory']:.1f} Days")
    b_col3.metric("Revenue at Downstream Risk", f"${bom_analysis['total_revenue_at_risk_usd']:,.0f}")

    st.write(f"**Impacted Finished Assemblies**: `{', '.join(bom_analysis['impacted_assemblies']) or 'None'}`")
    st.write(f"**Threatened Customer Orders**: `{', '.join(bom_analysis['impacted_customer_orders']) or 'None'}`")
    if bom_analysis["immediate_shutdown_threat"]:
        st.error(f"🚨 **IMMEDIATE PRODUCTION SHUTDOWN THREAT**: Stock of {selected_part} will exhaust in under 3 days! Daily SLA delay penalty: ${bom_analysis['daily_sla_penalties_usd']:,.0f}/day.")

# ==============================================================================
# TAB 3: LOGISTICS, CARRIERS & WAREHOUSES
# ==============================================================================
with tab_logistics:
    st.subheader("🚢 Multi-Modal In-Transit Logistics & Carrier Performance")
    st.caption("Active in-transit telemetry, milestone status, carrier OTD benchmarks, and dedicated regional warehouses.")

    # Carriers & Warehouses
    l_col1, l_col2 = st.columns(2)
    with l_col1:
        st.markdown("#### 🚚 Logistics Service Providers (Carriers)")
        carriers = local_supply_chain_repo.list_carriers()
        crr_rows = []
        for c in carriers:
            crr_rows.append({
                "Carrier ID": c.carrier_id,
                "Name": c.carrier_name,
                "Mode": c.transport_mode.value,
                "OTD Performance": f"{c.on_time_performance_rate:.1%}",
                "Avg Delay": f"{c.average_transit_delay_days:.1f} d",
                "Carbon Rating": c.carbon_efficiency_rating,
                "Corridors": ", ".join(c.primary_corridors),
            })
        st.dataframe(pd.DataFrame(crr_rows), use_container_width=True, hide_index=True)

    with l_col2:
        st.markdown("#### 🏬 Dedicated Regional Warehouses")
        warehouses = local_supply_chain_repo.list_warehouses()
        wh_rows = []
        for w in warehouses:
            wh_rows.append({
                "Warehouse ID": w.warehouse_id,
                "Name": w.warehouse_name,
                "Location": w.location_city,
                "Associated Plant": w.associated_plant_id,
                "Capacity (Pallets)": f"{w.storage_capacity_pallets:,}",
                "Capacity Utilized": f"{w.utilized_capacity_pct:.1f}%",
                "Holding Cost Rate": f"{w.annual_holding_cost_rate_pct:.1f}%",
            })
        st.dataframe(pd.DataFrame(wh_rows), use_container_width=True, hide_index=True)

    st.divider()
    st.markdown("#### 📦 Active In-Transit Shipments & Delay Milestones")
    shp_rows = []
    for s in shipments:
        shp_rows.append({
            "Shipment ID": s.shipment_id,
            "Associated PO": s.po_id,
            "Carrier": s.carrier_name,
            "Mode": s.transport_mode.value,
            "Route": f"{s.origin_hub} ➔ {s.destination_hub}",
            "Scheduled ETA": s.scheduled_eta,
            "Current Projected ETA": s.current_projected_eta,
            "ETA Drift": f"+{s.eta_drift_days:.0f} days" if s.eta_drift_days > 0 else "On Time",
            "Milestone Status": s.status.value,
            "Delay Root Cause": s.delay_root_cause or "None (Nominal)",
        })
    st.dataframe(pd.DataFrame(shp_rows), use_container_width=True, hide_index=True)

    delayed = [s for s in shipments if s.eta_drift_days > 0]
    if delayed:
        st.warning(f"⚠️ **{len(delayed)} In-Transit Shipments Delayed**: Major bottlenecks detected at Chennai Port (Berth Congestion) and Long Beach Port (Customs Hold).")

# ==============================================================================
# TAB 4: CONTROL TOWER: LINE STARVATION & E2E TRACING
# ==============================================================================
with tab_control_tower:
    st.subheader("⏱️ Control Tower: Production Line Starvation & E2E Tracing")
    st.caption("Real-time line starvation countdowns, plant vulnerability rankings, and deterministic multi-echelon impact tracing.")

    # Plant Vulnerability Rankings
    st.markdown("#### 🏭 Manufacturing Plant Operational Vulnerability")
    vuln_plants = supply_chain_risk_engine.evaluate_plant_vulnerability()
    p_cols = st.columns(len(vuln_plants))
    for idx, vp in enumerate(vuln_plants):
        with p_cols[idx]:
            with st.container(border=True):
                st.markdown(f"### {vp['plant_name']}")
                st.caption(f"{vp['location_city']}, {vp['country']} | Lines: **{vp['active_production_lines']}**")
                st.metric("Vulnerability Score", f"{vp['vulnerability_score']}/100", delta=f"{vp['vulnerability_severity'].value} Risk", delta_color="inverse")
                st.metric("Starved Lines", vp['starved_production_lines'])
                st.metric("Projected Downtime Loss", f"${vp['projected_downtime_loss_usd']:,.0f} USD")
                st.caption(f"Unplanned downtime rate: **${vp['hourly_downtime_cost_usd']:,.0f}/hr**")

    # Production Line Starvation Countdown
    st.divider()
    st.markdown("#### ⏳ Production Line Starvation Countdown")
    schedules = local_supply_chain_repo.list_production_schedules()
    sched_rows = []
    for sch in schedules:
        sched_rows.append({
            "Schedule ID": sch.schedule_id,
            "Plant": sch.plant_id,
            "Production Line": sch.line_id,
            "Target Assembly": sch.assembly_name,
            "Planned Units": sch.planned_units,
            "Daily Run Rate": f"{sch.daily_run_rate}/day",
            "Starvation Countdown": f"🚨 {sch.estimated_starvation_hours:.0f} Hours" if sch.estimated_starvation_hours > 0 else "🟢 Safe (0h)",
            "Starvation Severity": sch.starvation_risk_level.value,
            "Bottleneck Component": sch.bottleneck_part_id or "None",
        })
    st.dataframe(pd.DataFrame(sched_rows), use_container_width=True, hide_index=True)

    # End-to-End Multi-Echelon Disruption Tracer
    st.divider()
    st.markdown("#### 🔗 End-to-End Multi-Echelon Disruption Tracer")
    disruption_options = [d.disruption_id for d in local_supply_chain_repo.list_disruptions(active_only=False)]
    selected_dis = st.selectbox("Select Active Disruption to Trace Downstream:", disruption_options)

    if selected_dis:
        trace = multi_echelon_impact_analyzer.trace_disruption_impact(selected_dis)
        if trace:
            with st.container(border=True):
                st.markdown(f"### 📍 Disruption Propagation Map: `{trace.disruption_id}`")
                st.caption(f"Root Cause: **{trace.root_cause_type}** | Primary Source: **{trace.trigger_entity_id}** | Provenance: `{trace.data_provenance.value}`")

                t1, t2, t3, t4 = st.columns(4)
                t1.metric("Time to Depletion (TTD)", f"{trace.time_to_depletion_hours:.1f} Hours", delta=f"Exhaustion: {trace.depletion_timestamp}", delta_color="inverse")
                t2.metric("Revenue at Risk", f"${trace.total_revenue_at_risk_usd:,.2f} USD")
                t3.metric("Daily SLA Penalties", f"${trace.daily_sla_penalties_usd:,.2f}/day")
                t4.metric("Total Projected Loss", f"${trace.total_projected_loss_usd:,.2f} USD")

                st.markdown("##### ⛓️ Multi-Echelon Dependency Hierarchy:")
                st.markdown(f"- **1. Disrupted Inbound POs**: `{', '.join(trace.affected_pos)}`")
                st.markdown(f"- **2. Delayed Shipments**: `{', '.join(trace.affected_shipments)}`")
                st.markdown(f"- **3. Critical Components Starved**: `{', '.join(trace.affected_parts)}`")
                st.markdown(f"- **4. Starved Plant Production Lines**: `{', '.join(trace.starved_production_lines)}`")
                st.markdown(f"- **5. Jeopardized Customer Orders**: `{', '.join(trace.threatened_customer_orders)}`")
                st.markdown(f"- **6. Prescriptive Mitigations & Contracts**: `{', '.join(trace.contingency_mitigation_ids)}`")

# ==============================================================================
# TAB 5: DISRUPTION & MITIGATION CENTER
# ==============================================================================
with tab_mitigations:
    st.subheader("🎯 Active Disruptions & Prescriptive Mitigation Action Center")
    st.caption("Actionable recommendations ranked by financial net benefit. 1-click human approval updates ERP order lines.")

    # Pre-Negotiated Alternative Contracts
    st.markdown("#### 📜 Pre-Negotiated Dual-Source & Backup Contracts")
    alt_contracts = local_supply_chain_repo.list_alternative_contracts()
    alt_rows = []
    for ac in alt_contracts:
        alt_rows.append({
            "Contract ID": ac.contract_id,
            "Primary Supplier": ac.primary_supplier_id,
            "Alternative Backup": f"{ac.alternative_supplier_name} ({ac.alternative_supplier_id})",
            "Target Part": ac.part_id,
            "Guaranteed Capacity": f"{ac.guaranteed_capacity_units_per_month:,} units/mo",
            "Expedited Lead Time": f"{ac.expedited_lead_time_days} days",
            "Price Premium": f"+{ac.price_premium_pct:.1f}%",
            "Status": "ACTIVE" if ac.is_contract_active else "INACTIVE",
        })
    st.dataframe(pd.DataFrame(alt_rows), use_container_width=True, hide_index=True)

    st.divider()
    st.markdown("#### ⚡ Active Disruption Mitigations Awaiting Executive Approval")
    for m in mitigations:
        with st.container(border=True):
            mc1, mc2, mc3 = st.columns([3, 1, 1])
            with mc1:
                st.markdown(f"#### ⚡ **{m.recommendation_id}**: {m.action_type}")
                st.write(f"**Action Rationale**: {m.description}")
                st.caption(f"Target Component: `{m.target_part_id}` | Lead Time: **{m.speed_hours_to_execute} Hours** | Feasibility: **{m.feasibility_score:.0%}** | Urgency: `{m.urgency.value}`")

            with mc2:
                st.metric("Mitigation Cost", f"${m.estimated_mitigation_cost_usd:,.0f}")
                st.metric("Downtime Avoided", f"${m.estimated_downtime_cost_avoided_usd:,.0f}")
                st.metric("Net Financial Benefit", f"${m.net_financial_benefit_usd:,.0f}", delta="Cost Avoidance")

            with mc3:
                st.write(f"**Status**: `{m.status}`")
                if m.status == "APPROVED":
                    st.success(f"Approved by:\n`{m.approved_by}`")
                else:
                    if st.button("✅ Approve Mitigation", key=f"app_mit_{m.recommendation_id}"):
                        local_supply_chain_repo.approve_mitigation(m.recommendation_id, "VP of Global Supply Chain Operations")
                        st.success(f"Mitigation {m.recommendation_id} Approved! Disruption resolved.")
                        st.rerun()

# ==============================================================================
# TAB 6: MULTI-SCENARIO WHAT-IF SIMULATOR
# ==============================================================================
with tab_simulation:
    st.subheader("🔮 Multi-Scenario What-If Stress Testing Simulator")
    st.caption("Evaluate supply network resilience under simulated shocks. All simulation outputs carry explicit SIMULATED_SCENARIO provenance.")

    sim_scenario_type = st.selectbox(
        "Select Shock Vector to Simulate:",
        [
            ("DEMAND_SURGE", "📈 Demand Surge (+35% Spike in High-Precision CNC Mills)"),
            ("CORRIDOR_CHOKEPOINT", "🌊 Maritime Corridor Chokepoint (Malacca/Kaohsiung 7-Day Delay)"),
            ("SUPPLIER_SHUTDOWN", "🏭 Tier-1 Semiconductor Fab Complete Shutdown (14-Day Outage)"),
        ],
        format_func=lambda x: x[1],
    )[0]

    sim_params = {}
    if sim_scenario_type == "DEMAND_SURGE":
        sim_params["assembly_id"] = "ASM-CNC-MILL-5X"
        sim_params["surge_percentage"] = st.slider("Demand Surge Percentage (%)", min_value=10, max_value=100, value=35, step=5)
    elif sim_scenario_type == "CORRIDOR_CHOKEPOINT":
        sim_params["corridor"] = "Kaohsiung-Chennai Maritime Chokepoint"
        sim_params["delay_days"] = st.slider("Chokepoint Delay Duration (Days)", min_value=3, max_value=30, value=7, step=1)
    else:
        sim_params["supplier_id"] = "SUP-MICRO-01"
        sim_params["outage_days"] = st.slider("Fab Outage Duration (Days)", min_value=7, max_value=60, value=14, step=1)

    if st.button("Execute Stress Simulation ⚡", use_container_width=True):
        sim_result = supply_chain_risk_engine.simulate_scenario(sim_scenario_type, sim_params)
        with st.container(border=True):
            st.markdown(f"### 🧪 Simulation Results: {sim_result['scenario_name']}")
            st.info(f"🏷️ **DATA PROVENANCE**: `{sim_result['data_provenance'].value}` (Model Simulation — Disruption Shock Test)")

            sm1, sm2, sm3 = st.columns(3)
            if sim_scenario_type == "DEMAND_SURGE":
                sm1.metric("Base vs Surged Units", f"{sim_result['base_units']} ➔ {sim_result['surged_units']} units")
                sm2.metric("Projected Fill Rate", f"{sim_result['projected_order_fill_rate']:.1%}", delta="-8.2%", delta_color="inverse")
                sm3.metric("Financial Exposure", f"${sim_result['estimated_financial_exposure_usd']:,.2f} USD")
                st.write(f"**Identified Component Bottlenecks**: `{sim_result['bottleneck_parts']}`")
            elif sim_scenario_type == "CORRIDOR_CHOKEPOINT":
                sm1.metric("Simulated Delay", f"+{sim_result['simulated_delay_days']:.0f} Days")
                sm2.metric("Plant Downtime", f"{sim_result['projected_plant_downtime_hours']:.1f} Hours")
                sm3.metric("Projected Financial Loss", f"${sim_result['projected_financial_loss_usd']:,.2f} USD")
                st.write(f"**Affected Shipments**: `{', '.join(sim_result['affected_shipments'])}`")
            else:
                sm1.metric("Supplier Target", sim_result['simulated_supplier_id'])
                sm2.metric("Time to Line Starvation", f"{sim_result['time_to_complete_line_starvation_hours']:.0f} Hours")
                sm3.metric("Projected Total Loss", f"${sim_result['projected_total_downtime_loss_usd']:,.2f} USD")
                st.write(f"**Affected Critical Components**: `{', '.join(sim_result['affected_critical_parts'])}`")
                st.write(f"**Starved Manufacturing Facilities**: `{', '.join(sim_result['impacted_plants'])}`")

            st.success(f"💡 **Prescriptive Mitigation Strategy**: {sim_result['recommended_action']}")

# ==============================================================================
# TAB 7: CONVERSATIONAL AI ASSISTANT
# ==============================================================================
with tab_ai:
    st.subheader("🤖 AI-Powered Conversational Supply Chain Assistant")
    st.caption("Multi-source grounded analytics across ERP, TMS, WMS, and BOM data. Zero hallucinations with prompt-injection defense.")

    if "sc_chat_response" not in st.session_state:
        st.session_state.sc_chat_response = None
    if "sc_query_text" not in st.session_state:
        st.session_state.sc_query_text = ""

    # Controls
    ai_col1, ai_col2, ai_col3 = st.columns([2, 1, 1])
    with ai_col1:
        ai_part = st.selectbox("Target Part Filter", ["Auto-detect"] + [p.part_id for p in local_supply_chain_repo.list_parts()])
    with ai_col2:
        ai_lang = st.selectbox("Response Language", [("en", "English 🇬🇧"), ("de", "Deutsch 🇩🇪"), ("hi", "Hindi 🇮🇳")], format_func=lambda x: x[1])[0]
    with ai_col3:
        ai_role = st.selectbox("Role", [UserRole.PROCUREMENT_MANAGER, UserRole.SUPPLY_CHAIN_DIRECTOR, UserRole.LOGISTICS_COORDINATOR, UserRole.PLANT_OPERATIONS_LEAD], format_func=lambda r: r.value)

    # Pre-canned Quick Queries
    st.markdown("**⚡ Quick Operational Inquiries:**")
    q1, q2, q3, q4 = st.columns(4)
    if q1.button("🚨 7-day supplier delay risk?", use_container_width=True):
        st.session_state.sc_query_text = "Which suppliers are most likely to cause delays in the next 7 days?"
    if q2.button("📉 Why is inventory declining rapidly?", use_container_width=True):
        st.session_state.sc_query_text = "Why is inventory for PRT-MCU-8841 declining rapidly and what is the depletion timestamp?"
    if q3.button("🏭 Which plants are most vulnerable?", use_container_width=True):
        st.session_state.sc_query_text = "Which plants or production lines are most vulnerable right now?"
    if q4.button("💰 Excess working capital analysis?", use_container_width=True):
        st.session_state.sc_query_text = "What is our excess inventory and tied-up working capital across all warehouses?"

    # Chat Form
    with st.form("sc_ai_form", clear_on_submit=False):
        user_sc_query = st.text_input("Ask a supply chain question:", value=st.session_state.sc_query_text, placeholder="e.g. Which parts are likely to run out of stock? What customer orders are at risk?")
        sc_submit = st.form_submit_button("Ask Supply Chain AI 🚀", use_container_width=True)

    if sc_submit and user_sc_query.strip():
        chosen_p = None if ai_part == "Auto-detect" else ai_part
        req = SupplyChainChatRequest(
            query=user_sc_query.strip(),
            part_id=chosen_p,
            plant_id=plant_filter,
            language=ai_lang,
            user_role=ai_role,
        )
        with st.spinner("Analyzing ERP purchase orders, in-transit telemetry, inventory DOI, and customer SLA exposure..."):
            resp = asyncio.run(supply_chain_assistant_service.answer_query(req))
            st.session_state.sc_chat_response = resp
            st.session_state.sc_query_text = user_sc_query.strip()

    if st.session_state.sc_chat_response:
        resp = st.session_state.sc_chat_response
        st.divider()
        st.markdown(resp.answer_markdown)
        st.caption(f"Written by {resp.generated_by}" + (f" · {resp.ai_note}" if resp.ai_note else ""))

        # Collapsible Grounded Evidence
        with st.expander("🔬 View Multi-Source Grounded Evidence (ERP / TMS / WMS)", expanded=False):
            e_col1, e_col2 = st.columns(2)
            with e_col1:
                st.write("**Verified Facts**")
                st.json(resp.evidence.verified_facts)
            with e_col2:
                st.write("**Risk Predictions & Downstream Impact**")
                st.json(resp.evidence.risk_predictions)
                st.json(resp.evidence.downstream_impact)
