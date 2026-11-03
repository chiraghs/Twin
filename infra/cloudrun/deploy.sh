#!/usr/bin/env bash
# Deploy Twin AI to Cloud Run from source (uses the repository Dockerfile).
# Prerequisites: gcloud CLI authenticated, billing enabled, and the Meta Model API key stored once:
#   printf %s "$MODEL_API_KEY" | gcloud secrets create twin-model-api-key --data-file=- --project "$GOOGLE_CLOUD_PROJECT"
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:?set GOOGLE_CLOUD_PROJECT}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-twin-ai}"
SA_NAME="${SA_NAME:-twin-runtime}"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  bigquery.googleapis.com pubsub.googleapis.com storage.googleapis.com secretmanager.googleapis.com \
  --project "$PROJECT"

# Least-privilege runtime identity
gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name "Twin runtime"
for ROLE in roles/secretmanager.secretAccessor roles/bigquery.dataEditor roles/bigquery.jobUser roles/pubsub.subscriber roles/storage.objectViewer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:${SA}" --role "$ROLE" --condition=None >/dev/null
done

# max-instances=1 because demo state is kept per instance (see README → Limitations)
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --service-account "$SA" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 120 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT},META_MODEL=${META_MODEL:-muse-spark-1.3},META_REASONING_MODEL=${META_REASONING_MODEL:-muse-wonder-1.0},BIGQUERY_DATASET=${BIGQUERY_DATASET:-},GCS_BUCKET=${GCS_BUCKET:-},PUBSUB_TELEMETRY_SUBSCRIPTION=${PUBSUB_TELEMETRY_SUBSCRIPTION:-},TELEMETRY_SOURCE=${TELEMETRY_SOURCE:-simulated}" \
  --set-secrets "MODEL_API_KEY=twin-model-api-key:latest"

gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)'
