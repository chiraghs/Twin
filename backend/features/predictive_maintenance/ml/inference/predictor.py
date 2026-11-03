"""Local and production prediction service executing real-time failure inference."""
import json
from pathlib import Path
from typing import Any, Optional

try:
    import joblib
    HAS_JOBLIB = True
except ImportError:
    HAS_JOBLIB = False

try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

from backend.features.predictive_maintenance.schemas.sensor_reading import SensorReadingEvent
from backend.features.predictive_maintenance.feature_engineering.pipeline import FeatureEngineeringPipeline
from backend.features.predictive_maintenance.config.models import (
    PredictiveMaintenanceConfig,
    maintenance_config_store,
)


class FailurePredictor:
    """Loads model artifacts and evaluates real-time probability of failure and risk categories."""

    def __init__(self, model_path: Optional[str] = None, config_store=None) -> None:
        if model_path is None:
            model_path = str(Path(__file__).resolve().parent.parent / "artifacts" / "model.joblib")
        
        self.model_path = Path(model_path)
        self.config_store = config_store or maintenance_config_store
        self.model = None
        self.metadata = {}
        self._load_model()

    def _load_model(self) -> None:
        if HAS_JOBLIB and self.model_path.exists():
            try:
                self.model = joblib.load(self.model_path)
                meta_path = self.model_path.parent / "metadata.json"
                if meta_path.exists():
                    with open(meta_path, "r") as f:
                        self.metadata = json.load(f)
            except Exception:
                self.model = None
        else:
            self.model = None

    def predict_machine_health(self, readings_history: list[SensorReadingEvent]) -> dict[str, Any]:
        """Calculates failure probability, risk tier, contributing features, and recommended action."""
        if not readings_history:
            return {
                "failure_probability": 0.05,
                "risk_category": "LOW",
                "contributing_features": {},
                "recommended_action": "NORMAL_MONITORING",
                "model_version": "v1.0-baseline",
            }

        # Handle features through pipeline
        records = [r.model_dump() for r in readings_history]
        features = FeatureEngineeringPipeline.extract_features(records, window_size=5)

        if not features or (HAS_PANDAS and isinstance(features, pd.DataFrame) and features.empty):
            return self._heuristic_fallback(readings_history[-1])

        # Get latest feature row
        if HAS_PANDAS and isinstance(features, pd.DataFrame):
            latest_row = features.iloc[-1].to_dict()
        elif isinstance(features, list):
            latest_row = features[-1]
        else:
            latest_row = {}

        roll_mean_vib = latest_row.get("roll_mean_vib", readings_history[-1].vibration_mm_s)
        roll_max_temp = latest_row.get("roll_max_temp", readings_history[-1].temperature_celsius)
        friction = latest_row.get("friction_indicator", (roll_mean_vib * roll_max_temp) / 100.0)
        stability = latest_row.get("stability_index", 1500.0 / (roll_mean_vib + 0.1))

        if self.model is not None and HAS_PANDAS:
            feature_cols = FeatureEngineeringPipeline.get_feature_columns()
            df_feat = pd.DataFrame([latest_row])[feature_cols].fillna(0.0)
            prob = float(self.model.predict_proba(df_feat)[0][1])
        else:
            cfg = self.config_store.get_config()
            zone_d = cfg.iso_thresholds.zone_c_unsatisfactory_max
            zone_c = cfg.iso_thresholds.zone_b_acceptable_max
            zone_b = cfg.iso_thresholds.zone_a_good_max
            overheat_thresh = cfg.overheating_temperature_threshold
            high_risk_thresh = cfg.high_risk_probability_threshold
            med_risk_thresh = cfg.medium_risk_probability_threshold

            # Dynamic empirical failure probability curve based on configurable ISO 10816 thresholds
            if roll_mean_vib > zone_d:
                prob = min(0.99, 0.75 + (roll_mean_vib - zone_d) * 0.1)
            elif roll_mean_vib > zone_c:
                span = max(0.1, zone_d - zone_c)
                prob = 0.35 + ((roll_mean_vib - zone_c) / span) * 0.35
            elif roll_mean_vib > zone_b:
                span = max(0.1, zone_c - zone_b)
                prob = 0.10 + ((roll_mean_vib - zone_b) / span) * 0.25
            else:
                prob = max(0.02, roll_mean_vib * (0.10 / max(0.1, zone_b)))

            # Thermal boost if overheating (> configurable threshold)
            if roll_max_temp > overheat_thresh:
                prob = min(0.99, prob + 0.20)

        prob = round(float(prob), 3)

        # Risk Classification driven dynamically by configuration
        cfg = self.config_store.get_config()
        if prob >= cfg.high_risk_probability_threshold:
            category = "HIGH"
            action = "IMMEDIATE_SHUTDOWN: Bearing vibration exceeds ISO Zone D. Overhaul immediately."
        elif prob >= cfg.medium_risk_probability_threshold:
            category = "MEDIUM"
            action = "INSPECT_NEXT_SHIFT: Elevated thermal/vibration drift detected. Lubricate and re-align."
        else:
            category = "LOW"
            action = "NORMAL_OPERATION: Machine running within nominal operating envelope."

        contributions = {
            "roll_mean_vib": round(float(roll_mean_vib), 2),
            "roll_max_temp": round(float(roll_max_temp), 1),
            "friction_indicator": round(float(friction), 2),
            "stability_index": round(float(stability), 1),
        }

        return {
            "failure_probability": prob,
            "risk_category": category,
            "contributing_features": contributions,
            "recommended_action": action,
            "model_version": self.metadata.get("model_type", "RandomForest-v1 (Empirical Fallback)"),
        }

    def _heuristic_fallback(self, latest: SensorReadingEvent) -> dict[str, Any]:
        cfg = self.config_store.get_config()
        vib = latest.vibration_mm_s
        zone_d = cfg.iso_thresholds.zone_c_unsatisfactory_max
        zone_c = cfg.iso_thresholds.zone_b_acceptable_max
        high_risk_thresh = cfg.high_risk_probability_threshold
        med_risk_thresh = cfg.medium_risk_probability_threshold

        prob = 0.85 if vib > zone_d else (0.45 if vib > zone_c else 0.05)
        cat = "HIGH" if prob >= high_risk_thresh else ("MEDIUM" if prob >= med_risk_thresh else "LOW")
        return {
            "failure_probability": prob,
            "risk_category": cat,
            "contributing_features": {"vibration_mm_s": vib, "temperature_celsius": latest.temperature_celsius},
            "recommended_action": "INSPECT: Sensor values anomalous" if cat != "LOW" else "NORMAL_OPERATION",
            "model_version": "heuristic-fallback",
        }
