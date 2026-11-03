-- ==============================================================================
-- Twin Canonical Industrial Lakehouse Schema
-- Database / Dataset: predictive_maintenance
-- Supports Unified Asset Modeling across PLC, SCADA, CMMS, MES, and ERP systems.
-- ==============================================================================

-- 1. Canonical Dimension: Asset Hierarchy & Economics
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.dim_asset` (
    asset_id STRING NOT NULL OPTIONS(description="Canonical enterprise asset identifier"),
    asset_name STRING NOT NULL,
    plant_id STRING NOT NULL,
    line_id STRING NOT NULL,
    equipment_type STRING NOT NULL OPTIONS(description="CNC_MILLING, ROBOTIC_ARM, CENTRIFUGAL_PUMP, HYDRAULIC_PRESS, CONVEYOR"),
    criticality STRING NOT NULL OPTIONS(description="A: Production Critical, B: Major Line, C: Balance of Plant"),
    manufacturer STRING,
    model_number STRING,
    installation_date DATE,
    rated_speed_rpm FLOAT64,
    rated_power_kw FLOAT64,
    baseline_vibration_rms FLOAT64 NOT NULL,
    baseline_temperature_c FLOAT64 NOT NULL,
    hourly_downtime_cost_usd FLOAT64 NOT NULL OPTIONS(description="Hourly financial impact of unplanned asset stoppage"),
    replacement_value_usd FLOAT64 NOT NULL,
    is_active BOOL NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
)
CLUSTER BY plant_id, line_id, asset_id
OPTIONS(description="Master asset dimension with financial and operational parameters");

-- 2. Bridge Table: Multi-Source Identifier Translation
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.bridge_asset_source_id` (
    bridge_id STRING NOT NULL,
    canonical_asset_id STRING NOT NULL,
    source_system STRING NOT NULL OPTIONS(description="PLC_SCADA, CMMS_MAXIMO, MES_OPCENTER, ERP_SAP"),
    source_identifier STRING NOT NULL OPTIONS(description="Native tag or ID in the source system"),
    description STRING,
    mapped_at TIMESTAMP NOT NULL,
    is_primary BOOL NOT NULL DEFAULT TRUE
)
CLUSTER BY canonical_asset_id, source_system
OPTIONS(description="Resolves cross-system entity identifiers to the canonical asset_id");

-- 3. Partitioned Sensor Readings (OT Telemetry)
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.fact_sensor_reading` (
    reading_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    vibration_mm_s FLOAT64 NOT NULL,
    temperature_celsius FLOAT64 NOT NULL,
    pressure_bar FLOAT64,
    motor_current_amps FLOAT64,
    torque_nm FLOAT64,
    rpm FLOAT64 NOT NULL,
    operating_hours FLOAT64 NOT NULL,
    data_provenance STRING NOT NULL OPTIONS(description="ACTUAL | SIMULATED"),
    source_system STRING NOT NULL,
    ingestion_timestamp TIMESTAMP NOT NULL,
    lineage_job_id STRING
)
PARTITION BY DATE(timestamp)
CLUSTER BY asset_id, source_system
OPTIONS(description="High-frequency telemetry partitioned by date and clustered by canonical asset");

-- 4. Machine State Transitions
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.fact_machine_state` (
    state_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    state_start TIMESTAMP NOT NULL,
    state_end TIMESTAMP,
    duration_seconds FLOAT64,
    operating_state STRING NOT NULL OPTIONS(description="RUNNING, IDLE, MICRO_STOP, UNPLANNED_DOWNTIME, PLANNED_MAINTENANCE"),
    state_reason STRING,
    source_system STRING NOT NULL,
    data_provenance STRING NOT NULL
)
PARTITION BY DATE(state_start)
CLUSTER BY asset_id, operating_state;

-- 5. CMMS Work Orders & Repair History
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.fact_work_order` (
    work_order_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    source_work_order_num STRING NOT NULL,
    work_order_type STRING NOT NULL OPTIONS(description="PREVENTIVE, CORRECTIVE, EMERGENCY, INSPECTION"),
    failure_code STRING,
    failure_description STRING,
    work_status STRING NOT NULL OPTIONS(description="OPEN, IN_PROGRESS, COMPLETED, CANCELLED"),
    scheduled_start TIMESTAMP,
    actual_start TIMESTAMP,
    actual_finish TIMESTAMP,
    labor_hours FLOAT64 NOT NULL,
    labor_rate_usd FLOAT64 NOT NULL,
    spare_parts_cost_usd FLOAT64 NOT NULL,
    total_cost_usd FLOAT64 NOT NULL,
    technician_notes STRING,
    source_system STRING NOT NULL,
    data_provenance STRING NOT NULL
)
PARTITION BY DATE(scheduled_start)
CLUSTER BY asset_id, work_order_type;

-- 6. MES Production Downtime Events
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.fact_production_downtime` (
    downtime_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    line_id STRING NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    duration_minutes FLOAT64 NOT NULL,
    downtime_category STRING NOT NULL OPTIONS(description="UNPLANNED_MECHANICAL, ELECTRICAL, PROCESS_JAM, CHANGEOVER"),
    lost_production_units INT64 NOT NULL,
    downtime_financial_impact_usd FLOAT64 NOT NULL,
    root_cause_asset_id STRING,
    source_system STRING NOT NULL,
    data_provenance STRING NOT NULL
)
PARTITION BY DATE(start_time)
CLUSTER BY line_id, asset_id;

