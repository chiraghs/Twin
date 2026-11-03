-- ==============================================================================
-- Twin Supply Chain Intelligence BigQuery Lakehouse Schema
-- Database / Dataset: supply_chain_intelligence
-- Implements governed ontology: Supplier -> Part -> PO -> Shipment -> Plant -> Order
-- ==============================================================================

-- 1. Dimension: Suppliers
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.dim_supplier` (
    supplier_id STRING NOT NULL OPTIONS(description="Primary Key: Unique supplier identifier"),
    supplier_name STRING NOT NULL,
    country STRING NOT NULL,
    tier INT64 NOT NULL OPTIONS(description="Tier 1, Tier 2, Tier 3"),
    category STRING NOT NULL,
    contract_start DATE,
    contract_end DATE,
    lead_time_days_mean FLOAT64 NOT NULL,
    lead_time_variance_days FLOAT64 NOT NULL,
    on_time_delivery_rate FLOAT64 NOT NULL,
    defect_ppm FLOAT64 DEFAULT 50.0,
    geopolitical_risk_score FLOAT64 DEFAULT 0.1,
    financial_stability_score FLOAT64 DEFAULT 0.9,
    composite_risk_level STRING NOT NULL,
    data_provenance STRING DEFAULT 'ACTUAL'
)
CLUSTER BY tier, category, composite_risk_level;

-- 2. Dimension: Parts / Components
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.dim_part` (
    part_id STRING NOT NULL OPTIONS(description="Primary Key: Part SKU"),
    part_name STRING NOT NULL,
    primary_supplier_id STRING NOT NULL,
    alternate_supplier_id STRING,
    unit_cost_usd FLOAT64 NOT NULL,
    criticality STRING NOT NULL OPTIONS(description="A, B, C"),
    category STRING NOT NULL,
    weight_kg FLOAT64,
    safety_stock_units INT64 NOT NULL,
    reorder_point_units INT64 NOT NULL,
    standard_lead_time_days INT64 NOT NULL,
    dual_sourced BOOL DEFAULT FALSE
)
CLUSTER BY criticality, category, primary_supplier_id;

-- 3. Bill of Materials (BOM) Bridge
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.dim_bill_of_materials` (
    finished_assembly_id STRING NOT NULL,
    assembly_name STRING NOT NULL,
    part_id STRING NOT NULL,
    quantity_required_per_unit INT64 NOT NULL,
    critical_for_assembly BOOL DEFAULT TRUE
)
CLUSTER BY finished_assembly_id, part_id;

-- 4. Fact: Real-Time Inventory Status
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_inventory_balance` (
    inventory_id STRING NOT NULL,
    part_id STRING NOT NULL,
    warehouse_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    stock_on_hand INT64 NOT NULL,
    stock_allocated INT64 NOT NULL,
    stock_available INT64 NOT NULL,
    daily_consumption_rate FLOAT64 NOT NULL,
    days_of_inventory_remaining FLOAT64 NOT NULL,
    stockout_risk_score FLOAT64 NOT NULL,
    is_at_risk_of_stockout BOOL NOT NULL,
    snapshot_timestamp TIMESTAMP NOT NULL
)
PARTITION BY DATE(snapshot_timestamp)
CLUSTER BY plant_id, is_at_risk_of_stockout, part_id;

-- 5. Fact: Purchase Orders
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_purchase_order` (
    po_id STRING NOT NULL,
    supplier_id STRING NOT NULL,
    part_id STRING NOT NULL,
    destination_plant_id STRING NOT NULL,
    destination_warehouse_id STRING NOT NULL,
    quantity_ordered INT64 NOT NULL,
    quantity_received INT64 DEFAULT 0,
    unit_price_usd FLOAT64 NOT NULL,
    total_amount_usd FLOAT64 NOT NULL,
    po_status STRING NOT NULL,
    order_date DATE NOT NULL,
    promised_delivery_date DATE NOT NULL,
    estimated_arrival_date DATE NOT NULL,
    is_delayed BOOL DEFAULT FALSE,
    delay_days FLOAT64 DEFAULT 0.0
)
PARTITION BY order_date
CLUSTER BY supplier_id, po_status, is_delayed;

-- 6. Fact: Logistics & Shipments
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_shipment` (
    shipment_id STRING NOT NULL,
    po_id STRING NOT NULL,
    carrier_name STRING NOT NULL,
    transport_mode STRING NOT NULL,
    origin_hub STRING NOT NULL,
    destination_hub STRING NOT NULL,
    status STRING NOT NULL,
    dispatch_date TIMESTAMP NOT NULL,
    scheduled_eta TIMESTAMP NOT NULL,
    current_projected_eta TIMESTAMP NOT NULL,
    eta_drift_days FLOAT64 DEFAULT 0.0,
    current_location_lat FLOAT64,
    current_location_lon FLOAT64,
    milestone_summary STRING,
    delay_root_cause STRING,
    carbon_emissions_kg_co2e FLOAT64 DEFAULT 120.0
)
PARTITION BY DATE(scheduled_eta)
CLUSTER BY status, transport_mode, carrier_name;

