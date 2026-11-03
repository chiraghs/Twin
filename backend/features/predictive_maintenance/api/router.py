"""FastAPI router for predictive maintenance endpoints including dynamic runtime configuration,
machine health monitoring, telemetry feeds, predictive failure analytics,
Twin actionable recommendations, source lineage, and auditable ROI intelligence.
"""
from typing import Any, Optional
try:
    from fastapi import APIRouter, HTTPException, Query, Depends
except ImportError:
    class HTTPException(Exception):
        def __init__(self, status_code: int = 400, detail: str = ""):
            self.status_code = status_code
            self.detail = detail
            super().__init__(detail)

    def Query(default=None, **kwargs):
        return default

    def Depends(dependency=None):
        return dependency

    class APIRouter:
        def __init__(self, prefix="", tags=None):
            self.prefix = prefix
            self.tags = tags or []
            self.routes = []
        def get(self, path, **kwargs):
            def decorator(f):
                self.routes.append(("GET", path, f))
                return f
            return decorator
        def put(self, path, **kwargs):
            def decorator(f):
                self.routes.append(("PUT", path, f))
                return f
            return decorator
        def post(self, path, **kwargs):
            def decorator(f):
                self.routes.append(("POST", path, f))
                return f
            return decorator
        def add_api_route(self, path, endpoint, methods=None, **kwargs):
            for m in (methods or ["GET"]):
                self.routes.append((m, path, endpoint))
from backend.features.predictive_maintenance.services.maintenance_service import PredictiveMaintenanceService
from backend.features.predictive_maintenance.adapters.mock_telemetry import InMemoryTelemetryReader
from backend.features.predictive_maintenance.domain.models import AssetDiagnosticReport, RulEstimate
from backend.features.predictive_maintenance.config.models import (
    PredictiveMaintenanceConfig,
    maintenance_config_store,
)
from backend.features.predictive_maintenance.services.machine_service import MachineService
from backend.features.predictive_maintenance.repositories.local_mock_repo import LocalMockMachineRepository
from backend.features.predictive_maintenance.connectors.manager import source_system_manager
from backend.features.predictive_maintenance.connectors.models import SourceSystemHealth
from backend.features.predictive_maintenance.services.canonical_mapping_service import canonical_mapping_service
from backend.features.predictive_maintenance.services.recommendation_engine import recommendation_engine
from backend.features.predictive_maintenance.services.roi_intelligence_service import roi_intelligence_service, RoiSummary
from backend.features.predictive_maintenance.schemas.canonical_models import (
    DimAsset,
    FactMaintenanceRecommendation,
    FactRoiLedger,
)

# Singletons for mock/local execution
_telemetry_reader = InMemoryTelemetryReader()
_service = PredictiveMaintenanceService(_telemetry_reader, maintenance_config_store)
_default_repo = LocalMockMachineRepository(num_machines=20)
_machine_service = MachineService(_default_repo)


def get_machine_service() -> MachineService:
    return _machine_service


# Primary feature router mounted under /api/v1/maintenance
router = APIRouter(prefix="/maintenance", tags=["Predictive Maintenance"])

# Root router for top-level REST endpoints (/machines, /analytics/summary, etc.)
root_router = APIRouter(tags=["Predictive Maintenance"])


# ==============================================================================
# 1. Telemetry & Machine Health Handlers
# ==============================================================================
async def handle_list_machines(
    plant_id: Optional[str] = Query(None, description="Filter by plant location"),
    risk_category: Optional[str] = Query(None, description="Filter by risk category: LOW | MEDIUM | HIGH"),
    service: MachineService = Depends(get_machine_service),
):
    """Retrieve all monitored machines with latest telemetry and risk classification."""
    return await service.list_machines(plant_id=plant_id, risk_category=risk_category)


async def handle_get_machine(machine_id: str, service: MachineService = Depends(get_machine_service)):
    """Retrieve detailed state and configuration for a specific machine."""
    machine = await service.get_machine_details(machine_id)
    if not machine:
        raise HTTPException(status_code=404, detail=f"Machine {machine_id} not found")
    return machine


async def handle_get_readings(
    machine_id: str,
    limit: int = Query(50, ge=1, le=500, description="Number of historical readings to return"),
    service: MachineService = Depends(get_machine_service),
):
    """Retrieve paginated time-series telemetry readings for a machine."""
    return await service.get_readings_history(machine_id, limit=limit)


async def handle_get_predictions(machine_id: str, service: MachineService = Depends(get_machine_service)):
    """Retrieve the latest predictive failure probability, risk tier, and recommended action."""
    pred = await service.get_predictions(machine_id)
    if not pred:
        raise HTTPException(status_code=404, detail=f"No predictions found for {machine_id}")
    return pred


async def handle_get_high_risk(service: MachineService = Depends(get_machine_service)):
    """Retrieve active high-risk equipment alerts requiring immediate operational attention."""
    return await service.get_high_risk_alerts()


