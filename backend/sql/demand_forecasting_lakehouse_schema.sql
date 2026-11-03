-- ==============================================================================
-- Twin Manufacturing Demand Forecasting BigQuery Lakehouse Schema
-- Dataset: demand_forecasting (GCP Project: twin-enterprise)
-- ==============================================================================

-- 1. Demand & Master Tables
CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.plant_master` (
    plant_id STRING NOT NULL OPTIONS(description="Primary Key: Plant ID"),
    plant_name STRING NOT NULL,
    location_city STRING NOT NULL,
    country STRING NOT NULL,
    region STRING DEFAULT 'APAC',
    active_production_lines INT64 NOT NULL,
    rated_capacity_hours_per_day FLOAT64 NOT NULL,
    shift_count INT64 DEFAULT 2,
    hourly_downtime_cost_usd FLOAT64 DEFAULT 3500.0
)
CLUSTER BY region, country;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.product_master` (
    product_id STRING NOT NULL OPTIONS(description="Primary Key: Finished Product SKU"),
    product_name STRING NOT NULL,
    category STRING NOT NULL,
    target_plant_id STRING NOT NULL,
    unit_cost_usd FLOAT64 NOT NULL,
    selling_price_usd FLOAT64 NOT NULL,
    standard_lead_time_days INT64 DEFAULT 14,
    safety_stock_units INT64 DEFAULT 200,
    cycle_time_hours_per_unit FLOAT64 DEFAULT 1.8,
    lot_size_units INT64 DEFAULT 25
)
CLUSTER BY category, target_plant_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.historical_demand` (
    record_id STRING NOT NULL,
    product_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    date_recorded DATE NOT NULL,
    actual_units FLOAT64 NOT NULL,
    sales_orders_count INT64 DEFAULT 1,
    unfulfilled_backlog_units FLOAT64 DEFAULT 0.0,
    demand_shock_flag BOOL DEFAULT FALSE,
    data_provenance STRING DEFAULT 'ACTUAL'
)
PARTITION BY date_recorded
CLUSTER BY product_id, plant_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.sales_orders` (
    order_id STRING NOT NULL,
    customer_id STRING NOT NULL,
    customer_name STRING NOT NULL,
    product_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    order_date DATE NOT NULL,
    requested_delivery_date DATE NOT NULL,
    quantity_units INT64 NOT NULL,
    unit_price_usd FLOAT64 NOT NULL,
    total_amount_usd FLOAT64 NOT NULL,
    status STRING DEFAULT 'CONFIRMED'
)
PARTITION BY order_date
CLUSTER BY product_id, plant_id, status;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.calendar_features` (
    calendar_date DATE NOT NULL,
    year INT64 NOT NULL,
    quarter INT64 NOT NULL,
    month INT64 NOT NULL,
    day_of_week INT64 NOT NULL,
    is_weekend BOOL NOT NULL,
    is_national_holiday BOOL DEFAULT FALSE,
    working_shift_hours FLOAT64 DEFAULT 16.0
)
PARTITION BY calendar_date;

-- 2. Production Tables
CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.production_capacity` (
    line_id STRING NOT NULL,
    line_name STRING NOT NULL,
    plant_id STRING NOT NULL,
    total_capacity_hours FLOAT64 NOT NULL,
    scheduled_production_hours FLOAT64 NOT NULL,
    maintenance_downtime_hours FLOAT64 DEFAULT 0.0,
    available_headroom_hours FLOAT64 NOT NULL,
    utilization_pct FLOAT64 NOT NULL,
    is_bottleneck BOOL DEFAULT FALSE
)
CLUSTER BY plant_id, line_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.production_orders` (
    order_id STRING NOT NULL,
    product_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    line_id STRING NOT NULL,
    planned_units INT64 NOT NULL,
    target_start_date DATE NOT NULL,
    target_completion_date DATE NOT NULL,
    status STRING DEFAULT 'PLANNED'
)
PARTITION BY target_start_date
CLUSTER BY plant_id, line_id, product_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.production_actuals` (
    actual_id STRING NOT NULL,
    order_id STRING NOT NULL,
    production_date DATE NOT NULL,
    units_completed INT64 NOT NULL,
    units_scrapped INT64 DEFAULT 0,
    operating_hours FLOAT64 NOT NULL
)
PARTITION BY production_date;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.production_schedule` (
    schedule_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    line_id STRING NOT NULL,
    product_id STRING NOT NULL,
    scheduled_date DATE NOT NULL,
    planned_units INT64 NOT NULL,
    daily_run_rate_units INT64 NOT NULL,
    parts_allocated BOOL DEFAULT TRUE,
    starvation_risk STRING DEFAULT 'LOW'
)
PARTITION BY scheduled_date
CLUSTER BY plant_id, line_id;

-- 3. Inventory Tables
CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.inventory_snapshots` (
    snapshot_date DATE NOT NULL,
    item_id STRING NOT NULL,
    item_name STRING NOT NULL,
    category STRING NOT NULL,
    plant_id STRING NOT NULL,
    stock_on_hand INT64 NOT NULL,
    stock_usable INT64 NOT NULL,
    daily_consumption_rate FLOAT64 NOT NULL,
    days_on_hand FLOAT64 NOT NULL,
    safety_stock_units INT64 NOT NULL,
    reorder_point_units INT64 NOT NULL,
    potential_stockout BOOL DEFAULT FALSE
)
PARTITION BY snapshot_date
CLUSTER BY plant_id, category, potential_stockout;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.inventory_movements` (
    movement_id STRING NOT NULL,
    item_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    movement_type STRING NOT NULL, -- INBOUND_GR | CONSUMPTION_ISSUE | SCRAP_WRITE_OFF
    quantity INT64 NOT NULL,
    movement_timestamp TIMESTAMP NOT NULL
)
PARTITION BY DATE(movement_timestamp)
CLUSTER BY plant_id, item_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.purchase_orders` (
    po_id STRING NOT NULL,
    supplier_id STRING NOT NULL,
    item_id STRING NOT NULL,
    destination_plant_id STRING NOT NULL,
    quantity_ordered INT64 NOT NULL,
    promised_delivery_date DATE NOT NULL,
    status STRING DEFAULT 'CONFIRMED'
)
PARTITION BY promised_delivery_date
CLUSTER BY destination_plant_id, supplier_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.supplier_lead_times` (
    supplier_id STRING NOT NULL,
    supplier_name STRING NOT NULL,
    item_id STRING NOT NULL,
    mean_lead_time_days FLOAT64 NOT NULL,
    lead_time_variance_days FLOAT64 NOT NULL,
    on_time_delivery_rate FLOAT64 NOT NULL
)
CLUSTER BY supplier_id, item_id;

-- 4. Maintenance Tables
CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.equipment_assets` (
    asset_id STRING NOT NULL,
    asset_name STRING NOT NULL,
    plant_id STRING NOT NULL,
    line_id STRING NOT NULL,
    availability_pct FLOAT64 NOT NULL,
    historical_downtime_hours_30d FLOAT64 NOT NULL,
    mtbf_hours FLOAT64 NOT NULL,
    mttr_hours FLOAT64 NOT NULL,
    planned_downtime_hours_next_14d FLOAT64 DEFAULT 0.0,
    health_status STRING DEFAULT 'HEALTHY'
)
CLUSTER BY plant_id, line_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.equipment_downtime` (
    event_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    downtime_start TIMESTAMP NOT NULL,
    downtime_end TIMESTAMP,
    duration_hours FLOAT64 NOT NULL,
    reason STRING NOT NULL,
    resolved BOOL DEFAULT TRUE
)
PARTITION BY DATE(downtime_start)
CLUSTER BY plant_id, asset_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.maintenance_work_orders` (
    work_order_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    work_order_type STRING NOT NULL,
    scheduled_date DATE NOT NULL,
    estimated_hours FLOAT64 NOT NULL,
    status STRING DEFAULT 'SCHEDULED'
)
PARTITION BY scheduled_date;

