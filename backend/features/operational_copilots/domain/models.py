"""Domain models for operational copilots and shift handovers."""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field
from backend.core.interfaces.base import BaseValueObject


class SOPStep(BaseValueObject):
    step_number: int
    title: str
    instruction: str
    safety_warning: Optional[str] = None
    required_tools: list[str] = Field(default_factory=list)


class ShiftHandoverReport(BaseModel):
    line_id: str
    shift_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    units_produced: int
    scrap_rate_pct: float
    major_incidents: list[str]
    pending_work_orders: list[str]
    next_shift_priorities: list[str]
    summary_markdown: Optional[str] = Field(None, description="Muse Spark handover briefing grounded in the shift metrics")
    generated_by: str = "deterministic"


class AlarmDiagnostic(BaseModel):
    alarm_code: str
    asset_id: str
    severity: str  # WARNING | CRITICAL | TRIP
    description: str
    recommended_troubleshooting_steps: list[str]
    relevant_manual_section: str
    manual_excerpt: Optional[str] = Field(None, description="Matching passage from the local maintenance manuals")
    explanation_markdown: Optional[str] = Field(None, description="Muse Spark explanation grounded in the alarm and manual excerpt")
    generated_by: str = "deterministic"
