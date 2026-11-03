"""Contracts and models for AI-Powered Conversational Supply Chain Analytics."""
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field

from backend.features.supply_chain_intelligence.schemas.ontology import (
    RiskSeverity,
    DisruptionEvent,
    MitigationRecommendation,
)


class UserRole(str, Enum):
    SUPPLY_CHAIN_DIRECTOR = "SUPPLY_CHAIN_DIRECTOR"
    PROCUREMENT_MANAGER = "PROCUREMENT_MANAGER"
    LOGISTICS_COORDINATOR = "LOGISTICS_COORDINATOR"
    PLANT_OPERATIONS_LEAD = "PLANT_OPERATIONS_LEAD"


class SupplyChainChatRequest(BaseModel):
    query: str = Field(..., description="Natural language supply chain question")
    supplier_id: Optional[str] = Field(None, description="Optional target supplier filter")
    part_id: Optional[str] = Field(None, description="Optional target component SKU filter")
    plant_id: Optional[str] = Field(None, description="Optional target plant filter")
    language: str = Field("en", description="Preferred response language: en | de | hi")
    user_role: UserRole = Field(UserRole.PROCUREMENT_MANAGER)
    user_id: str = Field("supply_lead_chirag")


class SupplyChainEvidence(BaseModel):
    verified_facts: dict[str, Any] = Field(default_factory=dict, description="Facts from ERP/WMS/TMS")
    risk_predictions: dict[str, Any] = Field(default_factory=dict, description="Stockout ETA, ETA drift, OTD degradation")
    downstream_impact: dict[str, Any] = Field(default_factory=dict, description="Affected plants, finished assemblies, customer orders")
    recommended_mitigations: list[MitigationRecommendation] = Field(default_factory=list)


class SupplyChainChatResponse(BaseModel):
    query: str
    answer_markdown: str
    evidence: SupplyChainEvidence
    prescriptive_action: str
    urgency: RiskSeverity
    requires_human_approval: bool = True
    language: str = "en"
    data_provenance: str = "ACTUAL_AND_ESTIMATED"
    disclaimer: str = "Advisory decision support. Procurement authorization and supplier contract verification required before purchase order commit."
    generated_by: str = Field("deterministic-template", description="Muse model id when Meta Model API wrote the answer")
    ai_note: Optional[str] = None
    key_points: list[str] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WhatIfSimulationRequest(BaseModel):
    scenario_type: str = Field("SUPPLIER_FAILURE", description="SUPPLIER_FAILURE | PORT_CLOSURE | DEMAND_SPIKE")
    target_entity_id: str = Field(..., description="Target supplier_id or port name")
    duration_days: int = Field(14, ge=1, le=90, description="Hypothetical disruption duration in days")


class WhatIfSimulationResponse(BaseModel):
    scenario_title: str
    hypothetical_impact: dict[str, Any]
    projected_downtime_hours: float
    projected_financial_loss_usd: float
    critical_parts_depleted: list[str]
    customer_orders_delayed: list[str]
    recommended_contingency_plan: str
    narrative_markdown: Optional[str] = Field(None, description="Muse Wonder briefing of the simulated impact (grounded)")
    generated_by: str = "deterministic"
    simulated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
