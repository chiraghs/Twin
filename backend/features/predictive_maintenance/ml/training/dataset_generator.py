"""Generates high-fidelity synthetic training and evaluation datasets without data leakage."""
import pandas as pd
from backend.features.predictive_maintenance.simulator.generator import IndustrialSensorSimulator
from backend.features.predictive_maintenance.feature_engineering.pipeline import FeatureEngineeringPipeline


def generate_training_dataset(num_machines: int = 30, num_ticks: int = 250, seed: int = 101) -> pd.DataFrame:
    """Generates time-series sensor history across normal, degrading, and failure states."""
    simulator = IndustrialSensorSimulator(num_machines=num_machines, seed=seed)
    all_readings = []

    for _ in range(num_ticks):
        readings = simulator.generate_tick(elapsed_minutes=15.0)
        for r in readings:
            all_readings.append(r.model_dump())

    df = pd.DataFrame(all_readings)
    # Transform with feature engineering pipeline
    features_df = FeatureEngineeringPipeline.extract_features(df, window_size=5)
    return features_df
