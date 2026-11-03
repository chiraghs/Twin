"""FastAPI router for waste reduction with dynamic configuration."""
from fastapi import APIRouter
from backend.features.waste_reduction.services.waste_service import WasteReductionService
from backend.features.waste_reduction.adapters.mock_scrap_reader import InMemoryScrapMetricsReader
from backend.features.waste_reduction.domain.models import (
    ScrapAttributionReport,
    MachineEnergyWasteReport,
    CarbonFootprintReport,
)
from backend.features.waste_reduction.config.models import (
    WasteReductionConfig,
    waste_config_store,
)

router = APIRouter(prefix="/waste", tags=["Waste Reduction & Sustainability"])

_reader = InMemoryScrapMetricsReader()
_service = WasteReductionService(_reader, waste_config_store)


@router.get("/scrap-attribution/{line_id}", response_model=ScrapAttributionReport)
async def get_scrap_attribution(line_id: str) -> ScrapAttributionReport:
    """Attribute scrap causes to specific upstream machine degradation."""
    return await _service.attribute_scrap(line_id)


@router.get("/energy-waste/{asset_id}", response_model=MachineEnergyWasteReport)
async def get_energy_waste(asset_id: str) -> MachineEnergyWasteReport:
    """Detect machine idle power waste and excess friction drag."""
    return await _service.evaluate_machine_energy_waste(asset_id)


@router.get("/carbon/{product_id}", response_model=CarbonFootprintReport)
async def get_carbon_footprint(product_id: str) -> CarbonFootprintReport:
    """Calculate unit-level embodied Scope 1 and Scope 2 GHG emissions."""
    return await _service.compute_unit_carbon_footprint(product_id)


@router.get("/config", response_model=WasteReductionConfig)
async def get_waste_config() -> WasteReductionConfig:
    """Get active waste reduction and sustainability tariffs."""
    return waste_config_store.get_config()


@router.put("/config", response_model=WasteReductionConfig)
async def update_waste_config(config: WasteReductionConfig) -> WasteReductionConfig:
    """Update waste parameters and electricity tariffs dynamically."""
    return waste_config_store.update_config(config)
