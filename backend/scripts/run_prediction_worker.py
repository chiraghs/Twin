import sys
from pathlib import Path
_repo_root = str(Path(__file__).resolve().parent.parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

import time
import logging
from datetime import datetime, timedelta
from backend.features.predictive_maintenance.ml.inference.predictor import FailurePredictor
from backend.features.predictive_maintenance.repositories.local_mock_repo import LocalMockMachineRepository

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("worker.prediction")


def run_prediction_loop(interval_seconds: float = 10.0, max_iterations: int = 5) -> None:
    logger.info("Starting Predictive Maintenance Inference Worker...")
    repo = LocalMockMachineRepository()
    predictor = FailurePredictor()
    last_alert_times = {}

    for iteration in range(max_iterations):
        logger.info(f"--- Prediction Run #{iteration + 1} ---")
        machines = repo.simulator.machines

        for machine in machines:
            history = repo.history.get(machine.machine_id, [])
            prediction = predictor.predict_machine_health(history)

            prediction_record = {
                "prediction_id": f"PRED-{machine.machine_id}-{int(time.time())}",
                "machine_id": machine.machine_id,
                "prediction_timestamp": datetime.utcnow().isoformat(),
                "prediction_horizon_hours": 24,
                "failure_probability": prediction["failure_probability"],
                "risk_category": prediction["risk_category"],
                "contributing_features": prediction["contributing_features"],
                "recommended_action": prediction["recommended_action"],
                "model_version": prediction["model_version"],
            }

            repo.predictions[machine.machine_id] = prediction_record

            # Deduplication & Cooldown logic for High-Risk Alerts
            if prediction["risk_category"] == "HIGH":
                last_alert = last_alert_times.get(machine.machine_id)
                now = datetime.utcnow()
                if last_alert is None or (now - last_alert) > timedelta(minutes=30):
                    last_alert_times[machine.machine_id] = now
                    logger.warning(
                        f"🚨 [HIGH RISK ALERT] Machine {machine.machine_id}: Failure Probability={prediction['failure_probability']:.1%}. "
                        f"Action: {prediction['recommended_action']}"
                    )

        time.sleep(interval_seconds)

    logger.info("Prediction loop completed.")


if __name__ == "__main__":
    run_prediction_loop(interval_seconds=1.0, max_iterations=2)
