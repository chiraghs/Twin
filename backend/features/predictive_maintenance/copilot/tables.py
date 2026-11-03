"""SQLite tables of the maintenance copilot: technician feedback and the RAG knowledge base."""
import hashlib

from backend.core.db import TableSpec
from backend.features.predictive_maintenance.copilot.models import ApprovedProcedure, TechnicianFeedbackSubmission

F = "predictive_maintenance"


def _digest(m) -> str:
    return hashlib.sha1(m.model_dump_json().encode()).hexdigest()[:20]


FEEDBACK = TableSpec(
    "pm_technician_feedback", "Technician feedback on recommendations (rating, decision, outcome).", TechnicianFeedbackSubmission, key=_digest, kind="list",
    columns={"recommendation_id": lambda m: m.recommendation_id, "asset_id": lambda m: m.asset_id, "decision": lambda m: m.decision,
             "usefulness_rating": lambda m: m.usefulness_rating},
    indexes=("asset_id",), feature=F)
INCIDENTS = TableSpec(
    "pm_historical_incidents", "RAG knowledge base: historical failures with root cause and verified outcome.", None,
    key=lambda d: d["incident_id"], kind="list",
    columns={"asset_id": lambda d: d.get("asset_id"), "equipment_type": lambda d: d.get("equipment_type"), "failure_code": lambda d: d.get("failure_code")},
    indexes=("equipment_type",), feature=F)
PROCEDURES = TableSpec(
    "pm_approved_procedures", "Governed, approved SOPs used by the copilot.", ApprovedProcedure, key=lambda m: m.procedure_id, kind="list",
    columns={"equipment_type": lambda m: m.equipment_type, "version": lambda m: m.version}, feature=F)
