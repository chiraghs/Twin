"""Unit tests for all 7 feature domain services."""
try:
    import pytest
except ImportError:
    class _MockPytest:
        class mark:
            @staticmethod
            def asyncio(f):
                return f
    pytest = _MockPytest()
from backend.features.predictive_maintenance.services.maintenance_service import PredictiveMaintenanceService
from backend.features.predictive_maintenance.adapters.mock_telemetry import InMemoryTelemetryReader
from backend.features.predictive_maintenance.domain.models import ISO10816Severity

from backend.features.visual_quality_inspection.services.quality_service import VisualQualityService
from backend.features.visual_quality_inspection.adapters.in_memory_store import InMemoryInspectionStore
from backend.features.visual_quality_inspection.domain.models import InspectionVerdict

from backend.features.production_optimization.services.optimization_service import ProductionOptimizationService
from backend.features.production_optimization.adapters.mock_line_reader import InMemoryLineStateReader

from backend.features.supply_chain_intelligence.services.supply_service import SupplyChainService
from backend.features.supply_chain_intelligence.adapters.in_memory_inventory import InMemoryERPReader

from backend.features.demand_forecasting.services.forecast_service import DemandForecastingService
from backend.features.demand_forecasting.adapters.mock_order_reader import InMemoryOrderReader

from backend.features.waste_reduction.services.waste_service import WasteReductionService
from backend.features.waste_reduction.adapters.mock_scrap_reader import InMemoryScrapMetricsReader

from backend.features.operational_copilots.services.copilot_service import OperationalCopilotService
from backend.features.operational_copilots.adapters.mock_shift_reader import InMemoryShiftLogReader

from backend.agents.orchestrator.coordinator import SwarmCoordinator


@pytest.mark.asyncio
async def test_predictive_maintenance():
    svc = PredictiveMaintenanceService(InMemoryTelemetryReader())
    report = await svc.diagnose_asset("A-ROB-03")
    assert report.asset_id == "A-ROB-03"
    assert report.health.vibration_rms == 5.4
    assert report.health.iso_zone == ISO10816Severity.ZONE_C_UNSATISFACTORY
    assert report.rul.hours_to_trip > 0.0


@pytest.mark.asyncio
async def test_visual_quality():
    svc = VisualQualityService(InMemoryInspectionStore())
    res_pass = await svc.inspect_part("CAM-01", "PART-102")
    assert res_pass.verdict == InspectionVerdict.PASS

    res_fail = await svc.inspect_part("CAM-01", "PART-105-DEF")
    assert res_fail.verdict == InspectionVerdict.FAIL
    assert len(res_fail.defects) > 0


@pytest.mark.asyncio
async def test_production_optimization():
    svc = ProductionOptimizationService(InMemoryLineStateReader())
    oee = await svc.compute_oee("LINE-A")
    assert oee.overall_oee_pct > 0.0
    throughput = await svc.analyze_line_throughput("LINE-A")
    assert throughput.bottleneck.asset_id == "A-ROB-03"


@pytest.mark.asyncio
async def test_supply_chain():
    svc = SupplyChainService(InMemoryERPReader())
    risk = await svc.evaluate_stockout_risk("CMP-MCU-01")
    assert risk.stock_on_hand == 380
    po = await svc.generate_po_recommendation("CMP-MCU-01")
    assert po.suggested_order_qty >= 500


@pytest.mark.asyncio
async def test_demand_forecasting():
    svc = DemandForecastingService(InMemoryOrderReader())
    forecast = await svc.forecast_product_demand("ECU-200")
    assert forecast.p50_units > forecast.p10_units
    assert forecast.p90_units > forecast.p50_units


@pytest.mark.asyncio
async def test_waste_reduction():
    svc = WasteReductionService(InMemoryScrapMetricsReader())
    scrap = await svc.attribute_scrap("LINE-A")
    assert scrap.total_scrap_units > 0
    assert scrap.top_root_cause_asset == "A-ROB-03"

    energy = await svc.evaluate_machine_energy_waste("A-ROB-03")
    assert energy.friction_waste_kw == 2.2


@pytest.mark.asyncio
async def test_operational_copilot():
    svc = OperationalCopilotService(InMemoryShiftLogReader())
    sop = await svc.get_sop_step("SOP-LOTO-01", 1)
    assert "Lockout" in sop.title
    handover = await svc.generate_shift_handover("LINE-A", "Morning Shift")
    assert handover.units_produced == 1420


@pytest.mark.asyncio
async def test_swarm_coordinator():
    coord = SwarmCoordinator()
    plan = await coord.run_crisis_investigation("LINE-A", "A-ROB-03")
    assert plan.target_asset == "A-ROB-03"
    assert "REROUTE_AND_MAINTAIN" in plan.proposed_action
    assert plan.requires_human_approval is True


@pytest.mark.asyncio
async def test_feature_dynamic_configurations():
    from backend.features.predictive_maintenance.config.models import maintenance_config_store, PredictiveMaintenanceConfig, ISO10816Thresholds
    from backend.features.visual_quality_inspection.config.models import quality_config_store, VisualQualityConfig
    from backend.features.production_optimization.config.models import production_config_store, ProductionOptimizationConfig
    from backend.features.supply_chain_intelligence.config.models import supply_config_store, SupplyChainConfig
    from backend.features.demand_forecasting.config.models import demand_config_store, DemandForecastingConfig
    from backend.features.waste_reduction.config.models import waste_config_store, WasteReductionConfig
    from backend.features.operational_copilots.config.models import copilot_config_store, OperationalCopilotsConfig

    # 1. Update ISO thresholds and verify dynamic adaptation
    maintenance_config_store.update_config(PredictiveMaintenanceConfig(
        iso_thresholds=ISO10816Thresholds(zone_a_good_max=2.0, zone_b_acceptable_max=6.0, zone_c_unsatisfactory_max=8.0)
    ))
    maint_svc = PredictiveMaintenanceService(InMemoryTelemetryReader(), maintenance_config_store)
    diag = await maint_svc.diagnose_asset("A-ROB-03")
    assert diag.health.iso_zone == ISO10816Severity.ZONE_B_ACCEPTABLE
    # Reset
    maintenance_config_store.update_config(PredictiveMaintenanceConfig())

    # 2. Update Quality FPY target
    quality_config_store.update_config(VisualQualityConfig(target_first_pass_yield_pct=99.5))
    assert quality_config_store.get_config().target_first_pass_yield_pct == 99.5

    # 3. Update Production Target UPH
    production_config_store.update_config(ProductionOptimizationConfig(target_line_uph=250.0))
    assert production_config_store.get_config().target_line_uph == 250.0

    # 4. Update Supply Chain Threshold
    supply_config_store.update_config(SupplyChainConfig(critical_days_of_supply_threshold=5.0))
    assert supply_config_store.get_config().critical_days_of_supply_threshold == 5.0

    # 5. Update Demand Forecast Multiplier
    demand_config_store.update_config(DemandForecastingConfig(growth_trend_multiplier=1.10))
    assert demand_config_store.get_config().growth_trend_multiplier == 1.10

    # 6. Update Waste Tariff
    waste_config_store.update_config(WasteReductionConfig(electricity_tariff_usd_per_kwh=0.20))
    assert waste_config_store.get_config().electricity_tariff_usd_per_kwh == 0.20

    # 7. Update Copilot Cooldown
    copilot_config_store.update_config(OperationalCopilotsConfig(alert_cooldown_minutes=45))
    assert copilot_config_store.get_config().alert_cooldown_minutes == 45
