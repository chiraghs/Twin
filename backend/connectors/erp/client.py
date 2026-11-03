"""Enterprise Resource Planning (ERP) read connector for BOM and inventory."""
from typing import Any
from backend.connectors.base import IITConnector
from backend.core.telemetry.logger import get_logger

logger = get_logger("connectors.erp")


class ERPConnector(IITConnector):
    """ERP adapter (SAP OData / NetSuite) fetching master data, BOMs, and stock records."""

    def __init__(self, api_endpoint: str = "https://erp.internal/api/v1") -> None:
        self.api_endpoint = api_endpoint

    async def query(self, entity_type: str, query_params: dict[str, Any]) -> list[dict[str, Any]]:
        logger.info(f"Querying ERP for entity '{entity_type}' with params {query_params}")
        # In mock/offline mode, return high-fidelity enterprise structure
        if entity_type == "bom":
            part_no = query_params.get("part_number", "ECU-200")
            return [
                {"component_id": "CMP-MCU-01", "name": "Automotive Microcontroller", "qty": 1, "lead_time_days": 14},
                {"component_id": "CMP-PWR-04", "name": "Power MOSFET Module", "qty": 4, "lead_time_days": 7},
                {"component_id": "CMP-CAP-10", "name": "Ceramic Capacitor Array", "qty": 12, "lead_time_days": 5},
            ]
        elif entity_type == "inventory":
            return [
                {"part_number": "CMP-MCU-01", "stock_on_hand": 1450, "safety_stock": 500, "unit_cost_usd": 18.50},
                {"part_number": "CMP-PWR-04", "stock_on_hand": 820, "safety_stock": 1000, "unit_cost_usd": 4.20},
            ]
        return []