-- 7. ERP Spare Parts Inventory & Costs
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.fact_inventory_cost` (
    inventory_record_id STRING NOT NULL,
    part_number STRING NOT NULL,
    asset_id STRING NOT NULL,
    part_description STRING NOT NULL,
    stock_on_hand INT64 NOT NULL,
    safety_stock INT64 NOT NULL,
    unit_cost_usd FLOAT64 NOT NULL,
    lead_time_days INT64 NOT NULL,
    supplier_id STRING,
    last_replenished_at TIMESTAMP,
    data_provenance STRING NOT NULL
)
CLUSTER BY asset_id, part_number;

-- 8. Machine Predictions (Anomaly + Supervised Failure)
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.fact_machine_prediction` (
    prediction_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    prediction_timestamp TIMESTAMP NOT NULL,
    prediction_horizon_hours INT64 NOT NULL,
    anomaly_score FLOAT64 NOT NULL OPTIONS(description="Unsupervised Mahalanobis / residual deviation (0.0 - 1.0)"),
    failure_probability FLOAT64 NOT NULL OPTIONS(description="Supervised failure likelihood within horizon (0.0 - 1.0)"),
    risk_category STRING NOT NULL OPTIONS(description="LOW, MEDIUM, HIGH, CRITICAL"),
    criticality_adjusted_risk_index FLOAT64 NOT NULL OPTIONS(description="CARI score weighted by financial impact"),
    contributing_features JSON NOT NULL,
    model_version STRING NOT NULL,
    data_provenance STRING NOT NULL
)
PARTITION BY DATE(prediction_timestamp)
CLUSTER BY risk_category, asset_id;

-- 9. Actionable Maintenance Recommendations (CARI-Ranked)
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.fact_maintenance_recommendation` (
    recommendation_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    created_at TIMESTAMP NOT NULL,
    urgency STRING NOT NULL OPTIONS(description="IMMEDIATE, SCHEDULED_NEXT_SHIFT, SCHEDULED_WEEKLY, MONITOR"),
    recommended_action STRING NOT NULL,
    rationale STRING NOT NULL,
    supporting_evidence JSON NOT NULL,
    expected_downtime_avoided_hours FLOAT64 NOT NULL,
    expected_cost_avoidance_usd FLOAT64 NOT NULL,
    required_parts JSON NOT NULL,
    parts_available BOOL NOT NULL,
    approval_status STRING NOT NULL OPTIONS(description="PENDING_APPROVAL, APPROVED, REJECTED, EXECUTED"),
    approved_by STRING,
    approved_at TIMESTAMP,
    cmms_work_order_created STRING
)
PARTITION BY DATE(created_at)
CLUSTER BY approval_status, urgency, asset_id;

-- 10. Verified Maintenance Outcomes (Ground Truth Tracking)
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.fact_maintenance_outcome` (
    outcome_id STRING NOT NULL,
    recommendation_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    verified_at TIMESTAMP NOT NULL,
    verification_outcome STRING NOT NULL OPTIONS(description="TRUE_POSITIVE_PREVENTED, FALSE_POSITIVE_EARLY, MISSED_FAILURE"),
    actual_downtime_hours_avoided FLOAT64 NOT NULL,
    actual_maintenance_cost_usd FLOAT64 NOT NULL,
    verified_by STRING NOT NULL,
    findings STRING
)
PARTITION BY DATE(verified_at)
CLUSTER BY verification_outcome, asset_id;

-- 11. Auditable ROI Ledger
CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.fact_roi_ledger` (
    ledger_id STRING NOT NULL,
    asset_id STRING NOT NULL,
    recorded_at TIMESTAMP NOT NULL,
    entry_type STRING NOT NULL OPTIONS(description="AVOIDED_DOWNTIME, UNPLANNED_STOPPAGE, PREVENTIVE_REPAIR, PLATFORM_OPERATING_COST"),
    value_category STRING NOT NULL OPTIONS(description="ESTIMATED, REALIZED"),
    amount_usd FLOAT64 NOT NULL,
    downtime_hours FLOAT64 NOT NULL,
    calculation_formula STRING NOT NULL,
    evidence_reference STRING NOT NULL OPTIONS(description="Pointer to fact_maintenance_recommendation or fact_maintenance_outcome"),
    cumulative_net_benefit_usd FLOAT64 NOT NULL
)
PARTITION BY DATE(recorded_at)
CLUSTER BY value_category, entry_type, asset_id
OPTIONS(description="Immutable financial ledger proving realized and estimated ROI");
