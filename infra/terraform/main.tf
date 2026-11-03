terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# 1. Pub/Sub Topic and Dead Letter
resource "google_pubsub_topic" "machine_readings" {
  name = "machine-readings"
}

resource "google_pubsub_topic" "dead_letter" {
  name = "machine-readings-dead-letter"
}

resource "google_pubsub_subscription" "pipeline_sub" {
  name  = "machine-readings-sub"
  topic = google_pubsub_topic.machine_readings.name

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 5
  }
}

# 2. BigQuery Dataset
resource "google_bigquery_dataset" "pm_dataset" {
  dataset_id  = var.dataset_id
  location    = var.region
  description = "Storage for industrial telemetry, rolling features, and predictive failure scores"
}

# 3. Cloud Storage for ML Models & Dataflow Staging
resource "google_storage_bucket" "model_artifacts" {
  name          = "${var.project_id}-pm-artifacts"
  location      = var.region
  force_destroy = true
  uniform_bucket_level_access = true
}

# 4. IAM Service Account for Dataflow Runner
resource "google_service_account" "dataflow_sa" {
  account_id   = "pm-dataflow-runner"
  display_name = "Predictive Maintenance Dataflow Service Account"
}

resource "google_project_iam_member" "dataflow_worker" {
  project = var.project_id
  role    = "roles/dataflow.worker"
  member  = "serviceAccount:${google_service_account.dataflow_sa.email}"
}

resource "google_project_iam_member" "bq_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.dataflow_sa.email}"
}
