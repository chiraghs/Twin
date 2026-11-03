"""Model Context Protocol (MCP) Tool Suite exposing all 7 feature domains."""
from typing import Any
from mcp.server.fastmcp import FastMCP

# Initialize FastMCP Server
mcp_server = FastMCP(name="Twin Enterprise MCP Server")


@mcp_server.tool()
async def diagnose_bearing_health(asset_id: str) -> dict[str, Any]:
    """Diagnose bearing vibration, temperature, and ISO 10816-3 severity zone for an asset."""
    from backend.features.predictive_maintenance.services.maintenance_service import PredictiveMaintenanceService
    from backend.features.predictive_maintenance.adapters.mock_telemetry import InMemoryTelemetryReader
    svc = PredictiveMaintenanceService(InMemoryTelemetryReader())
    res = await svc.diagnose_asset(asset_id)
    return res.model_dump()


@mcp_server.tool()
async def inspect_optical_quality(camera_id: str, part_id: str) -> dict[str, Any]:
    """Inspect a manufactured part using Automated Optical Inspection against golden template."""
    from backend.features.visual_quality_inspection.services.quality_service import VisualQualityService
    from backend.features.visual_quality_inspection.adapters.in_memory_store import InMemoryInspectionStore
    svc = VisualQualityService(InMemoryInspectionStore())
    res = await svc.inspect_part(camera_id, part_id)
    return res.model_dump()


@mcp_server.tool()
async def get_line_oee(line_id: str) -> dict[str, Any]:
    """Calculate real-time Overall Equipment Effectiveness (Availability x Performance x Quality)."""
    from backend.features.production_optimization.services.optimization_service import ProductionOptimizationService
    from backend.features.production_optimization.adapters.mock_line_reader import InMemoryLineStateReader
    svc = ProductionOptimizationService(InMemoryLineStateReader())
    res = await svc.compute_oee(line_id)
    return res.model_dump()


@mcp_server.tool()
async def check_supply_stockout_risk(part_number: str) -> dict[str, Any]:
    """Evaluate days of supply remaining, safety stock, and stockout probability for a component."""
    from backend.features.supply_chain_intelligence.services.supply_service import SupplyChainService
    from backend.features.supply_chain_intelligence.adapters.in_memory_inventory import InMemoryERPReader
    svc = SupplyChainService(InMemoryERPReader())
    res = await svc.evaluate_stockout_risk(part_number)
    return res.model_dump()


@mcp_server.tool()
async def get_demand_forecast(product_id: str, horizon_weeks: int = 4) -> dict[str, Any]:
    """Generate probabilistic P10/P50/P90 demand forecast for a product."""
    from backend.features.demand_forecasting.services.forecast_service import DemandForecastingService
    from backend.features.demand_forecasting.adapters.mock_order_reader import InMemoryOrderReader
    svc = DemandForecastingService(InMemoryOrderReader())
    res = await svc.forecast_product_demand(product_id, horizon_weeks)
    return res.model_dump()


@mcp_server.tool()
async def get_scrap_root_causes(line_id: str) -> dict[str, Any]:
    """Attribute scrap causes to specific upstream machine degradation and wear."""
    from backend.features.waste_reduction.services.waste_service import WasteReductionService
    from backend.features.waste_reduction.adapters.mock_scrap_reader import InMemoryScrapMetricsReader
    svc = WasteReductionService(InMemoryScrapMetricsReader())
    res = await svc.attribute_scrap(line_id)
    return res.model_dump()


@mcp_server.tool()
async def explain_alarm(asset_id: str, alarm_code: str) -> dict[str, Any]:
    """Provide verified OEM manual troubleshooting steps for an active machinery alarm."""
    from backend.features.operational_copilots.services.copilot_service import OperationalCopilotService
    from backend.features.operational_copilots.adapters.mock_shift_reader import InMemoryShiftLogReader
    svc = OperationalCopilotService(InMemoryShiftLogReader())
    res = await svc.diagnose_alarm(asset_id, alarm_code)
    return res.model_dump()
