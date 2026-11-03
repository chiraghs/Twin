"""SQLite tables of visual quality inspection."""
from backend.core.db import TableSpec
from backend.features.visual_quality_inspection.domain.models import GoldenTemplate, HumanDispositionRecord, InspectionResult

F = "visual_quality_inspection"
INSPECTIONS = TableSpec(
    "vq_inspections", "AOI inspection events: verdict, detector, similarity, serial read, advisory, latency.", InspectionResult,
    key=lambda m: m.inspection_id, kind="list",
    columns={"camera_id": lambda m: m.camera_id, "part_id": lambda m: m.part_id, "line_id": lambda m: m.line_id,
             "inspected_at": lambda m: m.timestamp, "verdict": lambda m: m.verdict, "detector_name": lambda m: m.detector,
             "similarity": lambda m: m.similarity_score_to_golden, "defects_count": lambda m: len(m.defects),
             "disposition_status": lambda m: m.human_disposition_status},
    indexes=("line_id", "verdict", "inspected_at"), feature=F)
DEFECTS = TableSpec(
    "vq_defects", "One row per detected defect (class, confidence, severity, IPC clause, box, source).", None,
    key=lambda d: d["finding_key"], kind="list",
    columns={"inspection_id": lambda d: d["inspection_id"], "defect_class": lambda d: d["defect_class"], "confidence": lambda d: d["confidence"],
             "severity": lambda d: d["severity"], "source_kind": lambda d: d["source"], "ipc_clause": lambda d: d.get("ipc_clause")},
    indexes=("inspection_id", "defect_class"), feature=F)
TEMPLATES = TableSpec(
    "vq_golden_templates", "Registered golden reference templates per part number and revision.", GoldenTemplate,
    columns={"template_id": lambda m: m.template_id, "revision": lambda m: m.revision, "registered_by": lambda m: m.registered_by}, feature=F)
DISPOSITIONS = TableSpec(
    "vq_dispositions", "Immutable human disposition audit trail (confirm / dismiss / override / reclassify).", HumanDispositionRecord,
    key=lambda m: m.audit_id, kind="list",
    columns={"inspection_id": lambda m: m.inspection_id, "auditor_id": lambda m: m.auditor_id, "action": lambda m: m.action,
             "final_verdict": lambda m: m.final_verdict, "decided_at": lambda m: m.timestamp},
    indexes=("inspection_id", "action"), feature=F)
