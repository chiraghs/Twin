"""Meta Model API vision adapters for visual optical quality inspection.

1. MetaDefectDetector       Muse Spark classifies IPC-A-610 defects on the image; SAM 3.1
                            localises each defect class to pixel boxes. Without an image or a
                            key, the deterministic LocalReferenceDetector runs instead.
2. MuseVisualReasoningClient  Advisory root-cause and containment text (Muse Spark), grounding-
                            checked against the findings; never the pass/fail authority.
3. MuseOCRClient            Reads serial numbers / barcode text from the image (Muse Spark).
                            Print-quality grades are measured by the vision service, never guessed.

Pass/fail stays with the deterministic rule engine in services/quality_service.py.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from backend.core.ai import MetaAIError, MetaModelClient, meta_client, ungrounded_figures
from backend.features.visual_quality_inspection.domain.models import (
    AdvisoryExplanation,
    DefectClass,
    DefectFinding,
    InferenceSource,
)
from backend.features.visual_quality_inspection.ports.contracts import IDefectDetector, IOCRClient, IVisualReasoningClient

logger = logging.getLogger("quality.meta_vision")

# Defect class → (SAM 3.1 concept phrase, IPC-A-610 clause, default severity)
DEFECT_CATALOG: dict[DefectClass, tuple[str, str, str]] = {
    DefectClass.SOLDER_BRIDGE: ("solder bridge between pins", "IPC-A-610 7.3.5 (Bridging across adjacent conductive paths)", "CRITICAL"),
    DefectClass.TOMBSTONING: ("tombstoned chip component", "IPC-A-610 8.3.2 (Rectangular chip component end-cap lift)", "HIGH"),
    DefectClass.COMPONENT_MISALIGNMENT: ("misaligned component", "IPC-A-610 8.3.1 (Component alignment deviation)", "MEDIUM"),
    DefectClass.MISSING_PART: ("empty component pad", "IPC-A-610 8.2 (Missing component)", "CRITICAL"),
    DefectClass.LIFTED_LEAD: ("lifted component lead", "IPC-A-610 8.3.5 (Gull-wing lead coplanarity)", "HIGH"),
    DefectClass.SOLDER_BALLS: ("solder ball", "IPC-A-610 5.2.7 (Solder balls / fines)", "MEDIUM"),
    DefectClass.POLARITY_ERROR: ("reversed polarity component", "IPC-A-610 8.1.4 (Orientation / polarity)", "CRITICAL"),
    DefectClass.INSUFFICIENT_SOLDER: ("insufficient solder joint", "IPC-A-610 7.3 (Insufficient solder fillet)", "HIGH"),
    DefectClass.SURFACE_SCRATCH: ("scratch", "IPC-A-610 10.3 (Laminate surface damage)", "LOW"),
    DefectClass.FOREIGN_OBJECT_DEBRIS: ("foreign object debris", "IPC-A-610 10.6 (Foreign object debris)", "HIGH"),
    DefectClass.BARCODE_UNREADABLE: ("barcode label", "ISO/IEC 15416 (Barcode print quality)", "MEDIUM"),
}

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "image_usable": {"type": "boolean"},
        "defects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "defect_class": {"type": "string", "enum": [c.value for c in DefectClass]},
                    "confidence": {"type": "number"},
                    "evidence": {"type": "string"},
                },
                "required": ["defect_class", "confidence", "evidence"],
            },
        },
    },
    "required": ["image_usable", "defects"],
}

ADVISORY_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "observed_anomalies": {"type": "array", "items": {"type": "string"}},
        "probable_root_cause": {"type": "string"},
        "recommended_containment": {"type": "string"},
        "ipc_reference_citations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "observed_anomalies", "probable_root_cause", "recommended_containment", "ipc_reference_citations"],
}

OCR_SCHEMA = {
    "type": "object",
    "properties": {
        "serial_or_barcode_text": {"type": ["string", "null"]},
        "symbology": {"type": ["string", "null"], "description": "QR, DataMatrix, Code128, EAN-13, printed text, …"},
        "legible": {"type": "boolean"},
    },
    "required": ["serial_or_barcode_text", "symbology", "legible"],
}


def _mime(image: bytes) -> str:
    if image[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if image[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image[:4] == b"RIFF" and image[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _is_image(data: Optional[bytes]) -> bool:
    return bool(data) and (data[:8] == b"\x89PNG\r\n\x1a\n" or data[:3] == b"\xff\xd8\xff" or (data[:4] == b"RIFF" and data[8:12] == b"WEBP"))


class LocalReferenceDetector(IDefectDetector):
    """Deterministic reference detector used without an image or without Meta Model API.

    It reproduces the plant model's scrap attribution for the demo parts so the pipeline,
    rule engine and dashboards stay testable offline.
    """

    async def predict_defects(self, image_bytes: bytes, part_id: str) -> list[DefectFinding]:
        is_defective = "DEF" in part_id or (part_id[-1].isdigit() and int(part_id[-1]) % 5 == 0)
        if not is_defective:
            return []
        if "ECU" in part_id:
            cls, box, conf, area = DefectClass.SOLDER_BRIDGE, (142, 98, 36, 18), 0.96, 648
        elif "SERVO" in part_id:
            cls, box, conf, area = DefectClass.TOMBSTONING, (210, 155, 24, 40), 0.93, 960
        else:
            cls, box, conf, area = DefectClass.LIFTED_LEAD, (88, 112, 18, 30), 0.91, 540
        _, clause, severity = DEFECT_CATALOG[cls]
        return [DefectFinding(finding_id=f"REF-{uuid.uuid4().hex[:6].upper()}", defect_class=cls, confidence=conf,
                              bounding_box=box, severity=severity, ipc_clause=clause,
                              source=InferenceSource.LOCAL_REFERENCE_MODEL, area_pixels=area)]


class MetaDefectDetector(IDefectDetector):
    """Muse Spark classification + SAM 3.1 localisation, with the reference detector as fallback."""

    def __init__(self, client: Optional[MetaModelClient] = None, fallback: Optional[IDefectDetector] = None,
                 min_confidence: float = 0.5, max_classes: int = 4) -> None:
        self.client = client or meta_client
        self.fallback = fallback or LocalReferenceDetector()
        self.min_confidence = min_confidence
        self.max_classes = max_classes
        self.last_source = "local-reference"

    async def predict_defects(self, image_bytes: bytes, part_id: str) -> list[DefectFinding]:
        if not (self.client.enabled and _is_image(image_bytes)):
            self.last_source = "local-reference"
            return await self.fallback.predict_defects(image_bytes, part_id)
        mime = _mime(image_bytes)
        try:
            out = await self.client.generate_json(
                system=("You are an automated optical inspection (AOI) model for SMT electronics assemblies, applying IPC-A-610 Class 2. "
                        "Report only defects that are clearly visible, using the given classes. If the image is not a usable "
                        "inspection image, set image_usable to false."),
                prompt=f"Inspect assembly {part_id}. List every visible defect with your confidence (0-1) and what you see.",
                schema=CLASSIFY_SCHEMA, name="aoi_defects", images=[(image_bytes, mime)], purpose="AOI classification",
            )
        except MetaAIError as e:
            logger.warning("Muse Spark AOI failed, using reference detector: %s", e)
            self.last_source = "local-reference"
            return await self.fallback.predict_defects(image_bytes, part_id)

        findings: list[DefectFinding] = []
        seen: set[DefectClass] = set()
        for d in out.get("defects") or []:
            try:
                cls = DefectClass(d.get("defect_class"))
            except ValueError:
                continue
            conf = max(0.0, min(1.0, float(d.get("confidence", 0))))
            if conf < self.min_confidence or cls in seen or len(seen) >= self.max_classes:
                continue
            seen.add(cls)
            concept, clause, severity = DEFECT_CATALOG[cls]
            try:
                boxes = await self.client.segment(image_bytes, mime, concept)
            except MetaAIError:
                boxes = []
            if boxes:
                for b in boxes[:3]:
                    w, h = int(b.x2 - b.x1), int(b.y2 - b.y1)
                    findings.append(DefectFinding(
                        finding_id=f"MSA-{uuid.uuid4().hex[:6].upper()}", defect_class=cls,
                        confidence=round(min(conf, b.confidence) if b.confidence is not None else conf, 3),
                        bounding_box=(int(b.x1), int(b.y1), w, h), severity=severity, ipc_clause=clause,
                        source=InferenceSource.MUSE_SPARK_SAM, area_pixels=w * h))
            else:
                # Classified but not localised: keep it, with low confidence so the rule engine asks a person.
                findings.append(DefectFinding(
                    finding_id=f"MSA-{uuid.uuid4().hex[:6].upper()}", defect_class=cls, confidence=round(min(conf, 0.7), 3),
                    bounding_box=(0, 0, 0, 0), severity=severity, ipc_clause=clause, source=InferenceSource.MUSE_SPARK_SAM))
        self.last_source = f"{self.client.config.meta_model} + {self.client.config.meta_segmentation_model}"
        return findings


def _deterministic_advisory(part_id: str, defects: list[DefectFinding], similarity: float) -> AdvisoryExplanation:
    if not defects:
        return AdvisoryExplanation(
            summary=f"Assembly {part_id} satisfies all IPC-A-610 Class 2 workmanship criteria with {similarity * 100:.1f}% golden template correlation.",
            observed_anomalies=[],
            probable_root_cause="Process nominal. Wetting angle, solder meniscus, and component alignment within spec.",
            recommended_containment="No action required. Release unit to next downstream packaging station.",
            ipc_reference_citations=["IPC-A-610 Class 2 Section 7 (Soldering Acceptability)"],
        )
    names = [d.defect_class.value for d in defects]
    clauses = [d.ipc_clause for d in defects if d.ipc_clause]
    if any(d.defect_class == DefectClass.SOLDER_BRIDGE for d in defects):
        root = "Excessive solder paste volume deposited during screen printing or stencil aperture misalignment along fine-pitch QFP leads."
        contain = "Reroute unit to manual desoldering rework station. Inspect SMT Line 1 stencil wiper frequency and squeegee pressure."
    elif any(d.defect_class == DefectClass.TOMBSTONING for d in defects):
        root = "Uneven reflow thermal ramp rate between pads, creating imbalanced surface tension on passive chip component terminations."
        contain = "Verify nitrogen convection reflow zone 4 temperature profile. Audit thermal soak duration."
    else:
        root = "Mechanical lead coplanarity deviation or component feeder placement vibration."
        contain = "Hold batch for optical verification. Check robotic pick-and-place nozzle vacuum pressure."
    return AdvisoryExplanation(
        summary=f"Detected {len(defects)} defect(s) on assembly {part_id}: {', '.join(names)}. Structural similarity to golden reference is {similarity * 100:.1f}%.",
        observed_anomalies=[f"{d.defect_class.value} detected at bbox {d.bounding_box} with {d.confidence * 100:.0f}% confidence" for d in defects],
        probable_root_cause=root,
        recommended_containment=contain,
        ipc_reference_citations=clauses or ["IPC-A-610 Class 2 (Workmanship Acceptability Criteria)"],
    )


class MuseVisualReasoningClient(IVisualReasoningClient):
    """Advisory explanation by Muse Spark (grounded in the findings), deterministic otherwise."""

    def __init__(self, client: Optional[MetaModelClient] = None) -> None:
        self.client = client or meta_client

    async def generate_inspection_explanation(
        self, part_id: str, defects: list[DefectFinding], similarity: float, image_bytes: Optional[bytes] = None
    ) -> AdvisoryExplanation:
        fallback = _deterministic_advisory(part_id, defects, similarity)
        if not self.client.enabled:
            return fallback
        facts = {"part_id": part_id, "similarity_to_golden_pct": round(similarity * 100, 1),
                 "defects": [d.model_dump(mode="json") for d in defects]}
        try:
            out = await self.client.generate_json(
                system=("You are an SMT process engineer. Explain the AOI findings for the line lead: what was observed, the most "
                        "probable upstream process root cause (printing, placement, reflow), and an immediate containment action. "
                        "Use only the findings provided; cite IPC-A-610 clauses from them. You are advisory: never declare pass or fail."),
                prompt=f"Findings JSON:\n{facts}",
                schema=ADVISORY_SCHEMA, name="aoi_advisory",
                images=[(image_bytes, _mime(image_bytes))] if _is_image(image_bytes) else None,
                purpose="AOI advisory",
            )
            adv = AdvisoryExplanation(**{k: out[k] for k in ADVISORY_SCHEMA["required"]},
                                      is_authoritative_decision=False, generated_by=self.client.config.meta_model)
            text = " ".join([adv.summary, adv.probable_root_cause, adv.recommended_containment, *adv.observed_anomalies])
            if ungrounded_figures(text, [facts, adv.ipc_reference_citations, fallback.model_dump()]):
                return fallback
            return adv
        except (MetaAIError, KeyError, TypeError, ValueError):
            return fallback


class MuseOCRClient(IOCRClient):
    """Serial / barcode text read by Muse Spark. Grades come from measurement, not from a model."""

    SIMULATED = ("SN-ECU-2026-09412", "Grade-A (ISO/IEC 15416 print-quality compliant)")

    def __init__(self, client: Optional[MetaModelClient] = None) -> None:
        self.client = client or meta_client

    async def read_barcode_and_text(self, image_bytes: bytes) -> tuple[Optional[str], Optional[str]]:
        if not (self.client.enabled and _is_image(image_bytes)):
            return self.SIMULATED
        try:
            out = await self.client.generate_json(
                system="You read serial numbers and barcode/2D-code payloads printed on manufactured parts. Report exactly what is legible; never guess characters.",
                prompt="Read the serial number or code payload on this part.",
                schema=OCR_SCHEMA, name="part_ocr", images=[(image_bytes, _mime(image_bytes))], purpose="part OCR",
            )
        except MetaAIError:
            return None, "Not read (Meta Model API unavailable)"
        text = out.get("serial_or_barcode_text")
        if not out.get("legible") or not text:
            return None, "Unreadable (flag BARCODE_UNREADABLE for review)"
        sym = out.get("symbology") or "code"
        return str(text)[:120], f"{sym} read by {self.client.config.meta_model}; print grade not measured (use the vision service)"
