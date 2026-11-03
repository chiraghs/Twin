"""Model training script comparing Random Forest and Gradient Boosting with class balancing."""
import os
import json
import joblib
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from backend.features.predictive_maintenance.ml.training.dataset_generator import generate_training_dataset
from backend.features.predictive_maintenance.feature_engineering.pipeline import FeatureEngineeringPipeline
from backend.features.predictive_maintenance.ml.evaluation.metrics import ModelEvaluator

ARTIFACTS_DIR = Path(__file__).resolve().parent.parent / "artifacts"
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)


def train_predictive_model(num_machines: int = 35, num_ticks: int = 200) -> dict:
    """Trains a Random Forest classifier with balanced class weights to detect imminent failure."""
    print("Generating synthetic manufacturing dataset...")
    df = generate_training_dataset(num_machines=num_machines, num_ticks=num_ticks, seed=42)

    feature_cols = FeatureEngineeringPipeline.get_feature_columns()
    X = df[feature_cols].fillna(0.0)
    y = df["failure_within_24h"]

    # Stratified split to preserve class imbalance ratios
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=42, stratify=y
    )

    print(f"Dataset: {len(X)} rows. Training: {len(X_train)} (Positive labels: {sum(y_train)}), Test: {len(X_test)} (Positive labels: {sum(y_test)})")

    # Algorithm Selection: Random Forest handles non-linear multi-sensor thresholds well
    # class_weight='balanced' offsets the rare failure rate (~5-15%)
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=8,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )

    model.fit(X_train, y_train)

    # Evaluation on unseen test split
    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    metrics = ModelEvaluator.evaluate(y_test, y_pred, y_prob)
    print("Evaluation Results:", json.dumps(metrics, indent=2))

    # Feature Importance
    importances = dict(zip(feature_cols, [round(float(v), 4) for v in model.feature_importances_]))
    sorted_importances = dict(sorted(importances.items(), key=lambda x: x[1], reverse=True))

    metadata = {
        "model_type": "RandomForestClassifier",
        "prediction_horizon": "24_HOURS",
        "feature_columns": feature_cols,
        "feature_importances": sorted_importances,
        "metrics": metrics,
    }

    # Save artifacts
    model_file = ARTIFACTS_DIR / "model.joblib"
    meta_file = ARTIFACTS_DIR / "metadata.json"

    joblib.dump(model, model_file)
    with open(meta_file, "w") as f:
        json.dump(metadata, f, indent=2)

    print(f"Saved trained model artifact to {model_file}")
    from backend.features.predictive_maintenance.ml.registry.model_registry import LocalModelRegistry
    entry = LocalModelRegistry(ARTIFACTS_DIR).register(model_file, metadata)
    print(f"Registered as version {entry['version']} (candidate, sha256 {entry['sha256'][:12]}); promote with a human approval.")
    metadata["registry"] = entry
    return metadata


if __name__ == "__main__":
    train_predictive_model()
