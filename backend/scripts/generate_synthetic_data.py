"""CLI script generating simulated dataset for offline exploration."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.features.predictive_maintenance.ml.training.dataset_generator import generate_training_dataset

if __name__ == "__main__":
    out_file = Path("data/synthetic_fleet_training.csv")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    df = generate_training_dataset(num_machines=25, num_ticks=100)
    df.to_csv(out_file, index=False)
    print(f"Generated {len(df)} records saved to {out_file}")
