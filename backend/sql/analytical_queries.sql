-- Analytical Query 1: Top 5 Highest Risk Assets Across Plants
SELECT 
    p.machine_id,
    p.risk_category,
    p.failure_probability,
    p.recommended_action,
    r.plant_id,
    r.vibration_mm_s,
    r.temperature_celsius
FROM `twin-predictive-maintenance.predictive_maintenance.machine_predictions` p
JOIN `twin-predictive-maintenance.predictive_maintenance.machine_readings` r
  ON p.machine_id = r.machine_id AND DATE(p.prediction_timestamp) = DATE(r.timestamp)
WHERE p.prediction_timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
ORDER BY p.failure_probability DESC
LIMIT 5;

-- Analytical Query 2: Fleet Reliability & Scrap Risk Aggregated by Plant
SELECT 
    plant_id,
    COUNT(DISTINCT machine_id) as total_machines,
    AVG(temperature_celsius) as plant_avg_temperature,
    AVG(vibration_mm_s) as plant_avg_vibration,
    COUNTIF(vibration_mm_s > 4.5) as machines_in_degraded_zone
FROM `twin-predictive-maintenance.predictive_maintenance.machine_readings`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY plant_id;
