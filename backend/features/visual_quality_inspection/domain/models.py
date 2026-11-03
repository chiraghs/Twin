"""Domain models and defect classifications for visual optical inspection (Meta Model API vision)."""
from enum import Enum
from typing import Optional
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from backend.core.interfaces.base import BaseValueObject


class InspectionVerdict(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    OVERRIDDEN_PASS = "OVERRIDDEN_PASS"
    OVERRIDDEN_FAIL = "OVERRIDDEN_FAIL"


class DefectClass(str, Enum):
    SOLDER_BRIDGE = "SOLDER_BRIDGE"
    TOMBSTONING = "TOMBSTONING"
    COMPONENT_MISALIGNMENT = "COMPONENT_MISALIGNMENT"
    MISSING_PART = "MISSING_PART"
    LIFTED_LEAD = "LIFTED_LEAD"
    SOLDER_BALLS = "SOLDER_BALLS"
    POLARITY_ERROR = "POLARITY_ERROR"
    INSUFFICIENT_SOLDER = "INSUFFICIENT_SOLDER"
    SURFACE_SCRATCH = "SURFACE_SCRATCH"
    FOREIGN_OBJECT_DEBRIS = "FOREIGN_OBJECT_DEBRIS"
    BARCODE_UNREADABLE = "BARCODE_UNREADABLE"


class InferenceSource(str, Enum):
    MUSE_SPARK_SAM = "MUSE_SPARK_SAM"  # Muse Spark classification, SAM 3.1 localisation
    LOCAL_REFERENCE_MODEL = "LOCAL_REFERENCE_MODEL"  # deterministic reference detector (offline / no image)
    OPENCV_DIFFERENTIAL = "OPENCV_DIFFERENTIAL"
    MUSE_SPARK_OCR = "MUSE_SPARK_OCR"
    HYBRID_ENSEMBLE = "HYBRID_ENSEMBLE"


class DefectFinding(BaseValueObject):
    finding_id: str = Field(default="", description="Unique identifier for finding")
    defect_class: DefectClass
    confidence: float = Field(..., ge=0.0, le=1.0)
    bounding_box: tuple[int, int, int, int] = Field(..., description="(x, y, width, height)")
    severity: str = "HIGH"
    ipc_clause: Optional[str] = Field(None, description="IPC-A-610 Class 2 specification clause")
    source: InferenceSource = InferenceSource.LOCAL_REFERENCE_MODEL
    area_pixels: Optional[int] = Field(None, description="Contour pixel area")


class AdvisoryExplanation(BaseModel):
    summary: str = Field(..., description="High-level natural language description of observed board state")
    observed_anomalies: list[str] = Field(default_factory=list)
    probable_root_cause: str = Field(..., description="Upstream process hypothesis (e.g. stencil aperture, solder reflow profile)")
    recommended_containment: str = Field(..., description="Immediate operator action")
    is_authoritative_decision: bool = Field(False, description="Explicit guard: the model is strictly advisory, never the pass/fail decider")
    ipc_reference_citations: list[str] = Field(default_factory=list)
    generated_by: str = Field("deterministic", description="Muse model id when Meta Model API wrote the advisory")


class ProcessingLatencyMetrics(BaseModel):
    storage_ms: float = 0.0
    alignment_ms: float = 0.0
    difference_detection_ms: float = 0.0
    detection_ms: float = 0.0
    ocr_ms: float = 0.0
    reasoning_ms: float = 0.0
    total_latency_ms: float = 0.0


class InspectionResult(BaseModel):
    inspection_id: str
    camera_id: str
    part_id: str
    plant_id: str = "PLANT_BANGALORE"
    line_id: str = "LINE_SMT_01"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    verdict: InspectionVerdict
    defects: list[DefectFinding] = Field(default_factory=list)
    similarity_score_to_golden: float = Field(..., ge=0.0, le=1.0)
    raw_image_uri: Optional[str] = None
    annotated_overlay_uri: Optional[str] = None
    barcode_decoded: Optional[str] = None
    barcode_grade: Optional[str] = None
    advisory: Optional[AdvisoryExplanation] = None
    detector: str = Field("local-reference", description="Which detector produced the defects")
    latency_metrics: Optional[ProcessingLatencyMetrics] = None
    human_disposition_status: str = "PENDING_REVIEW"


class HumanDispositionRequest(BaseModel):
    inspection_id: str
    auditor_id: str
    action: str = Field(..., description="CONFIRM_DEFECT | DISMISS_DEFECT | OVERRIDE_PASS | RECLASSIFY")
    new_defect_class: Optional[DefectClass] = None
    rationale: str = Field(..., min_length=5, description="Auditor justification for compliance records")


class HumanDispositionRecord(BaseModel):
    audit_id: str
    inspection_id: str
    auditor_id: str
    action: str
    prior_verdict: InspectionVerdict
    final_verdict: InspectionVerdict
    rationale: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class GoldenTemplate(BaseModel):
    template_id: str
    part_number: str
    revision: str = "REV_B"
    template_uri: str
    keypoints_count: int = 500
    similarity_tolerance_pct: float = 0.85
    registered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    registered_by: str = "QC_ENGINEER"


class HourlyQualityKPI(BaseModel):
    hour_timestamp: str
    line_id: str
    total_inspected: int
    defective_count: int
    first_pass_yield_pct: float
    dpmo: float
    scrap_cost_usd: float


class LineQualitySummary(BaseModel):
    line_id: str
    first_pass_yield_pct: float
    dpmo: float
    total_inspected: int
    total_defective: int
    top_defect_classes: list[tuple[DefectClass, int]]
    hourly_trend: list[HourlyQualityKPI] = Field(default_factory=list)


class DetectorFeedbackMetrics(BaseModel):
    """Live detector quality from human dispositions (the ground truth on the line)."""
    detector: str
    reviewed_inspections: int
    confirmed_defects: int
    dismissed_defects: int
    precision: Optional[float] = Field(None, description="confirmed / (confirmed + dismissed)")
    override_passes: int = 0
    recommendation: str
    computed_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
