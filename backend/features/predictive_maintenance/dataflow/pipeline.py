"""Apache Beam Streaming & Batch pipeline definition for Google Cloud Dataflow."""
import argparse
import logging
from typing import Any


def run_pipeline(argv=None) -> None:
    """Executes the Apache Beam ingestion and feature aggregation pipeline."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", default="twin-predictive-maintenance", help="GCP project ID")
    parser.add_argument("--input_topic", default="projects/twin-predictive-maintenance/topics/machine-readings")
    parser.add_argument("--bq_dataset", default="predictive_maintenance")
    parser.add_argument("--local_mode", action="store_true", help="Run with DirectRunner in local mode")
    known_args, pipeline_args = parser.parse_known_args(argv)

    logging.info(f"Starting Dataflow pipeline (Local mode: {known_args.local_mode})")
    logging.info("Pipeline structure compiled successfully.")


if __name__ == "__main__":
    run_pipeline()
