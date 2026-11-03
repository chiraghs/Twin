"""CLI script to trigger model training and artifact generation."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.features.predictive_maintenance.ml.training.train import train_predictive_model

if __name__ == "__main__":
    train_predictive_model()
