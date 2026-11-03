output "pubsub_topic" {
  value = google_pubsub_topic.machine_readings.id
}

output "bigquery_dataset" {
  value = google_bigquery_dataset.pm_dataset.dataset_id
}

output "storage_bucket" {
  value = google_storage_bucket.model_artifacts.name
}
