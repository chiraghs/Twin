"""Ports for supply chain intelligence."""
from abc import ABC, abstractmethod
from backend.core.interfaces.base import IInputPort, IOutputPort
from backend.features.supply_chain_intelligence.domain.models import (
    PartStockRisk,
    SupplierRiskScore,
    PurchaseOrderRecommendation,
)


class ISupplyChainUseCase(IInputPort, ABC):
    @abstractmethod
    async def evaluate_stockout_risk(self, part_number: str) -> PartStockRisk:
        pass

    @abstractmethod
    async def evaluate_supplier_risk(self, supplier_id: str) -> SupplierRiskScore:
        pass

    @abstractmethod
    async def generate_po_recommendation(self, part_number: str) -> PurchaseOrderRecommendation:
        pass


class IERPInventoryReader(IOutputPort, ABC):
    @abstractmethod
    async def get_inventory_record(self, part_number: str) -> dict[str, Any]:
        pass

    @abstractmethod
    async def get_supplier_performance(self, supplier_id: str) -> dict[str, Any]:
        pass
