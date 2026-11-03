"""Data models for Twin GenAI Maintenance Copilot.

Encapsulates conversational query contracts, grounded multi-source evidence,
similar incident references, approved SOP procedures, and technician feedback.
"""
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


class UserRole(str, Enum):
    RELIABILITY_ENGINEER = "RELIABILITY_ENGINEER"
    MAINTENANCE_LEAD = "MAINTENANCE_LEAD"
    FIELD_TECHNICIAN = "FIELD_TECHNICIAN"
    PLANT_OPERATOR = "PLANT_OPERATOR"


class FeedbackDecision(str, Enum):
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    DEFERRED = "DEFERRED"


class ResolutionStatus(str, Enum):
    RESOLVED = "RESOLVED"
    ONGOING = "ONGOING"
    RECURRING = "RECURRING"


class CopilotChatRequest(BaseModel):
    query: str = Field(..., description="Natural language maintenance question")
    asset_id: Optional[str] = Field(None, description="Target asset identifier (e.g. CNC-001)")
    plant_id: Optional[str] = Field(None, description="Plant filter for access control")
    language: str = Field("en", description="Preferred response language (any ISO code with Meta Model API; en | de | hi templates offline)")
    user_role: UserRole = Field(UserRole.RELIABILITY_ENGINEER, description="Role of requesting user")
    user_id: str = Field("eng_chirag", description="Identifier of the authenticated user")


class SimilarIncident(BaseModel):
    incident_id: str
    asset_id: str
    equipment_type: str
    failure_code: str
    failure_description: str
    root_cause: str
    resolution_applied: str
    verified_outcome: str  # e.g. "Zero recurrence in 6 months", "Downtime reduced by 8h"
    actual_downtime_hours: float
    actual_repair_cost_usd: float
    similarity_score: float = Field(..., ge=0.0, le=1.0)
    source_record_id: str
    incident_date: str


class ApprovedProcedure(BaseModel):
    procedure_id: str
    title: str
    equipment_type: str
    version: str
    safety_warning: Optional[str] = None
    required_tools: list[str] = Field(default_factory=list)
    required_parts: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)
    approved_by: str
    approved_at: str


class GroundedEvidence(BaseModel):
    verified_facts: dict[str, Any] = Field(default_factory=dict, description="Verified facts from PLC/SCADA and ERP")
    ml_predictions: dict[str, Any] = Field(default_factory=dict, description="Predictive failure probability and anomaly metrics")
    historical_incidents: list[SimilarIncident] = Field(default_factory=list, description="Similar cases from CMMS/RAG")
    approved_procedures: list[ApprovedProcedure] = Field(default_factory=list, description="Governed SOPs matching fault")
    missing_or_stale_data: list[str] = Field(default_factory=list, description="Identified data gaps or unmonitored sensors")


class CopilotChatResponse(BaseModel):
    query: str
    asset_id: Optional[str] = None
    answer_markdown: str
    grounded_evidence: GroundedEvidence
    prescriptive_action: str
    urgency: str
    requires_human_approval: bool = True
    language: str = "en"
    data_provenance: str = "ACTUAL_AND_SIMULATED"
    disclaimer: str = "Advisory maintenance decision support. Human verification and LOTO safety protocols mandatory before physical intervention."
    generated_by: str = Field("deterministic-template", description="muse-spark-1.3 when Meta Model API wrote the answer")
    ai_note: Optional[str] = Field(None, description="How the answer was produced (grounding / fallback reason)")
    key_points: list[str] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TechnicianFeedbackSubmission(BaseModel):
    recommendation_id: str
    asset_id: str
    user_id: str = "technician_1"
    user_role: UserRole = UserRole.FIELD_TECHNICIAN
    usefulness_rating: int = Field(..., ge=1, le=5, description="1 (Poor) to 5 (Extremely Useful)")
    decision: FeedbackDecision
    action_taken: str = Field(..., description="Specific physical or lubrication action taken")
    observed_condition_post_intervention: str = Field(..., description="Observed bearing/drive condition after repair")
    resolution_status: ResolutionStatus
    actual_downtime_hours: float = Field(0.0, ge=0.0)
    actual_repair_cost_usd: float = Field(0.0, ge=0.0)
    technician_notes: Optional[str] = None
    recorded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
