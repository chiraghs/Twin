# ==============================================================================
# Visual Quality Inspection Infrastructure (hosting + data adapters; AI is Meta Model API)
# Provisions:
# 1. Cloud Storage Buckets (Raw frames, golden templates, defect heatmaps)
# 2. BigQuery Dataset & Partitioned / Clustered Lakehouse Tables
# 3. Cloud Pub/Sub Topics & Subscriptions (Quality inspection events, defect alerts)
# 4. Cloud Run Service (FastAPI container calling Meta Model API: Muse Spark + SAM 3.1)
# 5. Cloud Scheduler (Hourly FPY & DPMO aggregation cron)
# 6. IAM Least-Privilege Service Accounts
# ==============================================================================

# 1. Cloud Storage Bucket for Inspection Imagery & Golden Templates
resource "google_storage_bucket" "visual_inspection_bucket" {
  name                        = "${var.project_id}-visual-inspection-${var.environment}"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  lifecycle_rule {
    condition {
      age = 60 # Retain raw inspection frames for 60 days
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 180
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    environment = var.environment
    workload    = "visual-quality-inspection"
  }
}

# 2. BigQuery Dataset: visual_quality_lakehouse
resource "google_bigquery_dataset" "visual_quality" {
  dataset_id                  = "visual_quality_lakehouse"
  friendly_name               = "Automated Optical Quality Inspection Lakehouse"
  description                 = "Stores raw inspection events, IPC-A-610 defect detections, golden templates, and auditor dispositions"
  location                    = var.region
  default_table_expiration_ms = null # Permanent compliance history

  labels = {
    environment = var.environment
    workload    = "visual-quality-inspection"
  }
}

# 3. Pub/Sub Topics: Quality Events & Defect Alerts
resource "google_pubsub_topic" "quality_inspection_events" {
  name = "quality-inspection-events"

  labels = {
    environment = var.environment
    workload    = "visual-quality-inspection"
  }
}

resource "google_pubsub_topic" "quality_defect_alerts" {
  name = "quality-defect-alerts"

  labels = {
    environment = var.environment
    workload    = "visual-quality-inspection"
  }
}

resource "google_pubsub_subscription" "quality_events_sub" {
  name  = "quality-inspection-events-sub"
  topic = google_pubsub_topic.quality_inspection_events.name

  ack_deadline_seconds = 30
}

resource "google_pubsub_subscription" "quality_alerts_sub" {
  name  = "quality-defect-alerts-sub"
  topic = google_pubsub_topic.quality_defect_alerts.name

  ack_deadline_seconds = 20
}

# 4. IAM Service Account for Visual Quality Inspection Service
resource "google_service_account" "quality_service_sa" {
  account_id   = "quality-inspection-sa"
  display_name = "Visual Quality Inspection Cloud Run Service Account"
}

# Meta Model API key (Muse Spark, SAM 3.1), stored in Secret Manager and injected as MODEL_API_KEY.
resource "google_secret_manager_secret" "meta_model_api_key" {
  secret_id = "twin-model-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "quality_meta_key_accessor" {
  secret_id = google_secret_manager_secret.meta_model_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.quality_service_sa.email}"
}

resource "google_project_iam_member" "quality_bigquery_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.quality_service_sa.email}"
}

resource "google_project_iam_member" "quality_bigquery_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.quality_service_sa.email}"
}

resource "google_project_iam_member" "quality_storage_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.quality_service_sa.email}"
}

resource "google_project_iam_member" "quality_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.quality_service_sa.email}"
}

# 5. Cloud Run Service: Visual Quality Backend
resource "google_cloud_run_v2_service" "visual_quality_service" {
  name     = "visual-quality-service"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.quality_service_sa.email

    containers {
      image = "gcr.io/${var.project_id}/visual-quality-backend:latest"

      resources {
        limits = {
          cpu    = "2000m"
          memory = "4Gi"
        }
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "BIGQUERY_DATASET"
        value = google_bigquery_dataset.visual_quality.dataset_id
      }
      env {
        name  = "GCS_IMAGE_BUCKET"
        value = google_storage_bucket.visual_inspection_bucket.name
      }
      env {
        name  = "PUBSUB_QUALITY_TOPIC"
        value = google_pubsub_topic.quality_inspection_events.name
      }
      env {
        name  = "META_MODEL"
        value = "muse-spark-1.3"
      }
      env {
        name  = "META_SEGMENTATION_MODEL"
        value = "sam-3.1"
      }
      env {
        name = "MODEL_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.meta_model_api_key.secret_id
            version = "latest"
          }
        }
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }
  }
}

# 6. Cloud Scheduler: Hourly Quality FPY & DPMO Rollup Job
resource "google_cloud_scheduler_job" "quality_hourly_rollup" {
  name             = "quality-hourly-rollup"
  description      = "Aggregates hourly First-Pass Yield (FPY) and DPMO from fact_inspection_events into fact_quality_kpis_hourly"
  schedule         = "0 * * * *"
  time_zone        = "Etc/UTC"
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.visual_quality_service.uri}/quality/kpis/rollup"

    oidc_token {
      service_account_email = google_service_account.quality_service_sa.email
    }
  }
}
