#!/usr/bin/env bash
set -e
echo "Starting GCP Predictive Maintenance Platform in Local Mode..."

# 1. Run automated platform verification
echo "Running automated verification tests..."
python3 backend/scripts/run_tests.py

echo ""
echo "🚀 Services Ready!"
echo "• Start Enterprise FastAPI Backend: uvicorn backend.main:app --reload --port 8000"
echo "• Start Streamlit Dashboard: streamlit run dashboard/app.py --server.port 8501"
echo "• Start Prediction Worker: python3 backend/scripts/run_prediction_worker.py"

