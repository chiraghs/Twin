-- BigQuery DDL: Production Schemas with Partitioning and Clustering

CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.machine_readings` (
    machine_id STRING NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    temperature_celsius FLOAT64 NOT NULL,
    vibration_mm_s FLOAT64 NOT NULL,
    pressure_bar FLOAT64 NOT NULL,
    rpm FLOAT64 NOT NULL,
    operating_hours FLOAT64 NOT NULL,
    machine_type STRING NOT NULL,
    plant_id STRING NOT NULL,
    ingestion_timestamp TIMESTAMP NOT NULL
)
PARTITION BY DATE(timestamp)
CLUSTER BY machine_id, plant_id
OPTIONS(
    description = "Partitioned sensor telemetry stream ingested via Cloud Dataflow"
);

CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.machine_health_features` (
    machine_id STRING NOT NULL,
    window_start TIMESTAMP NOT NULL,
    window_end TIMESTAMP NOT NULL,
    avg_temperature FLOAT64 NOT NULL,
    max_temperature FLOAT64 NOT NULL,
    avg_vibration FLOAT64 NOT NULL,
    max_vibration FLOAT64 NOT NULL,
    std_vibration FLOAT64 NOT NULL,
    avg_pressure FLOAT64 NOT NULL,
    avg_rpm FLOAT64 NOT NULL,
    reading_count INT64 NOT NULL
)
PARTITION BY DATE(window_start)
CLUSTER BY machine_id;

CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.machine_predictions` (
    prediction_id STRING NOT NULL,
    machine_id STRING NOT NULL,
    prediction_timestamp TIMESTAMP NOT NULL,
    prediction_horizon_hours INT64 NOT NULL,
    failure_probability FLOAT64 NOT NULL,
    risk_category STRING NOT NULL,
    contributing_features JSON NOT NULL,
    recommended_action STRING NOT NULL,
    model_version STRING NOT NULL
)
PARTITION BY DATE(prediction_timestamp)
CLUSTER BY risk_category, machine_id;

CREATE TABLE IF NOT EXISTS `twin-predictive-maintenance.predictive_maintenance.failed_or_invalid_events` (
    rejected_at TIMESTAMP NOT NULL,
    raw_payload STRING NOT NULL,
    error_message STRING NOT NULL
)
PARTITION BY DATE(rejected_at);
