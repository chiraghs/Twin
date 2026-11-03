"""BigQuery table schemas and partition definitions."""

MACHINE_READINGS_SCHEMA = [
    {"name": "machine_id", "type": "STRING", "mode": "REQUIRED", "description": "Asset identifier"},
    {"name": "timestamp", "type": "TIMESTAMP", "mode": "REQUIRED", "description": "Reading event timestamp"},
    {"name": "temperature_celsius", "type": "FLOAT64", "mode": "REQUIRED", "description": "Temperature in °C"},
    {"name": "vibration_mm_s", "type": "FLOAT64", "mode": "REQUIRED", "description": "Vibration velocity in mm/s RMS"},
    {"name": "pressure_bar", "type": "FLOAT64", "mode": "REQUIRED", "description": "Pressure in bar"},
    {"name": "rpm", "type": "FLOAT64", "mode": "REQUIRED", "description": "Motor RPM"},
    {"name": "operating_hours", "type": "FLOAT64", "mode": "REQUIRED", "description": "Total operating hours"},
    {"name": "machine_type", "type": "STRING", "mode": "REQUIRED", "description": "Machine archetype"},
    {"name": "plant_id", "type": "STRING", "mode": "REQUIRED", "description": "Plant location ID"},
    {"name": "ingestion_timestamp", "type": "TIMESTAMP", "mode": "REQUIRED", "description": "Dataflow ingestion time"},
]

MACHINE_HEALTH_FEATURES_SCHEMA = [
    {"name": "machine_id", "type": "STRING", "mode": "REQUIRED"},
    {"name": "window_start", "type": "TIMESTAMP", "mode": "REQUIRED"},
    {"name": "window_end", "type": "TIMESTAMP", "mode": "REQUIRED"},
    {"name": "avg_temperature", "type": "FLOAT64", "mode": "REQUIRED"},
    {"name": "max_temperature", "type": "FLOAT64", "mode": "REQUIRED"},
    {"name": "avg_vibration", "type": "FLOAT64", "mode": "REQUIRED"},
    {"name": "max_vibration", "type": "FLOAT64", "mode": "REQUIRED"},
    {"name": "std_vibration", "type": "FLOAT64", "mode": "REQUIRED"},
    {"name": "avg_pressure", "type": "FLOAT64", "mode": "REQUIRED"},
    {"name": "avg_rpm", "type": "FLOAT64", "mode": "REQUIRED"},
    {"name": "reading_count", "type": "INT64", "mode": "REQUIRED"},
]

MACHINE_PREDICTIONS_SCHEMA = [
    {"name": "prediction_id", "type": "STRING", "mode": "REQUIRED"},
    {"name": "machine_id", "type": "STRING", "mode": "REQUIRED"},
    {"name": "prediction_timestamp", "type": "TIMESTAMP", "mode": "REQUIRED"},
    {"name": "prediction_horizon_hours", "type": "INT64", "mode": "REQUIRED"},
    {"name": "failure_probability", "type": "FLOAT64", "mode": "REQUIRED"},
    {"name": "risk_category", "type": "STRING", "mode": "REQUIRED"},
    {"name": "contributing_features", "type": "JSON", "mode": "REQUIRED"},
    {"name": "recommended_action", "type": "STRING", "mode": "REQUIRED"},
    {"name": "model_version", "type": "STRING", "mode": "REQUIRED"},
]

DEAD_LETTER_SCHEMA = [
    {"name": "rejected_at", "type": "TIMESTAMP", "mode": "REQUIRED"},
    {"name": "raw_payload", "type": "STRING", "mode": "REQUIRED"},
    {"name": "error_message", "type": "STRING", "mode": "REQUIRED"},
]
