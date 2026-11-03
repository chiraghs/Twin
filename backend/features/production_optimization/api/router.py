"""FastAPI router for production optimization with dynamic configuration."""
from fastapi import APIRouter
from backend.features.production_optimization.services.optimization_service import ProductionOptimizationService
from backend.features.production_optimization.adapters.mock_line_reader import InMemoryLineStateReader
from backend.features.production_optimization.domain.models import OEEMetrics, LineThroughputAnalysis
from backend.features.production_optimization.config.models import (
    ProductionOptimizationConfig,
    production_config_store,
)

router = APIRouter(prefix="/production", tags=["Production Optimization"])

_reader = InMemoryLineStateReader()
_service = ProductionOptimizationService(_reader, production_config_store)


@router.get("/oee/{line_id}", response_model=OEEMetrics)
async def get_line_oee(line_id: str) -> OEEMetrics:
    """Compute real-time Overall Equipment Effectiveness (OEE)."""
    return await _service.compute_oee(line_id)


@router.get("/throughput/{line_id}", response_model=LineThroughputAnalysis)
async def get_line_throughput(line_id: str) -> LineThroughputAnalysis:
    """Analyze line bottleneck, work-in-progress, and throughput pacing."""
    return await _service.analyze_line_throughput(line_id)


@router.get("/config", response_model=ProductionOptimizationConfig)
async def get_production_config() -> ProductionOptimizationConfig:
    """Get active production optimization configuration."""
    return production_config_store.get_config()


@router.put("/config", response_model=ProductionOptimizationConfig)
async def update_production_config(config: ProductionOptimizationConfig) -> ProductionOptimizationConfig:
    """Update production targets and cycle parameters dynamically."""
    return production_config_store.update_config(config)
