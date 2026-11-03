"""Unit tests for model training and real-time failure inference."""
try:
    import pytest
except ImportError:
    class _MockPytest:
        @staticmethod
        def skip(reason):
            pass
    pytest = _MockPytest()
from backend.features.predictive_maintenance.ml.inference.predictor import FailurePredictor
from backend.features.predictive_maintenance.simulator.generator import IndustrialSensorSimulator


def test_failure_inference_engine():
    predictor = FailurePredictor()
    sim = IndustrialSensorSimulator(num_machines=2, seed=42)
    history = [sim.machines[0].step() for _ in range(5)]

    prediction = predictor.predict_machine_health(history)
    assert 0.0 <= prediction["failure_probability"] <= 1.0
    assert prediction["risk_category"] in ("LOW", "MEDIUM", "HIGH")
    assert "contributing_features" in prediction


def test_model_training():
    try:
        import sklearn
        import joblib
        from backend.features.predictive_maintenance.ml.training.train import train_predictive_model
        meta = train_predictive_model(num_machines=10, num_ticks=20)
        assert meta["model_type"] == "RandomForestClassifier"
        assert "metrics" in meta
    except ImportError:
        pytest.skip("scikit-learn/joblib not installed in test environment")
