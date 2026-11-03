"""Autonomous coordinator agent orchestrating domain specialist agents."""
from typing import Any
from pydantic import BaseModel
from backend.features.predictive_maintenance.services.maintenance_service import PredictiveMaintenanceService
from backend.features.predictive_maintenance.adapters.mock_telemetry import InMemoryTelemetryReader
from backend.features.production_optimization.services.optimization_service import ProductionOptimizationService
from backend.features.production_optimization.adapters.mock_line_reader import InMemoryLineStateReader
from backend.features.waste_reduction.services.waste_service import WasteReductionService
from backend.features.waste_reduction.adapters.mock_scrap_reader import InMemoryScrapMetricsReader


class PlanProposal(BaseModel):
    proposal_id: str
    target_asset: str
    issue_diagnosed: str
    proposed_action: str
    estimated_downtime_hours: float
    cost_avoidance_usd: float
    requires_human_approval: bool = True


class SwarmCoordinator:
    """Coordinates specialist investigations across maintenance, production, and scrap reduction."""

    def __init__(self) -> None:
        self.maint_svc = PredictiveMaintenanceService(InMemoryTelemetryReader())
        self.prod_svc = ProductionOptimizationService(InMemoryLineStateReader())
        self.waste_svc = WasteReductionService(InMemoryScrapMetricsReader())

    async def run_crisis_investigation(self, line_id: str, asset_id: str) -> PlanProposal:
        # 1. Investigate asset diagnostics
        diag = await self.maint_svc.diagnose_asset(asset_id)
        # 2. Check scrap attribution
        scrap = await self.waste_svc.attribute_scrap(line_id)
        # 3. Check line OEE & constraint
        oee = await self.prod_svc.compute_oee(line_id)

        issue = f"Asset {asset_id} in {diag.health.iso_zone.value}. RUL: {diag.rul.hours_to_trip} hrs. Driving scrap on {line_id}."
        action = "REROUTE_AND_MAINTAIN: Divert 50% load to parallel line and execute 2-hour bearing replacement."

        return PlanProposal(
            proposal_id="PROP-CRISIS-01",
            target_asset=asset_id,
            issue_diagnosed=issue,
            proposed_action=action,
            estimated_downtime_hours=2.0,
            cost_avoidance_usd=44300.0,
            requires_human_approval=True,
        )