-- 7. Fact: Customer Orders at Risk
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_customer_order` (
    order_id STRING NOT NULL,
    customer_name STRING NOT NULL,
    finished_assembly_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    quantity INT64 NOT NULL,
    revenue_usd FLOAT64 NOT NULL,
    sla_delivery_deadline DATE NOT NULL,
    order_status STRING NOT NULL,
    sla_penalty_per_day_usd FLOAT64 DEFAULT 1200.0,
    downstream_delay_days FLOAT64 DEFAULT 0.0,
    is_impacted_by_supply_disruption BOOL DEFAULT FALSE,
    associated_disruption_id STRING
)
PARTITION BY sla_delivery_deadline
CLUSTER BY order_status, is_impacted_by_supply_disruption, plant_id;

-- 8. Fact: Disruption Events & Incidents
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_disruption_event` (
    disruption_id STRING NOT NULL,
    disruption_type STRING NOT NULL,
    severity STRING NOT NULL,
    title STRING NOT NULL,
    description STRING NOT NULL,
    affected_supplier_ids ARRAY<STRING>,
    affected_part_ids ARRAY<STRING>,
    affected_shipment_ids ARRAY<STRING>,
    affected_plants ARRAY<STRING>,
    affected_customer_orders ARRAY<STRING>,
    estimated_daily_financial_impact_usd FLOAT64 NOT NULL,
    total_projected_disruption_cost_usd FLOAT64 NOT NULL,
    detected_at TIMESTAMP NOT NULL,
    resolved BOOL DEFAULT FALSE
)
PARTITION BY DATE(detected_at)
CLUSTER BY severity, disruption_type, resolved;

-- 9. Fact: Mitigation Action Ledger
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_mitigation_recommendation` (
    recommendation_id STRING NOT NULL,
    disruption_id STRING NOT NULL,
    action_type STRING NOT NULL,
    description STRING NOT NULL,
    target_part_id STRING NOT NULL,
    source_supplier_id STRING,
    target_supplier_id STRING,
    estimated_mitigation_cost_usd FLOAT64 NOT NULL,
    estimated_downtime_cost_avoided_usd FLOAT64 NOT NULL,
    net_financial_benefit_usd FLOAT64 NOT NULL,
    speed_hours_to_execute INT64 NOT NULL,
    feasibility_score FLOAT64 NOT NULL,
    urgency STRING NOT NULL,
    status STRING DEFAULT 'PENDING_APPROVAL',
    approved_by STRING,
    created_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(created_at)
CLUSTER BY status, urgency, target_part_id;

-- 10. Dimension: Logistics Service Providers (Carriers)
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.dim_carrier` (
    carrier_id STRING NOT NULL OPTIONS(description="Primary Key: Carrier ID"),
    carrier_name STRING NOT NULL,
    transport_mode STRING NOT NULL,
    on_time_performance_rate FLOAT64 NOT NULL,
    average_transit_delay_days FLOAT64 NOT NULL,
    carbon_efficiency_rating STRING DEFAULT 'B',
    primary_corridors ARRAY<STRING>,
    contact_dispatch STRING
)
CLUSTER BY transport_mode, on_time_performance_rate;

