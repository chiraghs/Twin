"""Twin Enterprise Backend - Main Application Entrypoint."""
import hmac
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from backend.core.config.settings import settings
from backend.features.predictive_maintenance.api.router import router as maint_router, root_router as maint_root_router
from backend.features.visual_quality_inspection.api.router import router as quality_router
from backend.features.production_optimization.api.router import router as prod_router
from backend.features.supply_chain_intelligence.api.router import router as supply_router
from backend.features.demand_forecasting.api.router import router as demand_router
from backend.features.waste_reduction.api.router import router as waste_router
from backend.features.operational_copilots.api.router import router as copilot_router
from backend.core.api.data_router import router as data_router

tags_metadata = [
    {
        "name": "Predictive Maintenance",
        "description": "Remaining Useful Life (RUL) estimation, ISO 10816-3 vibration severity classification, and bearing diagnostic reports.",
    },
    {
        "name": "Visual Quality Inspection",
        "description": "Automated Optical Inspection (AOI), golden template alignment, First-Pass Yield (FPY), DPMO, and defect Pareto analysis.",
    },
    {
        "name": "Production Optimization",
        "description": "Overall Equipment Effectiveness (OEE = Availability × Performance × Quality), Little's Law throughput pacing, and bottleneck station detection.",
    },
    {
        "name": "Supply Chain Intelligence",
        "description": "Dynamic safety stock calculation, Bill-of-Materials (BOM) stockout risk evaluation, and purchase order replenishment.",
    },
    {
        "name": "Demand Forecasting",
        "description": "Probabilistic P10/P50/P90 multi-horizon demand forecasting, order backlog pacing, and plant capacity headroom checks.",
    },
    {
        "name": "Waste Reduction & Sustainability",
        "description": "Scrap root-cause causal attribution, machine idle friction energy losses, and unit-level Scope 1 & 2 carbon footprint accounting.",
    },
    {
        "name": "Operational Copilots",
        "description": "Interactive Standard Operating Procedure (SOP) step-by-step guidance, automated shift handover reports, and PLC alarm code triage.",
    },
    {
        "name": "System Health",
        "description": "Backend liveness probes, heartbeat, and platform configuration status.",
    },
]

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Twin industrial intelligence backend on Meta Model API (Muse Spark, Muse Wonder, SAM 3.1): predictive maintenance, visual inspection, optimization, supply chain, demand planning and copilots",
    openapi_tags=tags_metadata,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_OPEN_PATHS = {"/health", "/ready"}


@app.middleware("http")
async def require_service_token(request: Request, call_next):
    """With INTELLIGENCE_BACKEND_TOKEN set, every route except health checks needs that bearer token
    (the web app's /api/backend proxy sends it)."""
    token = os.getenv("INTELLIGENCE_BACKEND_TOKEN", "")
    if token and request.method != "OPTIONS" and request.url.path not in _OPEN_PATHS:
        given = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if not hmac.compare_digest(given.encode(), token.encode()):
            return JSONResponse({"detail": "Missing or invalid service token"}, status_code=401)
    return await call_next(request)


# Mount all 7 feature routers
app.include_router(maint_router, prefix="/api/v1")
app.include_router(quality_router, prefix="/api/v1")
app.include_router(prod_router, prefix="/api/v1")
app.include_router(supply_router, prefix="/api/v1")
app.include_router(demand_router, prefix="/api/v1")
app.include_router(waste_router, prefix="/api/v1")
app.include_router(copilot_router, prefix="/api/v1")
app.include_router(data_router, prefix="/api/v1")

# Mount root machine endpoints for top-level access
app.include_router(maint_root_router)


@app.get("/health", tags=["System Health"])
async def health_check() -> dict[str, str]:
    return {"status": "HEALTHY", "app": settings.app_name}


@app.get("/ai/status", tags=["System Health"])
async def ai_status() -> dict[str, Any]:
    """Meta Model API configuration (models in use, enabled or why not) and the latest model calls."""
    from backend.core.ai import meta_client

    return meta_client.status()


@app.get("/ready", tags=["System Health"])
async def readiness_check() -> dict[str, Any]:
    return {
        "ready": True,
        "status": "READY",
        "app": settings.app_name,
        "database": f"SQLite ({__import__('backend.core.db', fromlist=['db_path']).db_path()})",
        "ai": "Meta Model API" if __import__("backend.core.ai", fromlist=["meta_client"]).meta_client.enabled else "Meta Model API not configured (deterministic mode)",
    }

