# ==============================================================================
# Terraform Infrastructure for GCP Manufacturing Demand Forecasting
# Provisions:
# 1. BigQuery Dataset with table partitioning & clustering
# 2. Cloud Storage bucket for batch ingestion & quarantine storage
# 3. Cloud Pub/Sub topic & subscription for streaming manufacturing events
# 4. Cloud Run service for FastAPI backend deployment
# 5. Cloud Scheduler jobs for automated pipeline triggering
# ==============================================================================

# 1. BigQuery Dataset
resource "google_bigquery_dataset" "demand_forecasting" {
  dataset_id                  = "demand_forecasting"
  friendly_name               = "Manufacturing Demand Forecasting & Operations"
  description                 = "Curated lakehouse dataset for sales orders, production planning, quality, and forecasts"
  location                    = var.region
  default_table_expiration_ms = null # Retain historical analytical data

  labels = {
    environment = var.environment
    workload    = "demand-forecasting"
  }
}

# 2. Cloud Storage Bucket for Ingestion Artifacts & Quarantined Batches
resource "google_storage_bucket" "demand_ingestion_bucket" {
  name                        = "${var.project_id}-demand-ingestion-${var.environment}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  lifecycle_rule {
    condition {
      age = 90
    }
    action {
      type = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  labels = {
    environment = var.environment
    workload    = "demand-forecasting"
  }
}

# 3. Pub/Sub Topic & Subscription for Streaming Manufacturing Events
resource "google_pubsub_topic" "manufacturing_events_topic" {
  name = "manufacturing-demand-events"

  labels = {
    environment = var.environment
    workload    = "demand-forecasting"
  }
}

resource "google_pubsub_subscription" "manufacturing_events_sub" {
  name  = "manufacturing-demand-events-sub"
  topic = google_pubsub_topic.manufacturing_events_topic.name

  ack_deadline_seconds       = 60
  message_retention_duration = "604800s" # 7 days
}

# 4. Cloud Run Service for Backend Application
resource "google_cloud_run_v2_service" "demand_forecasting_backend" {
  name     = "twin-demand-forecasting"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    scaling {
      min_instance_count = 0 # Cost-conscious scale to zero
      max_instance_count = 5
    }

    containers {
      image = "gcr.io/${var.project_id}/twin-backend:latest"

      resources {
        limits = {
          cpu    = "2000m"
          memory = "2Gi"
        }
      }

      env {
        name  = "ENVIRONMENT"
        value = var.environment
      }
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "BIGQUERY_DATASET"
        value = google_bigquery_dataset.demand_forecasting.dataset_id
      }
      env {
        name  = "GCS_INGESTION_BUCKET"
        value = google_storage_bucket.demand_ingestion_bucket.name
      }
    }
  }
}

# 5. Cloud Scheduler: Automated Nightly Forecast & Ingestion Run
resource "google_cloud_scheduler_job" "nightly_forecast_refresh" {
  name             = "nightly-demand-forecast-refresh"
  description      = "Triggers scheduled daily demand forecast refresh and capacity check"
  schedule         = "0 2 * * *" # Daily at 02:00 AM UTC
  time_zone        = "UTC"
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.demand_forecasting_backend.uri}/api/v1/forecasts/run"
    body        = base64encode("{\"product_id\":\"PRD-CNC-5X\",\"plant_id\":\"PLANT_BANGALORE\",\"horizon_days\":30,\"model_type\":\"GRADIENT_BOOSTED_TREES\"}")
    headers = {
      "Content-Type" = "application/json"
    }
  }
}
