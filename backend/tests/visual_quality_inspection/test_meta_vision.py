"""Meta Model API vision path with recorded responses (no network): Muse Spark classification,
SAM 3.1 localisation, grounded advisory, serial reading and detector feedback metrics."""
import json

import httpx
import pytest

from backend.core.ai.meta import MetaModelClient
from backend.core.config.settings import BackendSettings
from backend.features.visual_quality_inspection.adapters.in_memory_store import InMemoryInspectionStore
from backend.features.visual_quality_inspection.adapters.meta_vision_adapters import (
    MetaDefectDetector,
    MuseOCRClient,
    MuseVisualReasoningClient,
)
from backend.features.visual_quality_inspection.domain.models import (
    DefectClass,
    HumanDispositionRequest,
    InferenceSource,
    InspectionVerdict,
)
from backend.features.visual_quality_inspection.services.quality_service import VisualQualityService

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _message(obj) -> dict:
    return {"output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps(obj) if not isinstance(obj, str) else obj}]}]}


def _client(handler) -> MetaModelClient:
    cfg = BackendSettings(model_api_key="meta-test-key-0123456789", ai_enabled=True)
    return MetaModelClient(cfg, transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_muse_spark_classifies_and_sam_localises():
    calls = []

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content)
        calls.append(body)
        assert req.headers["authorization"] == "Bearer meta-test-key-0123456789"
        if body["model"] == "sam-3.1":
            assert body["input"][0]["content"][0]["text"] == "solder bridge between pins"
            return httpx.Response(200, json=_message("<0f>0<|box;x1=140;y1=96;x2=178;y2=116;w=640;h=480;c=0.88|><|mask;x=0;y=0;data=1,1,~a|>"))
        assert body["model"] == "muse-spark-1.3"
        assert body["text"]["format"]["type"] == "json_schema"
        return httpx.Response(200, json=_message({"image_usable": True, "defects": [
            {"defect_class": "SOLDER_BRIDGE", "confidence": 0.93, "evidence": "solder joining two QFP leads"},
            {"defect_class": "SURFACE_SCRATCH", "confidence": 0.2, "evidence": "faint mark"},  # below threshold
        ]}))

    det = MetaDefectDetector(client=_client(handler))
    findings = await det.predict_defects(PNG, "PART-ECU-777")
    assert len(findings) == 1
    f = findings[0]
    assert f.defect_class == DefectClass.SOLDER_BRIDGE
    assert f.source == InferenceSource.MUSE_SPARK_SAM
    assert f.bounding_box == (140, 96, 38, 20)
    assert f.confidence == 0.88
    assert "7.3.5" in f.ipc_clause
    assert det.last_source == "muse-spark-1.3 + sam-3.1"
    assert [c["model"] for c in calls] == ["muse-spark-1.3", "sam-3.1"]


@pytest.mark.asyncio
async def test_detector_falls_back_without_image_or_on_error():
    def failing(req):
        return httpx.Response(503, json={"error": {"message": "overloaded"}})

    det = MetaDefectDetector(client=_client(failing))
    out = await det.predict_defects(PNG, "PART-ECU-001-DEF")
    assert out and out[0].source == InferenceSource.LOCAL_REFERENCE_MODEL
    out = await det.predict_defects(b"", "PART-ECU-001-DEF")
    assert out[0].source == InferenceSource.LOCAL_REFERENCE_MODEL


@pytest.mark.asyncio
async def test_advisory_is_grounded_and_never_authoritative():
    good = {"summary": "One solder bridge (93% confidence) on PART-ECU-777.", "observed_anomalies": ["Bridge across QFP pins"],
            "probable_root_cause": "Excess paste from the stencil.", "recommended_containment": "Rework and check the stencil wiper.",
            "ipc_reference_citations": ["IPC-A-610 7.3.5"]}
    invented = dict(good, summary="Scrap cost will be $48,000 this week.")
    replies = [good, invented]

    def handler(req):
        return httpx.Response(200, json=_message(replies.pop(0)))

    client = MuseVisualReasoningClient(client=_client(handler))
    det = MetaDefectDetector(client=_client(lambda r: httpx.Response(500)))
    defects = await det.predict_defects(b"", "PART-ECU-001-DEF")
    defects[0] = defects[0].model_copy(update={"confidence": 0.93})
    adv = await client.generate_inspection_explanation("PART-ECU-777", defects, 0.74)
    assert adv.generated_by == "muse-spark-1.3" and adv.is_authoritative_decision is False
    adv2 = await client.generate_inspection_explanation("PART-ECU-777", defects, 0.74)
    assert adv2.generated_by == "deterministic"  # invented $48,000 rejected by the grounding check


@pytest.mark.asyncio
async def test_serial_reading_never_invents_a_grade():
    def handler(req):
        return httpx.Response(200, json=_message({"serial_or_barcode_text": "SN-ECU-2026-11111", "symbology": "DataMatrix", "legible": True}))

    sn, grade = await MuseOCRClient(client=_client(handler)).read_barcode_and_text(PNG)
    assert sn == "SN-ECU-2026-11111"
    assert "not measured" in grade


@pytest.mark.asyncio
async def test_detector_feedback_from_human_dispositions():
    svc = VisualQualityService(history_store=InMemoryInspectionStore())
    base = await svc.get_detector_feedback()  # the demo store is seeded with past dispositions
    assert base.reviewed_inspections < 30 and "too few" in base.recommendation
    res = await svc.inspect_part("CAM_AOI_L1", "PART-ECU-009-DEF")
    assert res.verdict == InspectionVerdict.FAIL
    for action in ("CONFIRM_DEFECT", "CONFIRM_DEFECT", "DISMISS_DEFECT"):
        await svc.record_human_disposition(HumanDispositionRequest(inspection_id=res.inspection_id, auditor_id="qc1", action=action, rationale="Checked under the microscope"))
    m = await svc.get_detector_feedback()
    assert m.confirmed_defects == base.confirmed_defects + 2 and m.dismissed_defects == base.dismissed_defects + 1
    assert m.reviewed_inspections == base.reviewed_inspections + 3
    assert m.precision == round(m.confirmed_defects / m.reviewed_inspections, 3)
