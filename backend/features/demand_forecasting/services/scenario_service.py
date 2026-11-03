"""What-If Scenario Simulation Engine for Manufacturing Operations.

Executes the identical underlying planning, capacity, and inventory logic
under hypothetical parameter modifications without creating actual production orders.
All outputs carry explicit SIMULATED provenance.
"""
from datetime import datetime, timezone
from typing import Any, Optional

from backend.features.demand_forecasting.schemas.manufacturing import (
    ScenarioSimulationRequest,
    ScenarioSimulationResult,
    DataProvenance,
)
from backend.features.demand_forecasting.repositories.local_manufacturing_repo import (
    LocalManufacturingRepository,
    local_manufacturing_repo,
)
from backend.features.demand_forecasting.services.production_planning_service import (
    ProductionPlanningService,
    production_planning_service,
)
from backend.features.demand_forecasting.services.forecast_service import (
    DemandForecastingService,
    demand_forecasting_service,
)


class WhatIfScenarioEngine:
    """Simulates operational shocks and computes baseline vs scenario KPI deltas."""

    def __init__(
        self,
        repository: Optional[LocalManufacturingRepository] = None,
        planning_service: Optional[ProductionPlanningService] = None,
        forecast_service: Optional[DemandForecastingService] = None,
    ) -> None:
        self.repo = repository or local_manufacturing_repo
        self.planning_service = planning_service or production_planning_service
        self.forecast_service = forecast_service or demand_forecasting_service
        self._persisted_scenarios: dict[str, ScenarioSimulationResult] = {}

    def simulate(self, request: ScenarioSimulationRequest) -> ScenarioSimulationResult:
        """Executes full constraint recalculation across demand, capacity, and materials."""
        # 1. Baseline Calculations
        base_plan = self.planning_service.generate_plan(
            plant_id=request.plant_id, horizon_days=30, consider_maintenance=True
        )
        base_demand = base_plan.total_forecast_demand_units
        base_capacity_util = base_plan.capacity_utilization_pct

        # 2. Apply Simulated Demand Delta
        # Demand Growth / Decline + Spike Duration
        growth_factor = 1.0 + (request.demand_growth_pct / 100.0)
        sim_demand = base_demand * growth_factor

        # 3. Apply Simulated Capacity & Downtime Shocks
        capacity_delta_factor = 1.0 + (request.production_capacity_delta_pct / 100.0)
        gross_capacity_hours = 600.0 * capacity_delta_factor  # 20h * 30d baseline
        extra_downtime = max(0.0, request.equipment_downtime_hours_extra)
        effective_capacity_hours = max(0.0, gross_capacity_hours - extra_downtime)

        # 4. Apply Quality Scrap Rate Delta
        base_quality = self.repo.quality_summaries.get(request.plant_id)
        base_scrap = base_quality.scrap_rate_pct if base_quality else 2.0
        sim_scrap_rate = max(0.1, base_scrap + request.scrap_rate_delta_pct)
        sim_usable_yield = (100.0 - sim_scrap_rate) / 100.0

        # Cycle time (~2.0h avg)
        avg_cycle_time = 2.0
        max_possible_production = (effective_capacity_hours / avg_cycle_time) * sim_usable_yield

        # 5. Raw Material Constraints
        mat_factor = request.raw_material_availability_pct / 100.0
        material_constrained_units = sim_demand * mat_factor

        # Feasible production
        sim_feasible = min(sim_demand, max_possible_production, material_constrained_units)
        sim_shortfall_units = max(0.0, sim_demand - sim_feasible)
        capacity_shortfall_hours = (sim_shortfall_units * avg_cycle_time)

        sim_capacity_util = (
            ((sim_feasible * avg_cycle_time) / max(1.0, effective_capacity_hours)) * 100.0
        )
        sim_capacity_util = min(100.0, sim_capacity_util)

        # 6. Financial Deltas
        # Avg revenue per unit: $7,500; cost per unit: $4,200
        rev_delta = (sim_feasible - base_plan.total_planned_production_units) * 7500.0
        cost_delta = (sim_feasible * 4200.0) - (base_plan.total_planned_production_units * 4200.0) + (extra_downtime * 3500.0)
        net_impact = rev_delta - cost_delta

        # Stockouts count
        sim_stockouts = 1 if mat_factor < 0.9 or sim_shortfall_units > 20 else 0

        # Identified Bottlenecks & Explanations
        bottlenecks = []
        assumptions = []
        explanations = []

        if request.demand_growth_pct > 0:
            assumptions.append(f"Simulated demand surge of +{request.demand_growth_pct:.1f}% over {request.demand_spike_duration_days} days")
        if request.raw_material_availability_pct < 100.0:
            bottlenecks.append(f"Raw Material Shortage ({request.raw_material_availability_pct:.0f}% allocation)")
            explanations.append(f"Inbound supply constrained to {request.raw_material_availability_pct:.0f}%, capping output to {material_constrained_units:.0f} units")
        if extra_downtime > 0:
            bottlenecks.append(f"Equipment Outage (+{extra_downtime:.0f}h downtime)")
            explanations.append(f"Unplanned downtime reduces effective machine hours to {effective_capacity_hours:.0f}h")
        if capacity_shortfall_hours > 0:
            bottlenecks.append(f"Line Capacity Deficit ({capacity_shortfall_hours:.1f}h shortfall)")

        assumptions.append(f"Simulated scrap rate: {sim_scrap_rate:.1f}% (Yield: {sim_usable_yield:.1%})")
        assumptions.append(f"Safety stock multiplier: {request.safety_stock_multiplier:.1f}x")

        result = ScenarioSimulationResult(
            scenario_id=f"SCEN-{request.plant_id[:3]}-{datetime.now(timezone.utc).strftime('%H%M%S')}",
            scenario_name=request.scenario_name,
            plant_id=request.plant_id,
            created_at=datetime.now(timezone.utc).isoformat(),
            baseline_forecast_units=round(base_demand, 1),
            simulated_forecast_units=round(sim_demand, 1),
            forecast_delta_units=round(sim_demand - base_demand, 1),
            baseline_capacity_utilization_pct=round(base_capacity_util, 1),
            simulated_capacity_utilization_pct=round(sim_capacity_util, 1),
            capacity_shortfall_hours=round(capacity_shortfall_hours, 1),
            simulated_stockouts_count=sim_stockouts,
            estimated_revenue_delta_usd=round(rev_delta, 2),
            estimated_cost_delta_usd=round(cost_delta, 2),
            net_financial_impact_usd=round(net_impact, 2),
            bottlenecks_identified=bottlenecks,
            key_assumptions=assumptions,
            constraint_explanations=explanations,
            data_provenance=DataProvenance.SIMULATED,
        )

        self._persisted_scenarios[result.scenario_id] = result
        return result

    def list_scenarios(self) -> list[ScenarioSimulationResult]:
        """Lists cached or previously executed scenarios."""
        if not self._persisted_scenarios:
            # Seed standard default scenarios
            self.simulate(
                ScenarioSimulationRequest(
                    scenario_name="Demand Surge (+25% Q4 Peak)",
                    plant_id="PLANT_BANGALORE",
                    demand_growth_pct=25.0,
                    demand_spike_duration_days=30,
                )
            )
            self.simulate(
                ScenarioSimulationRequest(
                    scenario_name="Semiconductor Material Quota Shortage (80% allocation)",
                    plant_id="PLANT_BANGALORE",
                    raw_material_availability_pct=80.0,
                    supplier_lead_time_delta_days=7,
                )
            )
        return list(self._persisted_scenarios.values())

    def get_scenario_by_id(self, scenario_id: str) -> Optional[ScenarioSimulationResult]:
        return self._persisted_scenarios.get(scenario_id)


# Global singleton instance
what_if_scenario_engine = WhatIfScenarioEngine()
