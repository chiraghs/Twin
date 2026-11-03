"""FastAPI router for Twin Supply Chain Intelligence Platform.

Exposes:
- Network Ontology: Suppliers, Parts, Inventory, Shipments, Customer Orders
- Disruption Monitoring & Mitigation Action Center
- Governed KPI Framework (OTD, Fill Rate, DOI, Disruption Costs)
- AI-Powered Conversational Analytics & What-If Disruption Simulator
- Dynamic Runtime Configuration
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
        return None

    class APIRouter:
        def __init__(self, prefix: str = "", tags: list[str] = None):
            self.prefix = prefix
            self.tags = tags or []
            self.routes = []

        def get(self, path: str, **kwargs):
            def decorator(func):
                return func
            return decorator

        def post(self, path: str, **kwargs):
            def decorator(func):
                return func
            return decorator

        def put(self, path: str, **kwargs):
            def decorator(func):
                return func
            return decorator

from backend.features.supply_chain_intelligence.schemas.ontology import (
    Supplier,
    Part,
    InventoryItem,
    PurchaseOrder,
    Shipment,
    CustomerOrder,
    DisruptionEvent,
    MitigationRecommendation,
    GovernedSupplyChainKPIs,
    RiskSeverity,
    Carrier,
    Warehouse,
    ProductionSchedule,
    DemandForecast,
    AlternativeSupplierContract,
    ExcessInventoryItem,
    EndToEndImpactTrace,
)
from backend.features.supply_chain_intelligence.repositories.local_mock_repo import local_supply_chain_repo
from backend.features.supply_chain_intelligence.services.kpi_service import supply_chain_kpi_service
from backend.features.supply_chain_intelligence.services.risk_engine import supply_chain_risk_engine
from backend.features.supply_chain_intelligence.services.impact_analyzer import multi_echelon_impact_analyzer
from backend.features.supply_chain_intelligence.assistant.models import (
    SupplyChainChatRequest,
    SupplyChainChatResponse,
    WhatIfSimulationRequest,
    WhatIfSimulationResponse,
)
from backend.features.supply_chain_intelligence.assistant.assistant_service import supply_chain_assistant_service
from backend.features.supply_chain_intelligence.domain.models import (
    PartStockRisk,
    SupplierRiskScore,
    PurchaseOrderRecommendation,
)
from backend.features.supply_chain_intelligence.config.models import (
    SupplyChainConfig,
    supply_config_store,
)
from backend.features.supply_chain_intelligence.services.supply_service import SupplyChainService
from backend.features.supply_chain_intelligence.adapters.in_memory_inventory import InMemoryERPReader

from backend.core.db.runlog import RunLog

WHAT_IF_RUNS = RunLog("sc_what_if_runs", "What-if disruption simulations with the Muse Wonder briefing.", "supply_chain_intelligence")
IMPACT_TRACES = RunLog("sc_impact_traces", "End-to-end disruption impact traces (POs, shipments, lines, orders).", "supply_chain_intelligence")
SIMULATION_RUNS = RunLog("sc_simulation_runs", "Network scenario simulations (demand surge, port closure…).", "supply_chain_intelligence")
PO_RECOMMENDATIONS = RunLog("sc_po_recommendations", "Purchase-order recommendations awaiting procurement approval.", "supply_chain_intelligence")

router = APIRouter(prefix="/supply-chain", tags=["Supply Chain Intelligence"])

_legacy_reader = InMemoryERPReader()
_legacy_service = SupplyChainService(_legacy_reader, supply_config_store)


# ==============================================================================
# 1. Governed KPIs & Executive Scorecard
# ==============================================================================
@router.get("/kpis/summary", response_model=GovernedSupplyChainKPIs)
async def get_kpis_summary(plant_id: Optional[str] = Query(None, description="Optional plant filter")) -> GovernedSupplyChainKPIs:
    """Computes enterprise supply chain KPIs (OTD, Fill Rate, DOI, Disruption Costs)."""
    return supply_chain_kpi_service.compute_kpis(plant_id=plant_id)


# ==============================================================================
# 2. Suppliers & Multi-Factor Risk
# ==============================================================================
@router.get("/suppliers", response_model=list[Supplier])
async def list_suppliers(risk_level: Optional[str] = Query("All", description="Filter by CRITICAL | HIGH | MEDIUM | LOW | All")) -> list[Supplier]:
    """Retrieve all monitored suppliers with delivery reliability and risk tier."""
    return local_supply_chain_repo.list_suppliers(risk_level=risk_level)


@router.get("/suppliers/risks/evaluated")
async def evaluate_supplier_risks() -> list[dict[str, Any]]:
    """Evaluates composite delivery, variance, and concentration risks across all suppliers."""
    return supply_chain_risk_engine.evaluate_supplier_risks()


@router.get("/suppliers/concentration")
async def get_supplier_concentration() -> dict[str, Any]:
    """Calculates single-source component dependencies and concentration index."""
    return supply_chain_risk_engine.evaluate_supplier_concentration()


# Declared after the static /suppliers/* routes so they are not captured as a supplier id.
@router.get("/suppliers/{supplier_id}", response_model=Supplier)
async def get_supplier_details(supplier_id: str) -> Supplier:
    """Retrieve detailed profile for a specific supplier."""
    s = local_supply_chain_repo.get_supplier(supplier_id)
    if not s:
        raise HTTPException(status_code=404, detail=f"Supplier {supplier_id} not found")
    return s


# ==============================================================================
# 3. Parts, Inventory & BOM Propagation
# ==============================================================================
@router.get("/parts", response_model=list[Part])
async def list_parts() -> list[Part]:
    """List component parts catalog with lead times, criticality, and dual-sourcing."""
    return local_supply_chain_repo.list_parts()


@router.get("/parts/{part_id}", response_model=Part)
async def get_part_details(part_id: str) -> Part:
    """Retrieve component part details."""
    p = local_supply_chain_repo.get_part(part_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Part {part_id} not found")
    return p


@router.get("/inventory", response_model=list[InventoryItem])
async def list_inventory(plant_id: Optional[str] = Query("All", description="Optional plant filter")) -> list[InventoryItem]:
    """Retrieve real-time inventory balances, daily consumption rates, and days of supply."""
    return local_supply_chain_repo.list_inventory(plant_id=plant_id)


@router.get("/parts/{part_id}/bom-impact")
async def get_part_bom_impact(part_id: str) -> dict[str, Any]:
    """Traces a disrupted part through BOMs to affected finished products and customer orders."""
    res = supply_chain_risk_engine.analyze_bom_downstream_impact(part_id)
    if "error" in res:
        raise HTTPException(status_code=404, detail=res["error"])
    return res


# ==============================================================================
# 4. Logistics & Active Shipments
# ==============================================================================
@router.get("/shipments", response_model=list[Shipment])
async def list_shipments(status: Optional[str] = Query("All", description="Filter by shipment status")) -> list[Shipment]:
    """Retrieve active multi-modal in-transit shipments and milestone updates."""
    return local_supply_chain_repo.list_shipments(status=status)


@router.get("/shipments/delayed", response_model=list[Shipment])
async def list_delayed_shipments() -> list[Shipment]:
    """List shipments currently experiencing ETA drift, port congestion, or customs holds."""
    shipments = local_supply_chain_repo.list_shipments()
    return [s for s in shipments if s.eta_drift_days > 0 or s.status.value in ("PORT_CONGESTION", "CUSTOMS_HOLD", "EXCEPTION_DELAYED")]


# ==============================================================================
# 5. Customer Orders at Risk
# ==============================================================================
@router.get("/orders", response_model=list[CustomerOrder])
async def list_customer_orders(at_risk_only: bool = Query(False, description="Filter only orders at delivery risk")) -> list[CustomerOrder]:
    """Retrieve customer orders, revenue values, SLA deadlines, and disruption exposure."""
    return local_supply_chain_repo.list_customer_orders(at_risk_only=at_risk_only)


# ==============================================================================
# 6. Disruptions & Mitigation Action Center
# ==============================================================================
@router.get("/disruptions", response_model=list[DisruptionEvent])
async def list_disruptions(active_only: bool = Query(True, description="Filter active unresolved disruptions")) -> list[DisruptionEvent]:
    """List active supply chain disruptions, root causes, and estimated daily financial losses."""
    return local_supply_chain_repo.list_disruptions(active_only=active_only)


@router.get("/mitigations", response_model=list[MitigationRecommendation])
async def list_mitigations() -> list[MitigationRecommendation]:
    """Retrieve actionable mitigation recommendations ranked by financial cost avoidance."""
    return supply_chain_risk_engine.generate_mitigation_recommendations()


@router.post("/mitigations/{recommendation_id}/approve", response_model=MitigationRecommendation)
async def approve_mitigation(
    recommendation_id: str,
    approver: str = Query("Supply Chain Operations Director", description="Approving authority"),
) -> MitigationRecommendation:
    """Approve a mitigation action (expedited freight, dual-sourcing) and update disruption status."""
    rec = local_supply_chain_repo.approve_mitigation(recommendation_id, approver)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Recommendation {recommendation_id} not found")
    return rec


# ==============================================================================
# 7. AI Conversational Analytics & What-If Simulation
# ==============================================================================
@router.post("/assistant/chat", response_model=SupplyChainChatResponse)
async def chat_with_assistant(request: SupplyChainChatRequest) -> SupplyChainChatResponse:
    """Natural-language supply chain questions with multi-source evidence grounding."""
    return await supply_chain_assistant_service.answer_query(request)


@router.post("/assistant/what-if", response_model=WhatIfSimulationResponse)
async def simulate_what_if(request: WhatIfSimulationRequest) -> WhatIfSimulationResponse:
    """Simulates a hypothetical supply disruption scenario; Muse Wonder briefs the simulated impact."""
    result = await supply_chain_assistant_service.simulate_what_if_with_briefing(request)
    return WHAT_IF_RUNS.record(result, subject_id=request.target_entity_id)


# ==============================================================================
# 8. Multi-Echelon Ontology & Advanced Operational Analytics
# ==============================================================================
@router.get("/carriers", response_model=list[Carrier])
async def list_carriers() -> list[Carrier]:
    """Retrieve logistics service providers and carrier on-time performance."""
    return local_supply_chain_repo.list_carriers()


@router.get("/warehouses", response_model=list[Warehouse])
async def list_warehouses(plant_id: Optional[str] = Query(None, description="Optional plant filter")) -> list[Warehouse]:
    """Retrieve dedicated regional warehouses with utilization and holding cost rates."""
    return local_supply_chain_repo.list_warehouses(plant_id=plant_id)


@router.get("/production-schedules", response_model=list[ProductionSchedule])
async def list_production_schedules(
    plant_id: Optional[str] = Query(None, description="Optional plant filter"),
    at_risk_only: bool = Query(False, description="Filter only schedules at HIGH or CRITICAL starvation risk"),
) -> list[ProductionSchedule]:
    """Retrieve plant production schedules and component line starvation risks."""
    return local_supply_chain_repo.list_production_schedules(plant_id=plant_id, at_risk_only=at_risk_only)


@router.get("/demand-forecasts", response_model=list[DemandForecast])
async def list_demand_forecasts(
    assembly_id: Optional[str] = Query(None, description="Optional finished assembly filter"),
) -> list[DemandForecast]:
    """Retrieve probabilistic demand forecasts (P10, P50, P90) with demand surge indicators."""
    return local_supply_chain_repo.list_demand_forecasts(assembly_id=assembly_id)


@router.get("/alternative-contracts", response_model=list[AlternativeSupplierContract])
async def list_alternative_contracts(
    part_id: Optional[str] = Query(None, description="Optional component part filter"),
) -> list[AlternativeSupplierContract]:
    """Retrieve pre-negotiated dual-source and contingency supplier contracts."""
    return local_supply_chain_repo.list_alternative_contracts(part_id=part_id)


@router.get("/inventory/excess")
async def get_excess_inventory_analytics() -> dict[str, Any]:
    """Quantifies excess inventory, tied-up working capital, and holding cost inefficiencies."""
    return supply_chain_risk_engine.evaluate_excess_inventory()


@router.get("/analytics/demand-supply-mismatch")
async def get_demand_supply_mismatches() -> list[dict[str, Any]]:
    """Evaluates multi-echelon demand-supply balance comparing forecast demand against available stock and inbound pipeline."""
    return supply_chain_risk_engine.evaluate_demand_supply_mismatches()


@router.get("/analytics/plant-vulnerability")
async def get_plant_vulnerabilities() -> list[dict[str, Any]]:
    """Ranks manufacturing plants by operational vulnerability, line starvation hours, and downtime cost exposure."""
    return supply_chain_risk_engine.evaluate_plant_vulnerability()


@router.post("/impact/trace/{disruption_id}", response_model=EndToEndImpactTrace)
async def trace_disruption_impact(disruption_id: str) -> EndToEndImpactTrace:
    """Traces an active disruption event across multi-echelon tiers: Inbound -> PO -> Shipment -> Inventory -> Starved Lines -> Customer Orders & SLA Loss."""
    trace = multi_echelon_impact_analyzer.trace_disruption_impact(disruption_id)
    if not trace:
        raise HTTPException(status_code=404, detail=f"Disruption {disruption_id} not found")
    return IMPACT_TRACES.record(trace, subject_id=disruption_id)


@router.post("/simulation/run")
async def run_scenario_simulation(payload: dict[str, Any]) -> dict[str, Any]:
    """Executes multi-vector What-If stress test (DEMAND_SURGE, CORRIDOR_CHOKEPOINT, SUPPLIER_SHUTDOWN) with governed SIMULATED_SCENARIO provenance."""
    scenario_type = payload.get("scenario_type", "DEMAND_SURGE")
    parameters = payload.get("parameters", {})
    return SIMULATION_RUNS.record(supply_chain_risk_engine.simulate_scenario(scenario_type=scenario_type, parameters=parameters), subject_id=scenario_type)


# ==============================================================================
# 9. Dynamic Configuration
# ==============================================================================
@router.get("/config", response_model=SupplyChainConfig)
async def get_supply_config() -> SupplyChainConfig:
    """Get active supply chain intelligence configuration."""
    return supply_config_store.get_config()


@router.put("/config", response_model=SupplyChainConfig)
async def update_supply_config(config: SupplyChainConfig) -> SupplyChainConfig:
    """Update supply chain thresholds dynamically."""
    return supply_config_store.update_config(config)


# ==============================================================================
# 9. Backward-Compatible Legacy Endpoints (For cross-feature test suites)
# ==============================================================================
@router.get("/stockout-risk/{part_number}", response_model=PartStockRisk)
async def get_stockout_risk(part_number: str) -> PartStockRisk:
    """Evaluate days of supply remaining and stockout probability."""
    return await _legacy_service.evaluate_stockout_risk(part_number)


@router.get("/supplier-risk/{supplier_id}", response_model=SupplierRiskScore)
async def get_supplier_risk(supplier_id: str) -> SupplierRiskScore:
    """Evaluate supplier delivery variance and risk level."""
    return await _legacy_service.evaluate_supplier_risk(supplier_id)


@router.post("/recommend-po/{part_number}", response_model=PurchaseOrderRecommendation)
async def recommend_po(part_number: str) -> PurchaseOrderRecommendation:
    """Generate dynamic replenishment purchase order recommendation."""
    return PO_RECOMMENDATIONS.record(await _legacy_service.generate_po_recommendation(part_number), subject_id=part_number)