-- 5. Quality Tables
CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.quality_inspections` (
    inspection_id STRING NOT NULL,
    production_date DATE NOT NULL,
    plant_id STRING NOT NULL,
    product_id STRING NOT NULL,
    inspected_units INT64 NOT NULL,
    defective_units INT64 NOT NULL,
    scrapped_units INT64 NOT NULL,
    first_pass_yield_pct FLOAT64 NOT NULL
)
PARTITION BY production_date
CLUSTER BY plant_id, product_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.production_defects` (
    defect_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    product_id STRING NOT NULL,
    defect_code STRING NOT NULL,
    defect_description STRING NOT NULL,
    occurrences_count INT64 NOT NULL
)
CLUSTER BY plant_id, product_id;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.production_yield` (
    yield_date DATE NOT NULL,
    plant_id STRING NOT NULL,
    product_id STRING NOT NULL,
    line_id STRING NOT NULL,
    first_pass_yield_pct FLOAT64 NOT NULL,
    scrap_rate_pct FLOAT64 NOT NULL
)
PARTITION BY yield_date
CLUSTER BY plant_id, product_id;

-- 6. Forecasting & Analytics Tables
CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.demand_forecasts` (
    forecast_id STRING NOT NULL,
    product_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    horizon_days INT64 NOT NULL,
    model_name STRING NOT NULL,
    total_forecasted_units FLOAT64 NOT NULL,
    wape FLOAT64 NOT NULL,
    generated_at TIMESTAMP NOT NULL,
    data_provenance STRING DEFAULT 'ACTUAL'
)
PARTITION BY DATE(generated_at)
CLUSTER BY product_id, plant_id, model_name;

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.forecast_evaluations` (
    evaluation_id STRING NOT NULL,
    model_name STRING NOT NULL,
    horizon_days INT64 NOT NULL,
    mae FLOAT64 NOT NULL,
    rmse FLOAT64 NOT NULL,
    wape FLOAT64 NOT NULL,
    bias FLOAT64 NOT NULL,
    evaluated_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(evaluated_at);

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.model_registry` (
    model_id STRING NOT NULL,
    model_type STRING NOT NULL,
    display_name STRING NOT NULL,
    version STRING NOT NULL,
    is_active_champion BOOL DEFAULT FALSE,
    wape FLOAT64 NOT NULL,
    trained_on DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.scenario_runs` (
    scenario_id STRING NOT NULL,
    scenario_name STRING NOT NULL,
    plant_id STRING NOT NULL,
    forecast_delta_units FLOAT64 NOT NULL,
    capacity_shortfall_hours FLOAT64 NOT NULL,
    net_financial_impact_usd FLOAT64 NOT NULL,
    executed_at TIMESTAMP NOT NULL,
    data_provenance STRING DEFAULT 'SIMULATED'
)
PARTITION BY DATE(executed_at);

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.planning_recommendations` (
    recommendation_id STRING NOT NULL,
    product_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    net_requirements_units FLOAT64 NOT NULL,
    feasible_production_units FLOAT64 NOT NULL,
    created_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(created_at);

CREATE TABLE IF NOT EXISTS `twin-enterprise.demand_forecasting.pipeline_runs` (
    pipeline_id STRING NOT NULL,
    pipeline_name STRING NOT NULL,
    status STRING NOT NULL,
    records_processed INT64 NOT NULL,
    executed_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(executed_at);
