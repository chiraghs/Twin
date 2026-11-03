"""Unit tests for rolling feature extraction pipeline."""
from backend.features.predictive_maintenance.feature_engineering.pipeline import FeatureEngineeringPipeline
from backend.features.predictive_maintenance.simulator.generator import IndustrialSensorSimulator


def test_feature_extraction():
    sim = IndustrialSensorSimulator(num_machines=3, seed=42)
    raw = []
    for _ in range(10):
        raw.extend([r.model_dump() for r in sim.generate_tick()])
    
    features = FeatureEngineeringPipeline.extract_features(raw, window_size=3)
    assert len(features) > 0

    first = features[0] if isinstance(features, list) else features.iloc[0].to_dict()
    assert "roll_mean_vib" in first
    assert "roll_mean_temp" in first
    assert "friction_indicator" in first
    assert "stability_index" in first
