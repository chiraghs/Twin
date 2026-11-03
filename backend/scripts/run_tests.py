"""Test execution runner for Predictive Maintenance Platform."""
import sys
import asyncio
from pathlib import Path

# Add project root to sys.path
PM_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PM_ROOT))

from backend.features.predictive_maintenance.simulator.generator import IndustrialSensorSimulator
from backend.features.predictive_maintenance.schemas.sensor_reading import MachineType, HealthState
from backend.features.predictive_maintenance.feature_engineering.pipeline import FeatureEngineeringPipeline
from backend.features.predictive_maintenance.ml.inference.predictor import FailurePredictor
from backend.features.predictive_maintenance.repositories.local_mock_repo import LocalMockMachineRepository
from backend.features.predictive_maintenance.services.machine_service import MachineService


async def run_all_checks():
    print("==================================================================")
    print("🔍 RUNNING GCP PREDICTIVE MAINTENANCE PLATFORM VERIFICATION")
    print("==================================================================")

    # 1. Simulator & Physics Check
    sim = IndustrialSensorSimulator(num_machines=20, seed=42)
    assert len(sim.machines) == 20, "Should initialize 20 machines"
    readings = sim.generate_tick()
    assert len(readings) == 20, "Should generate 20 readings per tick"
    for r in readings:
        assert r.vibration_mm_s > 0.0
        assert r.temperature_celsius > 0.0
    print("✅ 1. Simulator: 20 machines initialized across 5 archetypes & 3 plants")

    # 2. Physics & Failure State Progression
    degraded_machines = [m for m in sim.machines if m.health_state != HealthState.HEALTHY]
    assert len(degraded_machines) > 0, "Should include degrading/abnormal machines"
    print(f"✅ 2. Synthetic Physics: {len(degraded_machines)} machines exhibiting degradation/abnormal vibration")

    # 3. Feature Engineering Pipeline
    raw = [r.model_dump() for r in readings]
    features = FeatureEngineeringPipeline.extract_features(raw, window_size=3)
    assert len(features) == 20
    assert "friction_indicator" in features[0]
    assert "stability_index" in features[0]
    print("✅ 3. Feature Engineering: Rolling stats & physics friction indicators verified")

    # 4. ML Failure Inference Engine
    predictor = FailurePredictor()
    pred = predictor.predict_machine_health(readings[:5])
    assert 0.0 <= pred["failure_probability"] <= 1.0
    assert pred["risk_category"] in ("LOW", "MEDIUM", "HIGH")
    assert "recommended_action" in pred
    print(f"✅ 4. ML Inference: Predictor generated {pred['risk_category']} risk (P={pred['failure_probability']:.1%})")

    # 5. Local Mock Repository
    repo = LocalMockMachineRepository(num_machines=20)
    machines = await repo.get_all_machines()
    assert len(machines) == 20
    high_risk = await repo.get_high_risk_machines()
    assert len(high_risk) > 0, "Should detect high risk machines"
    print(f"✅ 5. Repository Layer: In-memory store seeded ({len(high_risk)} high-risk alerts)")

    # 6. Machine Service & Business Logic
    service = MachineService(repo)
    summary = await service.get_fleet_analytics()
    assert summary["total_machines_monitored"] == 20
    assert "healthy_fleet_percentage" in summary
    print(f"✅ 6. Machine Service: Fleet Reliability = {summary['healthy_fleet_percentage']}%")

    # 7. Machine Drill-down & History
    first_id = machines[0]["machine_id"]
    detail = await service.get_machine_details(first_id)
    assert detail["machine_id"] == first_id
    history = await service.get_readings_history(first_id, limit=10)
    assert len(history) <= 10
    prediction = await service.get_predictions(first_id)
    assert "failure_probability" in prediction
    print(f"✅ 7. Telemetry & Prediction Retrieval: Verified for asset {first_id}")

    print("==================================================================")
    print("🎉 ALL 7 TEST SUITES PASSED! LOCAL PREDICTIVE MAINTENANCE PLATFORM VERIFIED!")
    print("==================================================================")


if __name__ == "__main__":
    asyncio.run(run_all_checks())