async def handle_get_analytics(service: MachineService = Depends(get_machine_service)):
    """Retrieve fleet-wide health KPIs, risk distribution, and reliability metrics."""
    return await service.get_fleet_analytics()


# Register on router (/api/v1/maintenance/...)
router.add_api_route("/machines", handle_list_machines, methods=["GET"])
router.add_api_route("/machines/{machine_id}", handle_get_machine, methods=["GET"])
router.add_api_route("/machines/{machine_id}/readings", handle_get_readings, methods=["GET"])
router.add_api_route("/machines/{machine_id}/predictions", handle_get_predictions, methods=["GET"])
router.add_api_route("/predictions/high-risk", handle_get_high_risk, methods=["GET"])
router.add_api_route("/analytics/summary", handle_get_analytics, methods=["GET"])

# Register on root_router (top-level /machines, /analytics/summary per GCP spec)
root_router.add_api_route("/machines", handle_list_machines, methods=["GET"])
root_router.add_api_route("/machines/{machine_id}", handle_get_machine, methods=["GET"])
root_router.add_api_route("/machines/{machine_id}/readings", handle_get_readings, methods=["GET"])
root_router.add_api_route("/machines/{machine_id}/predictions", handle_get_predictions, methods=["GET"])
root_router.add_api_route("/predictions/high-risk", handle_get_high_risk, methods=["GET"])
root_router.add_api_route("/analytics/summary", handle_get_analytics, methods=["GET"])


# ==============================================================================
# 2. Source Connectors & Lineage Health
# ==============================================================================
@router.get("/sources", response_model=list[SourceSystemHealth])
async def get_connected_sources() -> list[SourceSystemHealth]:
    """Retrieve connected OT/IT source system health, active endpoints, and missing prerequisites."""
    return source_system_manager.get_fleet_source_health()


# ==============================================================================
# 3. Canonical Asset Hierarchy
# ==============================================================================
@router.get("/canonical/assets", response_model=list[DimAsset])
async def list_canonical_assets(
    plant_id: Optional[str] = Query(None, description="Filter by plant location"),
    criticality: Optional[str] = Query(None, description="Filter by criticality: A | B | C"),
) -> list[DimAsset]:
    """Retrieve canonical master assets with hourly downtime costs and cross-system mappings."""
    return canonical_mapping_service.list_canonical_assets(plant_id=plant_id, criticality=criticality)


@router.get("/canonical/assets/{asset_id}", response_model=DimAsset)
async def get_canonical_asset(asset_id: str) -> DimAsset:
    """Retrieve a single canonical asset master record."""
    asset = canonical_mapping_service.get_canonical_asset(asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail=f"Canonical asset {asset_id} not found")
    return asset


# ==============================================================================
# 4. Actionable Maintenance Recommendations (CARI-Ranked)
# ==============================================================================
@router.get("/recommendations", response_model=list[FactMaintenanceRecommendation])
async def list_maintenance_recommendations(service: MachineService = Depends(get_machine_service)) -> list[FactMaintenanceRecommendation]:
    """Generate and retrieve prioritized maintenance advisories ranked by Criticality-Adjusted Risk Index (CARI)."""
    fleet = await service.list_machines()
    return recommendation_engine.generate_recommendations_for_fleet(fleet)


@router.post("/recommendations/{recommendation_id}/approve", response_model=FactMaintenanceRecommendation)
async def approve_maintenance_recommendation(
    recommendation_id: str,
    approver_name: str = Query("Chief Reliability Engineer", description="User signing off on the action"),
) -> FactMaintenanceRecommendation:
    """Human-in-the-loop signoff approving maintenance intervention and auto-generating CMMS work order."""
    rec = recommendation_engine.approve_recommendation(recommendation_id, approver_name)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Recommendation {recommendation_id} not found")
    return rec


@router.post("/recommendations/{recommendation_id}/reject", response_model=FactMaintenanceRecommendation)
async def reject_maintenance_recommendation(
    recommendation_id: str,
    approver_name: str = Query("Shift Maintenance Lead", description="User rejecting recommendation"),
) -> FactMaintenanceRecommendation:
    """Human-in-the-loop action rejecting recommendation as false alarm or deferred maintenance."""
    rec = recommendation_engine.reject_recommendation(recommendation_id, approver_name)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Recommendation {recommendation_id} not found")
    return rec


# ==============================================================================
# 5. Auditable Financial ROI & Business Intelligence
# ==============================================================================
@router.get("/roi/summary", response_model=RoiSummary)
async def get_roi_summary() -> RoiSummary:
    """Retrieve platform financial ROI metrics, avoided downtime hours, net benefit, and payback period."""
    return roi_intelligence_service.compute_roi_summary()


@router.get("/roi/ledger", response_model=list[FactRoiLedger])
async def get_roi_ledger() -> list[FactRoiLedger]:
    """Retrieve auditable fact_roi_ledger lines proving realized and estimated savings calculations."""
    return roi_intelligence_service.get_ledger_entries()


