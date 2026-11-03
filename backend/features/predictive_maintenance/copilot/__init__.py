"""Twin GenAI Maintenance Copilot Package.

Provides autonomous conversational intelligence, multi-source RAG,
standard operating procedure retrieval, and technician feedback capture.
"""
from backend.features.predictive_maintenance.copilot.models import (
    CopilotChatRequest,
    CopilotChatResponse,
    GroundedEvidence,
    SimilarIncident,
    ApprovedProcedure,
    TechnicianFeedbackSubmission,
    UserRole,
    FeedbackDecision,
    ResolutionStatus,
)
from backend.features.predictive_maintenance.copilot.rag_service import maintenance_rag_service
from backend.features.predictive_maintenance.copilot.copilot_service import copilot_service
from backend.features.predictive_maintenance.copilot.feedback_service import technician_feedback_service

__all__ = [
    "CopilotChatRequest",
    "CopilotChatResponse",
    "GroundedEvidence",
    "SimilarIncident",
    "ApprovedProcedure",
    "TechnicianFeedbackSubmission",
    "UserRole",
    "FeedbackDecision",
    "ResolutionStatus",
    "maintenance_rag_service",
    "copilot_service",
    "technician_feedback_service",
]
