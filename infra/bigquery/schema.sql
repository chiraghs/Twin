-- Twin AI — BigQuery schema
-- Usage:  bq query --use_legacy_sql=false --project_id=$GOOGLE_CLOUD_PROJECT < infra/bigquery/schema.sql
-- Replace `twin` with your BIGQUERY_DATASET name if different.

CREATE SCHEMA IF NOT EXISTS `twin` OPTIONS (description = "Twin AI digital twin data");

-- Raw machine telemetry (Pub/Sub → BigQuery subscription or batch loads)
CREATE TABLE IF NOT EXISTS `twin.telemetry` (
  factory_id STRING NOT NULL,
  asset_id STRING NOT NULL,
  ts TIMESTAMP NOT NULL,
  vibration_mm_s FLOAT64,
  temperature_c FLOAT64,
  power_kw FLOAT64,
  speed_pct FLOAT64,
  throughput_uph FLOAT64,
  running BOOL,
  source STRING
)
PARTITION BY DATE(ts)
CLUSTER BY factory_id, asset_id;

-- Hourly production roll-ups per line
CREATE TABLE IF NOT EXISTS `twin.production_events` (
  factory_id STRING NOT NULL,
  line_id STRING NOT NULL,
  hour_start TIMESTAMP NOT NULL,
  planned_hours FLOAT64,
  run_hours FLOAT64,
  planned_down_hours FLOAT64,
  unplanned_down_hours FLOAT64,
  changeover_hours FLOAT64,
  starved_hours FLOAT64,
  ideal_units FLOAT64,
  good_units FLOAT64,
  scrap_units FLOAT64,
  target_units FLOAT64,
  energy_kwh FLOAT64,
  idle_energy_kwh FLOAT64
)
PARTITION BY DATE(hour_start)
CLUSTER BY factory_id, line_id;

-- Daily machine health history
CREATE TABLE IF NOT EXISTS `twin.machine_health_history` (
  factory_id STRING NOT NULL,
  asset_id STRING NOT NULL,
  day DATE NOT NULL,
  health_score FLOAT64,
  status STRING,
  vibration_mm_s FLOAT64,
  temperature_c FLOAT64
)
PARTITION BY day
CLUSTER BY factory_id, asset_id;

-- Scenario outcomes (mirrored by the app for every recorded scenario run)
CREATE TABLE IF NOT EXISTS `twin.scenario_outcomes` (
  run_id STRING NOT NULL,
  factory_id STRING NOT NULL,
  created_at TIMESTAMP NOT NULL,
  scenario_id STRING NOT NULL,
  scenario_name STRING,
  target_asset_id STRING,
  score FLOAT64,
  total_output FLOAT64,
  late_units FLOAT64,
  operating_cost FLOAT64,
  energy_kwh FLOAT64,
  scrap_units FLOAT64,
  failure_hour FLOAT64,
  params_json STRING
)
PARTITION BY DATE(created_at);

-- Human decisions on recommendations (mirrored by the app)
CREATE TABLE IF NOT EXISTS `twin.decisions` (
  recommendation_id STRING NOT NULL,
  factory_id STRING NOT NULL,
  decided_at TIMESTAMP NOT NULL,
  status STRING,
  decided_by STRING,
  note STRING,
  scenario_id STRING,
  title STRING
)
PARTITION BY DATE(decided_at);
