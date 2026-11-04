"""Twin bridge API: the web twin syncs its plant here and reads back the four features' results."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from backend.core.db.connection import now_iso
from backend.features.twin_bridge import service, store
from backend.features.twin_bridge.models import FEATURES, DispositionIn, TwinSnapshot

router = APIRouter(prefix="/twin", tags=["Twin Bridge"])

MAX_IMAGE_BYTES = 15 * 1024 * 1024


@router.post("/sync")
async def sync_twin(snapshot: TwinSnapshot) -> dict[str, Any]:
    """Store the twin's plant snapshot and compute insights for the features it enables."""
    return await service.sync(snapshot)


@router.get("/{facility_id}/insights")
async def twin_insights(facility_id: str) -> dict[str, Any]:
    meta = store.snapshot_meta(facility_id)
    return {"facilityId": facility_id, "sync": meta, "insights": store.load_insights(facility_id)}


@router.get("/{facility_id}/analytics/{feature}")
async def twin_analytics(facility_id: str, feature: str) -> dict[str, Any]:
    """The feature's latest insights plus its history for the Analytics pages."""
    if feature not in FEATURES:
        raise HTTPException(404, f"Unknown feature {feature}")
    meta = store.snapshot_meta(facility_id)
    if feature == "vision":
        data: Optional[dict[str, Any]] = service.vision_insights(facility_id)
    else:
        data = store.load_insight(facility_id, feature)
    out: dict[str, Any] = {"facilityId": facility_id, "feature": feature, "sync": meta, "insights": data}
    if feature == "maintenance":
        out["series"] = store.asset_health_series(facility_id)
    elif feature == "supply":
        out["series"] = store.stock_series(facility_id)
    return out


@router.post("/{facility_id}/inspect")
async def twin_inspect(
    facility_id: str,
    camera_id: str = Form(..., max_length=80),
    line_id: Optional[str] = Form(None, max_length=80),
    product_id: Optional[str] = Form(None, max_length=80),
    sim_hour: float = Form(0.0),
    image: UploadFile = File(...),
) -> dict[str, Any]:
    """AOI inspection of a twin product image (Muse Spark + SAM 3.1, OpenCV, deterministic verdict); awaits human disposition."""
    from backend.features.visual_quality_inspection.api.router import _service as aoi

    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image is larger than 15 MB")
    if not data:
        raise HTTPException(400, "Image is empty")
    part_id = f"{(product_id or 'PART').upper()}-TWIN"
    result = await aoi.inspect_part(camera_id=camera_id, part_id=part_id, frame_bytes=data,
                                    plant_id=facility_id, line_id=line_id or "unassigned", demo_rules=False)
    payload = result.model_dump(mode="json")
    store.record_inspection(facility_id, {
        "inspection_id": result.inspection_id, "camera_id": camera_id, "line_id": line_id, "product_id": product_id,
        "at": now_iso(), "sim_hour": sim_hour, "verdict": result.verdict.value, "defect_count": len(result.defects),
        "disposition": "pending" if result.defects or result.verdict.value != "PASS" else "auto-accepted", "data": payload,
    })
    return payload


@router.post("/{facility_id}/inspections/{inspection_id}/disposition")
async def twin_disposition(facility_id: str, inspection_id: str, body: DispositionIn) -> dict[str, Any]:
    """Record the person's decision on an inspection (drives detector precision)."""
    if not store.set_disposition(facility_id, inspection_id, "confirmed" if body.action == "confirm" else "dismissed", body.auditor):
        raise HTTPException(404, f"Inspection {inspection_id} not found")
    return {"inspectionId": inspection_id, "disposition": body.action}
