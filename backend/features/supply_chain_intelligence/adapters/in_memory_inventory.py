"""In-memory ERP inventory reader adapter."""
from typing import Any
from backend.features.supply_chain_intelligence.ports.contracts import IERPInventoryReader


class InMemoryERPReader(IERPInventoryReader):
    async def get_inventory_record(self, part_number: str) -> dict[str, Any]:
        return {
            "part_number": part_number,
            "part_name": f"Component {part_number}",
            "stock_on_hand": 380,
            "daily_consumption": 120.0,
            "safety_stock": 450,
        }

    async def get_supplier_performance(self, supplier_id: str) -> dict[str, Any]:
        return {
            "supplier_id": supplier_id,
            "supplier_name": "Apex Micro Devices",
            "on_time_delivery_rate": 0.91,
            "lead_time_variance_days": 2.4,
            "geopolitical_risk_score": 0.18,
        }
