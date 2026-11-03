variable "project_id" {
  description = "The Google Cloud Project ID"
  type        = string
  default     = "twin-predictive-maintenance"
}

variable "region" {
  description = "GCP Region for Dataflow and BigQuery storage"
  type        = string
  default     = "asia-southeast1"
}

variable "dataset_id" {
  description = "BigQuery dataset ID"
  type        = string
  default     = "predictive_maintenance"
}
