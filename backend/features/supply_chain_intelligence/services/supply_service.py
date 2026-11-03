"""Supply chain intelligence service using dynamic inventory thresholds."""
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional
from backend.features.supply_chain_intelligence.ports.contracts import (
    ISupplyChainUseCase,
    IERPInventoryReader,
)
from backend.features.supply_chain_intelligence.domain.models import (
    PartStockRisk,
    SupplierRiskScore,
    PurchaseOrderRecommendation,
)
from backend.features.supply_chain_intelligence.config.models import (
    SupplyConfigStore,
    supply_config_store,
)


class SupplyChainService(ISupplyChainUseCase):
    def __init__(
        self,
        erp_reader: IERPInventoryReader,
        config_store: Optional[SupplyConfigStore] = None,
    ) -> None:
        self.erp = erp_reader
        self.config_store = config_store or supply_config_store

    async def evaluate_stockout_risk(self, part_number: str) -> PartStockRisk:
        cfg = self.config_store.get_config()
        record = await self.erp.get_inventory_record(part_number)
        stock = record.get("stock_on_hand", 1000)
        daily_use = record.get("daily_consumption", 150.0)
        safety_stock = record.get("safety_stock", 400)

        days_remaining = round(stock / daily_use, 1) if daily_use > 0 else 999.0
        at_risk = stock <= safety_stock or days_remaining < cfg.critical_days_of_supply_threshold

        return PartStockRisk(
            part_number=part_number,
            part_name=record.get("part_name", part_number),
            stock_on_hand=stock,
            daily_consumption_rate=daily_use,
            days_of_supply_remaining=days_remaining,
            safety_stock_threshold=safety_stock,
            is_at_risk_of_stockout=at_risk,
        )

    async def evaluate_supplier_risk(self, supplier_id: str) -> SupplierRiskScore:
        perf = await self.erp.get_supplier_performance(supplier_id)
        otd = perf.get("on_time_delivery_rate", 0.94)
        variance = perf.get("lead_time_variance_days", 1.8)
        geo_risk = perf.get("geopolitical_risk_score", 0.15)

        composite = (1.0 - otd) * 0.4 + (variance / 10.0) * 0.3 + geo_risk * 0.3
        if composite > 0.4:
            level = "HIGH"
        elif composite > 0.2:
            level = "MEDIUM"
        else:
            level = "LOW"

        return SupplierRiskScore(
            supplier_id=supplier_id,
            supplier_name=perf.get("supplier_name", f"Supplier {supplier_id}"),
            on_time_delivery_rate=round(otd, 2),
            lead_time_variance_days=round(variance, 1),
            geopolitical_risk_score=round(geo_risk, 2),
            composite_risk_level=level,
        )

    async def generate_po_recommendation(self, part_number: str) -> PurchaseOrderRecommendation:
        cfg = self.config_store.get_config()
        risk = await self.evaluate_stockout_risk(part_number)
        order_qty = max(cfg.min_recommended_po_qty, risk.safety_stock_threshold * 2)

        urgency = "CRITICAL" if risk.is_at_risk_of_stockout else "ROUTINE"
        deadline = datetime.utcnow() + (timedelta(days=2) if urgency == "CRITICAL" else timedelta(days=7))

        return PurchaseOrderRecommendation(
            recommendation_id=str(uuid.uuid4())[:8],
            part_number=part_number,
            suggested_order_qty=order_qty,
            supplier_id="SUP-GLOBAL-01",
            estimated_cost_usd=round(order_qty * cfg.default_component_cost_usd, 2),
            urgency=urgency,
            order_deadline=deadline,
        )
