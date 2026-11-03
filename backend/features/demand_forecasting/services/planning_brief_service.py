"""S&OP planning brief: deterministic plan, capacity, inventory and quality data, briefed by Muse Wonder.

Every figure comes from the forecasting, planning and inventory services; Muse Wonder (Meta Model
API) turns them into a decision brief for the planning meeting, and the grounding check rejects
any invented number. Without a key the brief is assembled deterministically.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

from backend.core.ai.narration import grounded_answer
from backend.features.demand_forecasting.services.inventory_service import inventory_optimization_service
from backend.features.demand_forecasting.services.production_planning_service import production_planning_service


class PlanningBrief(BaseModel):
    plant_id: str
    horizon_days: int
    brief_markdown: str
    key_points: list[str] = Field(default_factory=list)
    generated_by: str
    ai_note: Optional[str] = None
    facts: dict[str, Any]
    requires_human_approval: bool = True
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


def _dump(items: Any, limit: int) -> list[dict[str, Any]]:
    return [i.model_dump(mode="json") if hasattr(i, "model_dump") else i for i in list(items or [])[:limit]]


def _fallback(facts: dict[str, Any]) -> str:
    plan = facts.get("plan") or {}
    lines = [f"### S&OP brief — {facts['plant_id']} · next {facts['horizon_days']} days", ""]
    lines.append(f"- **Demand vs plan**: {plan.get('total_forecast_demand_units', '?')} units forecast, "
                 f"{plan.get('total_planned_production_units', '?')} planned; capacity utilisation {plan.get('capacity_utilization_pct', '?')}%")
    for b in facts["bottlenecks"][:3]:
        lines.append(f"- **Bottleneck {b.get('line_id')}** ({b.get('severity')}): {b.get('description')} — {b.get('hours_overloaded')} h overloaded")
    for r in facts["stockout_risks"][:3]:
        lines.append(f"- **Stock-out risk {r.get('part_or_sku_id')}** {r.get('item_name')}: {r.get('days_on_hand')} days on hand, ETA {r.get('stockout_eta_days')} days")
    for r in facts["replenishment"][:3]:
        lines.append(f"- **Replenish {r.get('item_id')}**: order {r.get('suggested_order_quantity')} from {r.get('supplier_id')} "
                     f"(lead time {r.get('supplier_lead_time_days')} days, {r.get('urgency')})")
    lines += ["", "> Forecasts are model estimates. Decisions in this brief need planner approval before release to the MES / ERP."]
    return "\n".join(lines)


async def build_planning_brief(plant_id: str = "PLANT_BANGALORE", horizon_days: int = 30) -> PlanningBrief:
    plan = production_planning_service.generate_plan(plant_id=plant_id, horizon_days=horizon_days)
    facts = {
        "plant_id": plant_id,
        "horizon_days": horizon_days,
        "plan": {k: v for k, v in plan.model_dump(mode="json").items() if not isinstance(v, list)},
        "plan_lines": _dump(getattr(plan, "line_plans", None) or getattr(plan, "items", None), 12),
        "bottlenecks": _dump(production_planning_service.get_bottlenecks(plant_id=plant_id), 5),
        "stockout_risks": _dump(inventory_optimization_service.get_stockout_risks(plant_id=plant_id), 8),
        "replenishment": _dump(inventory_optimization_service.get_replenishment_recommendations(plant_id=plant_id), 8),
    }
    narration = await grounded_answer(
        role=(
            "You are Twin's S&OP planner. Write the brief for the weekly planning meeting: demand vs capacity, the binding "
            "bottleneck, material stock-out risks and the replenishment actions, then 2-3 decisions the team must take with "
            "their trade-offs. Make clear these are model forecasts."
        ),
        question=f"S&OP planning brief for {plant_id}, next {horizon_days} days",
        evidence=facts,
        fallback_markdown=_fallback(facts),
        reasoning=True,
        purpose="S&OP brief",
    )
    return PlanningBrief(plant_id=plant_id, horizon_days=horizon_days, brief_markdown=narration.text,
                         key_points=narration.key_points, generated_by=narration.generated_by, ai_note=narration.note, facts=facts)
