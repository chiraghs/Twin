-- ==============================================================================
-- Google Cloud BigQuery Lakehouse Schema: Visual Quality Inspection
-- Dataset: visual_quality_lakehouse
-- Fully Partitioned & Clustered for High-Throughput Manufacturing Analytics
-- ==============================================================================

-- 1. Dim: Golden Reference Templates
CREATE TABLE IF NOT EXISTS `visual_quality_lakehouse.dim_golden_templates` (
    template_id STRING NOT NULL,
    part_number STRING NOT NULL,
    revision STRING NOT NULL,
    gcs_template_uri STRING NOT NULL,
    keypoints_count INT64,
    similarity_tolerance_pct FLOAT64 NOT NULL,
    registered_at TIMESTAMP NOT NULL,
    registered_by STRING,
    is_active_baseline BOOL DEFAULT TRUE
)
CLUSTER BY part_number, revision;

-- 2. Dim: Governed IPC-A-610 Defect Catalog
CREATE TABLE IF NOT EXISTS `visual_quality_lakehouse.dim_defect_catalog` (
    defect_class STRING NOT NULL,
    ipc_standard_section STRING NOT NULL,
    class_2_criteria_description STRING NOT NULL,
    standard_severity STRING NOT NULL, -- CRITICAL | HIGH | MEDIUM | MINOR
    requires_line_halt BOOL DEFAULT FALSE,
    estimated_rework_cost_usd FLOAT64
);

-- 3. Fact: Optical Inspection Events (Primary Lakehouse Event Stream)
CREATE TABLE IF NOT EXISTS `visual_quality_lakehouse.fact_inspection_events` (
    inspection_id STRING NOT NULL,
    camera_id STRING NOT NULL,
    part_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    line_id STRING NOT NULL,
    inspection_timestamp TIMESTAMP NOT NULL,
    verdict STRING NOT NULL, -- PASS | FAIL | REVIEW_REQUIRED | OVERRIDDEN_PASS | OVERRIDDEN_FAIL
    similarity_score_to_golden FLOAT64 NOT NULL,
    defects_count INT64 NOT NULL,
    raw_image_uri STRING,
    annotated_overlay_uri STRING,
    barcode_decoded STRING,
    barcode_grade STRING,
    detector STRING,                 -- e.g. 'muse-spark-1.3 + sam-3.1' or 'local-reference'
    advisory_summary STRING,
    advisory_probable_root_cause STRING,
    advisory_containment_action STRING,
    advisory_generated_by STRING,     -- Muse model id or 'deterministic'
    human_disposition_status STRING DEFAULT 'PENDING_REVIEW',
    alignment_latency_ms FLOAT64,
    detection_latency_ms FLOAT64,
    ocr_latency_ms FLOAT64,
    reasoning_latency_ms FLOAT64,
    total_pipeline_latency_ms FLOAT64
)
PARTITION BY DATE(inspection_timestamp)
CLUSTER BY plant_id, line_id, verdict;

-- 4. Fact: Granular Defect Detections
CREATE TABLE IF NOT EXISTS `visual_quality_lakehouse.fact_defect_detections` (
    detection_id STRING NOT NULL,
    inspection_id STRING NOT NULL,
    inspection_timestamp TIMESTAMP NOT NULL,
    defect_class STRING NOT NULL,
    confidence FLOAT64 NOT NULL,
    bbox_x INT64 NOT NULL,
    bbox_y INT64 NOT NULL,
    bbox_width INT64 NOT NULL,
    bbox_height INT64 NOT NULL,
    severity STRING NOT NULL,
    ipc_clause STRING,
    detection_source STRING NOT NULL, -- MUSE_SPARK_SAM | LOCAL_REFERENCE_MODEL | OPENCV_DIFFERENTIAL | HYBRID_ENSEMBLE
    area_pixels INT64
)
PARTITION BY DATE(inspection_timestamp)
CLUSTER BY defect_class, severity;

-- 5. Fact: Hourly Rolled Quality KPIs (FPY & DPMO)
CREATE TABLE IF NOT EXISTS `visual_quality_lakehouse.fact_quality_kpis_hourly` (
    inspection_date DATE NOT NULL,
    hour_of_day INT64 NOT NULL,
    line_id STRING NOT NULL,
    plant_id STRING NOT NULL,
    total_inspected INT64 NOT NULL,
    defective_count INT64 NOT NULL,
    first_pass_yield_pct FLOAT64 NOT NULL,
    dpmo FLOAT64 NOT NULL,
    scrap_cost_usd FLOAT64 NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY inspection_date
CLUSTER BY line_id, plant_id;

-- 6. Fact: Human Review Disposition & Auditor Compliance Trail
CREATE TABLE IF NOT EXISTS `visual_quality_lakehouse.fact_human_disposition_audit` (
    audit_id STRING NOT NULL,
    inspection_id STRING NOT NULL,
    disposition_timestamp TIMESTAMP NOT NULL,
    auditor_id STRING NOT NULL,
    action STRING NOT NULL, -- CONFIRM_DEFECT | DISMISS_DEFECT | OVERRIDE_PASS | RECLASSIFY
    prior_verdict STRING NOT NULL,
    final_verdict STRING NOT NULL,
    auditor_rationale STRING NOT NULL
)
PARTITION BY DATE(disposition_timestamp)
CLUSTER BY auditor_id, action;

-- 7. Fact: Detector feedback (precision measured from human dispositions)
CREATE TABLE IF NOT EXISTS `visual_quality_lakehouse.fact_detector_feedback` (
    computed_at TIMESTAMP NOT NULL,
    detector STRING NOT NULL,             -- e.g. 'muse-spark-1.3 + sam-3.1'
    reviewed_inspections INT64 NOT NULL,
    confirmed_defects INT64 NOT NULL,
    dismissed_defects INT64 NOT NULL,
    override_passes INT64 NOT NULL,
    precision FLOAT64,
    recommendation STRING
)
PARTITION BY DATE(computed_at);
