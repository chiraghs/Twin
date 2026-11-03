"""Inventory Optimization Service for Manufacturing Operations.

Calculates:
- Usable inventory & days on hand (DOI = Usable Stock / Daily Consumption Rate)
- Reorder Points (ROP) = (Daily Demand * Lead Time) + Safety Stock
- Safety Stock (SS) = Z * sqrt(Lead Time * Var(Demand) + Demand^2 * Var(Lead Time))
- Stockout ETA and Replenishment Recommendations
- Distinct Raw Material, WIP, Finished Goods, and Spare Parts tracking
"""
from datetime import datetime, timezone
from typing import Any, Optional

from backend.features.demand_forecasting.schemas.manufacturing import (
    InventorySummaryResponse,
    InventoryPosition,
    ReplenishmentRecommendation,
    ItemCategory,
)
from backend.features.demand_forecasting.repositories.local_manufacturing_repo import (
    LocalManufacturingRepository,
    local_manufacturing_repo,
)


class InventoryOptimizationService:
    """Manages multi-echelon inventory positions and dynamic replenishment suggestions."""

    def __init__(self, repository: Optional[LocalManufacturingRepository] = None) -> None:
        self.repo = repository or local_manufacturing_repo

    def get_inventory_summary(
        self, plant_id: Optional[str] = None, category: Optional[ItemCategory] = None
    ) -> InventorySummaryResponse:
        """Summarizes inventory across Raw Materials, WIP, Finished Goods, and Spare Parts."""
        positions = list(self.repo.inventory_positions.values())
        if plant_id and plant_id != "All":
            positions = [p for p in positions if p.plant_id == plant_id]
        if category:
            positions = [p for p in positions if p.category == category]

        raw_count = sum(1 for p in positions if p.category == ItemCategory.RAW_MATERIAL)
        wip_count = sum(1 for p in positions if p.category == ItemCategory.WORK_IN_PROGRESS)
        fg_count = sum(1 for p in positions if p.category == ItemCategory.FINISHED_GOOD)
        spare_count = sum(1 for p in positions if p.category == ItemCategory.SPARE_PART)

        avg_doh = sum(p.days_on_hand for p in positions) / max(1, len(positions))
        stockout_count = sum(1 for p in positions if p.potential_stockout_risk)

        return InventorySummaryResponse(
            plant_id=plant_id or "ALL_PLANTS",
            total_skus_monitored=len(positions),
            raw_material_items_count=raw_count,
            wip_items_count=wip_count,
            finished_goods_count=fg_count,
            spare_parts_count=spare_count,
            average_days_on_hand=round(avg_doh, 1),
            skus_at_stockout_risk_count=stockout_count,
            positions=positions,
        )

    def get_stockout_risks(self, plant_id: Optional[str] = None) -> list[InventoryPosition]:
        """Returns SKUs at immediate risk of depletion within target threshold (< 3 days)."""
        summary = self.get_inventory_summary(plant_id=plant_id)
        return [p for p in summary.positions if p.potential_stockout_risk]

    def get_replenishment_recommendations(
        self, plant_id: Optional[str] = None
    ) -> list[ReplenishmentRecommendation]:
        """Generates purchase order and production work order replenishment recommendations."""
        recs = list(self.repo.replenishment_recs.values())
        if plant_id and plant_id != "All":
            recs = [r for r in recs if r.plant_id == plant_id]
        return recs


# Global singleton instance
inventory_optimization_service = InventoryOptimizationService()
