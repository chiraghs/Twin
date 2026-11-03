"""Production Planning Service for Demand-Driven Operations.

Calculates:
Net Requirements = max(0, Forecast Demand + Safety Stock - Usable Inventory - Confirmed Supply)

Feasible Production Schedule considers:
- Machine & line operating hours
- Setup and changeover allocations
- Quality scrap and First-Pass Yield (FPY)
- Planned maintenance downtime blackouts
- Raw material component constraints
- Bottleneck identification and capacity utilization
"""
from datetime import datetime, date, timedelta, timezone
from typing import Any, Optional

from backend.features.demand_forecasting.schemas.manufacturing import (
    ProductionPlanSummary,
    RecommendedProductionOrder,
    ProductionCapacityReport,
    BottleneckReport,
    ItemCategory,
)
from backend.features.demand_forecasting.repositories.local_manufacturing_repo import (
    LocalManufacturingRepository,
    local_manufacturing_repo,
)
from backend.features.demand_forecasting.services.forecast_service import (
    DemandForecastingService,
    demand_forecasting_service,
)


class ProductionPlanningService:
    """Computes constraint-aware, demand-driven manufacturing production plans."""

    def __init__(
        self,
        repository: Optional[LocalManufacturingRepository] = None,
        forecast_service: Optional[DemandForecastingService] = None,
    ) -> None:
        self.repo = repository or local_manufacturing_repo
        self.forecast_service = forecast_service or demand_forecasting_service

    def generate_plan(
        self,
        plant_id: str = "PLANT_BANGALORE",
        horizon_days: int = 30,
        consider_maintenance: bool = True,
    ) -> ProductionPlanSummary:
        """Generates feasible production plan adhering strictly to capacity, quality, and material constraints."""
        plant = self.repo.plants.get(plant_id)
        if not plant:
            plant_id = "PLANT_BANGALORE"
            plant = self.repo.plants[plant_id]

        target_products = [p for p in self.repo.products.values() if p.target_plant_id == plant_id]

        recommended_orders: list[RecommendedProductionOrder] = []
        bottlenecks_identified: list[str] = []
        total_forecast_demand = 0.0
        total_planned_production = 0.0
        total_capacity_hours = 0.0
        total_utilized_hours = 0.0

        today = date.today()

        for prod in target_products:
            # 1. Forecast Demand
            forecast = self.forecast_service.run_enterprise_forecast(
                product_id=prod.product_id,
                plant_id=plant_id,
                horizon_days=horizon_days,
            )
            forecast_demand = forecast.total_forecasted_units
            total_forecast_demand += forecast_demand

            # 2. Inventory Position & Confirmed Supply
            inv = self.repo.inventory_positions.get(prod.product_id)
            usable_stock = inv.stock_usable if inv else 30.0
            safety_stock = prod.safety_stock_units
            confirmed_supply = inv.confirmed_incoming_pos if inv else 15.0

            # 3. Governing Net Requirements Formula
            # Net Requirements = max(0, Forecast Demand + Safety Stock - Usable Inventory - Confirmed Supply)
            net_req = max(0.0, forecast_demand + safety_stock - usable_stock - confirmed_supply)

            # 4. Find Associated Production Line & Available Machine Hours
            matched_line = next(
                (l for l in self.repo.lines.values() if prod.product_id in l.primary_product_ids and l.plant_id == plant_id),
                None,
            )
            line_id = matched_line.line_id if matched_line else f"LINE-{plant_id[:3]}-01"
            daily_line_hours = matched_line.daily_capacity_hours if matched_line else 20.0
            gross_line_hours = daily_line_hours * horizon_days
            total_capacity_hours += gross_line_hours

            # 5. Maintenance Downtime Windows
            maintenance_downtime_hours = 0.0
            if consider_maintenance:
                assets = [a for a in self.repo.equipment_assets.values() if a.line_id == line_id and a.plant_id == plant_id]
                maintenance_downtime_hours = sum(a.planned_downtime_hours_next_14d for a in assets)

            effective_capacity_hours = max(0.0, gross_line_hours - maintenance_downtime_hours)

            # 6. Quality Yield & Scrap Adjustment
            quality = self.repo.quality_summaries.get(plant_id)
            usable_yield_rate = (quality.estimated_usable_output_pct / 100.0) if quality else 0.98

            # Maximum units that can be produced within available machine hours
            cycle_time = max(0.2, prod.cycle_time_hours_per_unit)
            max_units_by_machine_capacity = (effective_capacity_hours / cycle_time) * usable_yield_rate

            # 7. Raw Material Availability Constraints
            infeasibility_reasons: list[str] = []
            assumptions: list[str] = []
            material_limit_units = 999999.0

            if prod.product_id == "PRD-CNC-5X":
                # Check MCU stock
                mcu_inv = self.repo.inventory_positions.get("RAW-MCU-8841")
                if mcu_inv and mcu_inv.stock_usable < net_req:
                    material_limit_units = mcu_inv.stock_usable + mcu_inv.confirmed_incoming_pos
                    infeasibility_reasons.append(
                        f"Raw material shortage: RAW-MCU-8841 limited to {material_limit_units:.0f} units (Usable: {mcu_inv.stock_usable})"
                    )
                    bottlenecks_identified.append(f"{line_id}: Material Shortage (RAW-MCU-8841)")

            # 8. Feasible Production Calculation
            feasible_units = min(net_req, max_units_by_machine_capacity, material_limit_units)
            feasible_units = round(max(0.0, feasible_units), 0)
            unmet_units = round(max(0.0, net_req - feasible_units), 0)

            total_planned_production += feasible_units
            hours_consumed = (feasible_units * cycle_time) / usable_yield_rate
            total_utilized_hours += hours_consumed

            if max_units_by_machine_capacity < net_req:
                infeasibility_reasons.append(
                    f"Line {line_id} capacity ceiling ({effective_capacity_hours:.0f}h) exceeded by {((net_req - max_units_by_machine_capacity) * cycle_time):.1f} required machine hours"
                )
                bottlenecks_identified.append(f"{line_id}: Capacity Ceiling")

            if maintenance_downtime_hours > 0:
                assumptions.append(f"Planned maintenance window reserved: {maintenance_downtime_hours:.1f} hours")
            assumptions.append(f"Standard cycle time: {cycle_time:.1f} h/unit | Usable yield rate: {usable_yield_rate:.1%}")

            recommended_orders.append(
                RecommendedProductionOrder(
                    recommendation_id=f"REC-PLAN-{prod.product_id}-{plant_id[:3]}",
                    product_id=prod.product_id,
                    product_name=prod.product_name,
                    plant_id=plant_id,
                    line_id=line_id,
                    target_start_date=(today + timedelta(days=2)).isoformat(),
                    target_completion_date=(today + timedelta(days=horizon_days)).isoformat(),
                    forecast_demand_units=round(forecast_demand, 0),
                    target_safety_stock_units=safety_stock,
                    usable_inventory_units=usable_stock,
                    confirmed_incoming_supply_units=confirmed_supply,
                    net_requirements_units=round(net_req, 0),
                    feasible_production_units=feasible_units,
                    unmet_demand_units=unmet_units,
                    infeasibility_reasons=infeasibility_reasons,
                    assumptions=assumptions,
                )
            )

        overall_utilization = (total_utilized_hours / max(1.0, total_capacity_hours)) * 100.0

        return ProductionPlanSummary(
            plant_id=plant_id,
            horizon_days=horizon_days,
            total_forecast_demand_units=round(total_forecast_demand, 0),
            total_planned_production_units=round(total_planned_production, 0),
            capacity_utilization_pct=round(min(100.0, overall_utilization), 1),
            projected_throughput_rate=round(total_planned_production / max(1, horizon_days), 1),
            orders=recommended_orders,
            bottlenecks=list(set(bottlenecks_identified)),
            generated_at=datetime.now(timezone.utc).isoformat(),
        )

    def get_capacity_reports(
        self, plant_id: Optional[str] = None, line_id: Optional[str] = None
    ) -> list[ProductionCapacityReport]:
        """Calculates capacity headroom, scheduled hours, and bottleneck statuses by line."""
        lines = list(self.repo.lines.values())
        if plant_id:
            lines = [l for l in lines if l.plant_id == plant_id]
        if line_id:
            lines = [l for l in lines if l.line_id == line_id]

        results = []
        for l in lines:
            total_hours = l.daily_capacity_hours * 30.0  # 30-day baseline
            # Check maintenance
            assets = [a for a in self.repo.equipment_assets.values() if a.line_id == l.line_id]
            maint_hours = sum(a.planned_downtime_hours_next_14d for a in assets) * 2.0  # 30d scaled
            scheduled_hours = total_hours * 0.82
            headroom = max(0.0, total_hours - scheduled_hours - maint_hours)
            utilization = ((scheduled_hours + maint_hours) / total_hours) * 100.0
            is_bottle = utilization >= 90.0

            results.append(
                ProductionCapacityReport(
                    line_id=l.line_id,
                    line_name=l.line_name,
                    plant_id=l.plant_id,
                    total_capacity_hours=round(total_hours, 1),
                    scheduled_production_hours=round(scheduled_hours, 1),
                    maintenance_downtime_hours=round(maint_hours, 1),
                    available_headroom_hours=round(headroom, 1),
                    utilization_pct=round(utilization, 1),
                    is_bottleneck=is_bottle,
                )
            )
        return results

    def get_bottlenecks(self, plant_id: Optional[str] = None) -> list[BottleneckReport]:
        """Identifies operational constraints across capacity, raw materials, and maintenance."""
        reports = []
        # Check high utilization lines
        caps = self.get_capacity_reports(plant_id=plant_id)
        for c in caps:
            if c.is_bottleneck:
                reports.append(
                    BottleneckReport(
                        line_id=c.line_id,
                        plant_id=c.plant_id,
                        constraint_type="CAPACITY_HOURS",
                        severity="CRITICAL",
                        description=f"Line operating near maximum capacity ceiling with only {c.available_headroom_hours:.1f}h headroom",
                        impacted_products=self.repo.lines[c.line_id].primary_product_ids if c.line_id in self.repo.lines else [],
                        hours_overloaded=max(0.0, (c.utilization_pct - 90.0) * 6.0),
                    )
                )

        # Check raw material stockouts
        for item_id, pos in self.repo.inventory_positions.items():
            if pos.potential_stockout_risk and pos.category == ItemCategory.RAW_MATERIAL:
                if plant_id is None or pos.plant_id == plant_id:
                    reports.append(
                        BottleneckReport(
                            line_id="LINE-BLR-01",
                            plant_id=pos.plant_id,
                            constraint_type="RAW_MATERIAL_SHORTAGE",
                            severity="CRITICAL",
                            description=f"Critical component {pos.item_name} ({item_id}) has only {pos.days_on_hand:.1f} days of supply left",
                            impacted_products=["PRD-CNC-5X"],
                            hours_overloaded=32.0,
                        )
                    )

        # Check equipment assets with high downtime
        for a_id, asset in self.repo.equipment_assets.items():
            if asset.health_status == "CRITICAL":
                if plant_id is None or asset.plant_id == plant_id:
                    reports.append(
                        BottleneckReport(
                            line_id=asset.line_id,
                            plant_id=asset.plant_id,
                            constraint_type="PLANNED_MAINTENANCE",
                            severity="HIGH",
                            description=f"Asset {asset.asset_name} ({a_id}) scheduled for {asset.planned_downtime_hours_next_14d:.0f}h maintenance",
                            impacted_products=["PRD-HYD-PRESS"],
                            hours_overloaded=asset.capacity_at_risk_hours,
                        )
                    )
        return reports


# Global singleton instance
production_planning_service = ProductionPlanningService()