# ==============================================================================
# 6. Diagnostics & Dynamic Runtime Configuration
# ==============================================================================
@router.get("/diagnostics/{asset_id}", response_model=AssetDiagnosticReport)
async def get_asset_diagnostics(asset_id: str) -> AssetDiagnosticReport:
    """Diagnose an asset's bearing condition, ISO 10816 zone, and failure risk."""
    return await _service.diagnose_asset(asset_id)


@router.get("/rul/{asset_id}", response_model=RulEstimate)
async def get_asset_rul(asset_id: str) -> RulEstimate:
    """Estimate the Remaining Useful Life (RUL) of an asset before trip threshold breach."""
    return await _service.estimate_rul(asset_id)


@router.get("/config", response_model=PredictiveMaintenanceConfig)
async def get_maintenance_config() -> PredictiveMaintenanceConfig:
    """Get active predictive maintenance configuration and ISO 10816 thresholds."""
    return maintenance_config_store.get_config()


@router.put("/config", response_model=PredictiveMaintenanceConfig)
async def update_maintenance_config(config: PredictiveMaintenanceConfig) -> PredictiveMaintenanceConfig:
    """Update predictive maintenance thresholds dynamically at runtime from UI."""
    return maintenance_config_store.update_config(config)


# ==============================================================================
# 7. GenAI Maintenance Copilot
# ==============================================================================
from backend.features.predictive_maintenance.copilot.models import (
    CopilotChatRequest,
    CopilotChatResponse,
    SimilarIncident,
    ApprovedProcedure,
    GroundedEvidence,
    TechnicianFeedbackSubmission,
)
from backend.features.predictive_maintenance.copilot.copilot_service import copilot_service
from backend.features.predictive_maintenance.copilot.rag_service import maintenance_rag_service
from backend.features.predictive_maintenance.copilot.feedback_service import technician_feedback_service


@router.post("/copilot/chat", response_model=CopilotChatResponse)
async def chat_with_copilot(request: CopilotChatRequest) -> CopilotChatResponse:
    """Conversational assistant grounding answers strictly on verified telemetry, predictions, and RAG."""
    return await copilot_service.answer_query(request)


@router.get("/copilot/incidents/similar", response_model=list[SimilarIncident])
async def search_similar_incidents(
    query: str = Query(..., description="Failure description or symptom"),
    asset_id: Optional[str] = Query(None, description="Optional asset ID"),
    equipment_type: Optional[str] = Query(None, description="Optional equipment family"),
    plant_id: Optional[str] = Query(None, description="Plant filter for access boundary"),
    limit: int = Query(3, ge=1, le=10),
) -> list[SimilarIncident]:
    """Retrieves governed historical CMMS failure records with documented root causes and verified outcomes."""
    return maintenance_rag_service.search_similar_incidents(
        query=query,
        asset_id=asset_id,
        equipment_type=equipment_type,
        plant_id=plant_id,
        limit=limit,
    )


@router.get("/copilot/procedures/approved", response_model=list[ApprovedProcedure])
async def search_approved_procedures(
    equipment_type: Optional[str] = Query(None, description="Equipment type (e.g. CNC_MILLING, ROBOTIC_ARM)"),
    keyword: Optional[str] = Query(None, description="Keyword search (e.g. bearing, lockout)"),
) -> list[ApprovedProcedure]:
    """Retrieves approved Standard Operating Procedures (SOPs) matching equipment and failure modes."""
    return maintenance_rag_service.search_approved_procedures(equipment_type=equipment_type, keyword=keyword)


@router.get("/copilot/asset-context/{asset_id}", response_model=GroundedEvidence)
async def get_copilot_asset_context(
    asset_id: str,
    query: str = Query("General equipment health", description="Query context"),
    plant_id: Optional[str] = Query(None, description="Plant boundary filter"),
) -> GroundedEvidence:
    """Retrieves 360-degree grounded context package: telemetry, predictions, RAG cases, and applicable SOPs."""
    return await copilot_service._assemble_grounded_evidence(asset_id=asset_id, query=query, plant_id=plant_id)


@router.post("/copilot/feedback", response_model=TechnicianFeedbackSubmission)
async def submit_technician_feedback(submission: TechnicianFeedbackSubmission) -> TechnicianFeedbackSubmission:
    """Records human-in-the-loop operational feedback, observed condition, and verified ROI savings."""
    return technician_feedback_service.record_feedback(submission)


@router.get("/copilot/feedback", response_model=list[TechnicianFeedbackSubmission])
async def list_technician_feedback(
    asset_id: Optional[str] = Query(None, description="Filter by asset ID"),
    recommendation_id: Optional[str] = Query(None, description="Filter by recommendation ID"),
) -> list[TechnicianFeedbackSubmission]:
    """Retrieves auditable technician feedback history and resolution outcomes."""
    return technician_feedback_service.get_feedback_history(asset_id=asset_id, recommendation_id=recommendation_id)