-- 11. Dimension: Dedicated Regional Warehouses
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.dim_warehouse` (
    warehouse_id STRING NOT NULL OPTIONS(description="Primary Key: Warehouse ID"),
    warehouse_name STRING NOT NULL,
    location_city STRING NOT NULL,
    storage_capacity_pallets INT64 NOT NULL,
    utilized_capacity_pct FLOAT64 NOT NULL,
    associated_plant_id STRING NOT NULL,
    annual_holding_cost_rate_pct FLOAT64 DEFAULT 22.0
)
CLUSTER BY associated_plant_id, utilized_capacity_pct;

-- 12. Fact: Plant Production Schedules & Line Starvation
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_production_schedule` (
    schedule_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    line_id STRING NOT NULL,
    assembly_id STRING NOT NULL,
    assembly_name STRING NOT NULL,
    planned_start_date DATE NOT NULL,
    planned_end_date DATE NOT NULL,
    planned_units INT64 NOT NULL,
    daily_run_rate INT64 NOT NULL,
    required_parts_allocated BOOL NOT NULL,
    starvation_risk_level STRING NOT NULL,
    estimated_starvation_hours FLOAT64 DEFAULT 0.0,
    bottleneck_part_id STRING
)
PARTITION BY planned_start_date
CLUSTER BY plant_id, starvation_risk_level, bottleneck_part_id;

-- 13. Fact: Probabilistic Demand Forecasts
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_demand_forecast` (
    forecast_id STRING NOT NULL,
    assembly_id STRING NOT NULL,
    assembly_name STRING NOT NULL,
    horizon_days INT64 DEFAULT 30,
    p10_units INT64 NOT NULL,
    p50_units INT64 NOT NULL,
    p90_units INT64 NOT NULL,
    forecast_growth_rate_pct FLOAT64 DEFAULT 5.0,
    demand_surge_risk BOOL DEFAULT FALSE,
    generated_at DATE NOT NULL
)
PARTITION BY generated_at
CLUSTER BY assembly_id, demand_surge_risk;

-- 14. Dimension: Pre-Negotiated Alternative Supplier Contracts
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.dim_alternative_supplier_contract` (
    contract_id STRING NOT NULL,
    primary_supplier_id STRING NOT NULL,
    alternative_supplier_id STRING NOT NULL,
    alternative_supplier_name STRING NOT NULL,
    part_id STRING NOT NULL,
    guaranteed_capacity_units_per_month INT64 NOT NULL,
    expedited_lead_time_days INT64 NOT NULL,
    price_premium_pct FLOAT64 DEFAULT 15.0,
    is_contract_active BOOL DEFAULT TRUE
)
CLUSTER BY part_id, is_contract_active, primary_supplier_id;

-- 15. Fact: Excess Inventory & Working Capital Inefficiencies
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_excess_inventory` (
    part_id STRING NOT NULL,
    part_name STRING NOT NULL,
    stock_on_hand INT64 NOT NULL,
    days_of_inventory FLOAT64 NOT NULL,
    excess_units INT64 NOT NULL,
    tied_up_capital_usd FLOAT64 NOT NULL,
    annual_holding_cost_usd FLOAT64 NOT NULL,
    obsolescence_risk_score FLOAT64 NOT NULL,
    recommended_action STRING DEFAULT 'HOLD',
    calculated_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(calculated_at)
CLUSTER BY recommended_action, tied_up_capital_usd;

-- 16. Fact: Multi-Echelon End-to-End Disruption Impact Traces
CREATE TABLE IF NOT EXISTS `twin-enterprise.supply_chain_intelligence.fact_end_to_end_impact_trace` (
    disruption_id STRING NOT NULL,
    root_cause_type STRING NOT NULL,
    trigger_entity_id STRING NOT NULL,
    affected_pos ARRAY<STRING>,
    affected_shipments ARRAY<STRING>,
    affected_parts ARRAY<STRING>,
    time_to_depletion_hours FLOAT64 NOT NULL,
    depletion_timestamp TIMESTAMP NOT NULL,
    starved_production_lines ARRAY<STRING>,
    threatened_customer_orders ARRAY<STRING>,
    total_revenue_at_risk_usd FLOAT64 NOT NULL,
    daily_sla_penalties_usd FLOAT64 NOT NULL,
    total_projected_loss_usd FLOAT64 NOT NULL,
    contingency_mitigation_ids ARRAY<STRING>,
    data_provenance STRING DEFAULT 'ACTUAL',
    traced_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(traced_at)
CLUSTER BY root_cause_type, data_provenance, disruption_id;

