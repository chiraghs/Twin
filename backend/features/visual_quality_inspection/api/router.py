"""FastAPI router for visual quality inspection (Muse Spark + SAM 3.1 on Meta Model API)."""
from typing import Optional
from fastapi import APIRouter, File, UploadFile, Form, HTTPException, Query
from backend.features.visual_quality_inspection.services.quality_service import VisualQualityService
from backend.features.visual_quality_inspection.adapters.in_memory_store import InMemoryInspectionStore
from backend.features.visual_quality_inspection.domain.models import (
    InspectionResult,
    LineQualitySummary,
    GoldenTemplate,
    HumanDispositionRequest,
    HumanDispositionRecord,
    DetectorFeedbackMetrics,
)
from backend.features.visual_quality_inspection.config.models import (
    VisualQualityConfig,
    quality_config_store,
)

router = APIRouter(prefix="/quality", tags=["Visual Quality Inspection"])

_store = InMemoryInspectionStore()
_service = VisualQualityService(_store, quality_config_store)


@router.post("/inspect", response_model=InspectionResult)
async def inspect_part(
    camera_id: str = Query("CAM_AOI_L1", description="Camera identifier"),
    part_id: str = Query("PART-ECU-REV-B-001", description="Part / Assembly barcode ID"),
    image: Optional[UploadFile] = File(None, description="Optional raw image bytes"),
) -> InspectionResult:
    """Inspect a part image: Muse Spark + SAM 3.1 defects, Muse Spark serial read, OpenCV golden comparison, deterministic verdict."""
    frame_bytes = await image.read() if image else None
    return await _service.inspect_part(camera_id=camera_id, part_id=part_id, frame_bytes=frame_bytes)


@router.get("/summary/{line_id}", response_model=LineQualitySummary)
async def get_line_quality_summary(line_id: str) -> LineQualitySummary:
    """Get First-Pass Yield (FPY), DPMO, and defect distribution for a line."""
    return await _service.get_line_quality_summary(line_id)


@router.get("/pareto")
async def get_defect_pareto(line_id: str = Query("LINE-1")) -> list[dict]:
    """Defect Pareto analysis categorized by IPC-A-610 Class 2 defect standards."""
    return await _service.get_defect_pareto(line_id)


@router.post("/templates/register", response_model=GoldenTemplate)
async def register_golden_template(template: GoldenTemplate) -> GoldenTemplate:
    """Registers a verified golden template with registered keypoint homography."""
    return await _service.register_golden_template(template)


@router.get("/templates/{part_number}", response_model=Optional[GoldenTemplate])
async def get_golden_template(part_number: str) -> Optional[GoldenTemplate]:
    """Retrieves golden reference template for a part number."""
    template = await _service.get_golden_template(part_number)
    if not template:
        raise HTTPException(status_code=404, detail=f"Golden template for part {part_number} not found")
    return template


@router.post("/disposition", response_model=HumanDispositionRecord)
async def record_human_disposition(request: HumanDispositionRequest) -> HumanDispositionRecord:
    """Records auditable human disposition (confirm/dismiss/override) with compliance rationale."""
    return await _service.record_human_disposition(request)


@router.get("/audit/dispositions", response_model=list[HumanDispositionRecord])
async def get_disposition_audit_trail(limit: int = Query(50, ge=1, le=200)) -> list[HumanDispositionRecord]:
    """Retrieves chronological human review audit log."""
    return await _service.get_disposition_audit_trail(limit)


@router.get("/mlops/detector-feedback", response_model=DetectorFeedbackMetrics)
async def get_detector_feedback() -> DetectorFeedbackMetrics:
    """Detector precision from human dispositions, with a threshold-tuning recommendation."""
    return await _service.get_detector_feedback()


@router.get("/config", response_model=VisualQualityConfig)
async def get_quality_config() -> VisualQualityConfig:
    """Get active visual quality inspection configuration."""
    return quality_config_store.get_config()


@router.put("/config", response_model=VisualQualityConfig)
async def update_quality_config(config: VisualQualityConfig) -> VisualQualityConfig:
    """Update visual quality thresholds dynamically at runtime."""
    return quality_config_store.update_config(config)
