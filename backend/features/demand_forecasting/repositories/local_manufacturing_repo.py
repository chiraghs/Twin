"""In-memory reproducible repository for manufacturing demand forecasting and operations planning.

Generates 24 months of deterministic, realistic industrial demand:
- Trend, annual/quarterly seasonality, day-of-week seasonality, and demand shocks
- Multi-product & multi-plant network (Bangalore, Stuttgart, Detroit)
- Production capacity, machine maintenance downtime, and quality yield history
- Raw material, WIP, finished goods, and spare parts inventory balances
"""
import math
from datetime import datetime, date, timedelta, timezone
from typing import Any, Optional

from backend.features.demand_forecasting.schemas.manufacturing import (
    PlantMaster,
    ProductMaster,
    ProductionLineMaster,
    HistoricalDemandRecord,
    SalesOrder,
    ProductionCapacityReport,
    InventoryPosition,
    ReplenishmentRecommendation,
    EquipmentAssetReport,
    DowntimeEventReport,
    QualityMetricsSummary,
    QualityTrendRecord,
    ModelRegistryEntry,
    ItemCategory,
    ModelType,
    DataProvenance,
)


class LocalManufacturingRepository:
    """Zero-cloud runnable local repository containing 24 months of seeded industrial data."""

    def __init__(self) -> None:
        self.plants: dict[str, PlantMaster] = {}
        self.products: dict[str, ProductMaster] = {}
        self.lines: dict[str, ProductionLineMaster] = {}
        self.demand_history: list[HistoricalDemandRecord] = []
        self.sales_orders: dict[str, SalesOrder] = {}
        self.inventory_positions: dict[str, InventoryPosition] = {}
        self.replenishment_recs: dict[str, ReplenishmentRecommendation] = {}
        self.equipment_assets: dict[str, EquipmentAssetReport] = {}
        self.downtime_events: list[DowntimeEventReport] = []
        self.quality_summaries: dict[str, QualityMetricsSummary] = {}
        self.quality_trends: list[QualityTrendRecord] = []
        self.model_registry: dict[str, ModelRegistryEntry] = {}

        self._seed_data()

    def _seed_data(self) -> None:
        # 1. Plants
        self.plants = {
            "PLANT_BANGALORE": PlantMaster(
                plant_id="PLANT_BANGALORE",
                plant_name="Bangalore Advanced Machinery Facility",
                location_city="Bangalore",
                country="India",
                region="APAC",
                active_production_lines=4,
                rated_capacity_hours_per_day=20.0,
                shift_count=2,
                hourly_downtime_cost_usd=3500.0,
            ),
            "PLANT_STUTTGART": PlantMaster(
                plant_id="PLANT_STUTTGART",
                plant_name="Stuttgart Precision Robotics Plant",
                location_city="Stuttgart",
                country="Germany",
                region="EMEA",
                active_production_lines=6,
                rated_capacity_hours_per_day=22.0,
                shift_count=3,
                hourly_downtime_cost_usd=4800.0,
            ),
            "PLANT_DETROIT": PlantMaster(
                plant_id="PLANT_DETROIT",
                plant_name="Detroit Heavy Automation Works",
                location_city="Detroit",
                country="United States",
                region="AMER",
                active_production_lines=5,
                rated_capacity_hours_per_day=20.0,
                shift_count=2,
                hourly_downtime_cost_usd=4200.0,
            ),
        }

        # 2. Products
        self.products = {
            "PRD-CNC-5X": ProductMaster(
                product_id="PRD-CNC-5X",
                product_name="5-Axis High Precision CNC Milling Spindle",
                category=ItemCategory.FINISHED_GOOD,
                target_plant_id="PLANT_BANGALORE",
                unit_cost_usd=4200.0,
                selling_price_usd=7500.0,
                standard_lead_time_days=21,
                safety_stock_units=60,
                cycle_time_hours_per_unit=2.4,
                lot_size_units=10,
            ),
            "PRD-ARM-ROBOT": ProductMaster(
                product_id="PRD-ARM-ROBOT",
                product_name="6-Axis Articulated Industrial Robotic Arm",
                category=ItemCategory.FINISHED_GOOD,
                target_plant_id="PLANT_STUTTGART",
                unit_cost_usd=6800.0,
                selling_price_usd=12000.0,
                standard_lead_time_days=18,
                safety_stock_units=40,
                cycle_time_hours_per_unit=3.2,
                lot_size_units=8,
            ),
            "PRD-HYD-PRESS": ProductMaster(
                product_id="PRD-HYD-PRESS",
                product_name="200-Ton Heavy Duty Hydraulic Stamping Press",
                category=ItemCategory.FINISHED_GOOD,
                target_plant_id="PLANT_DETROIT",
                unit_cost_usd=9500.0,
                selling_price_usd=18500.0,
                standard_lead_time_days=28,
                safety_stock_units=25,
                cycle_time_hours_per_unit=5.5,
                lot_size_units=4,
            ),
            "PRD-SERVO-DRIVE": ProductMaster(
                product_id="PRD-SERVO-DRIVE",
                product_name="4.5kW Precision AC Synchronous Servo Drive",
                category=ItemCategory.FINISHED_GOOD,
                target_plant_id="PLANT_BANGALORE",
                unit_cost_usd=850.0,
                selling_price_usd=1450.0,
                standard_lead_time_days=14,
                safety_stock_units=150,
                cycle_time_hours_per_unit=0.8,
                lot_size_units=30,
            ),
            "ECU-200": ProductMaster(
                product_id="ECU-200",
                product_name="Automotive Engine Control Unit (ECU-200)",
                category=ItemCategory.FINISHED_GOOD,
                target_plant_id="PLANT_BANGALORE",
                unit_cost_usd=280.0,
                selling_price_usd=520.0,
                standard_lead_time_days=10,
                safety_stock_units=300,
                cycle_time_hours_per_unit=0.4,
                lot_size_units=50,
            ),
        }

        # 3. Production Lines
        self.lines = {
            "LINE-BLR-01": ProductionLineMaster(
                line_id="LINE-BLR-01",
                plant_id="PLANT_BANGALORE",
                line_name="CNC Machining & Spindle Assembly Line 1",
                daily_capacity_hours=20.0,
                primary_product_ids=["PRD-CNC-5X", "PRD-SERVO-DRIVE"],
                nominal_hourly_rate_units=0.8,
            ),
            "LINE-BLR-02": ProductionLineMaster(
                line_id="LINE-BLR-02",
                plant_id="PLANT_BANGALORE",
                line_name="Electronics SMT & ECU Assembly Line 2",
                daily_capacity_hours=20.0,
                primary_product_ids=["ECU-200"],
                nominal_hourly_rate_units=2.5,
            ),
            "LINE-STG-01": ProductionLineMaster(
                line_id="LINE-STG-01",
                plant_id="PLANT_STUTTGART",
                line_name="Robotic Kinematics & Gear Assembly Cell 1",
                daily_capacity_hours=22.0,
                primary_product_ids=["PRD-ARM-ROBOT"],
                nominal_hourly_rate_units=0.5,
            ),
            "LINE-DET-01": ProductionLineMaster(
                line_id="LINE-DET-01",
                plant_id="PLANT_DETROIT",
                line_name="Heavy Hydraulic Fabrication & Press Bay 1",
                daily_capacity_hours=20.0,
                primary_product_ids=["PRD-HYD-PRESS"],
                nominal_hourly_rate_units=0.3,
            ),
        }

        # 4. Generate 24 Months of Realistic Daily Demand History (730 days)
        # Start date: 2024-10-18, End date: 2026-10-18
        start_date = date(2024, 10, 18)
        self.demand_history = []
        for d_idx in range(731):
            cur_date = start_date + timedelta(days=d_idx)
            day_of_week = cur_date.weekday()
            is_weekend = day_of_week >= 5

            # Base seasonality curve: quarterly sinusoidal + annual trend
            t_year = d_idx / 365.25
            seasonal_quarterly = math.sin(2 * math.pi * d_idx / 91.25) * 0.15
            seasonal_annual = math.sin(2 * math.pi * d_idx / 365.25 - 0.5) * 0.20
            trend_multiplier = 1.0 + (0.12 * t_year)  # +12% annual growth

            weekend_attenuation = 0.25 if is_weekend else 1.0

            # Generate for each product
            for pid, prod in self.products.items():
                if pid == "PRD-CNC-5X":
                    base_rate = 18.0
                    shock = 2.2 if d_idx in [120, 280, 520, 680] else 1.0
                elif pid == "PRD-ARM-ROBOT":
                    base_rate = 12.0
                    shock = 1.8 if d_idx in [95, 340, 590] else 1.0
                elif pid == "PRD-HYD-PRESS":
                    # Lumpy intermittent demand
                    base_rate = 5.0 if (d_idx % 4 == 0) else 1.0
                    shock = 2.5 if d_idx in [210, 480, 640] else 1.0
                elif pid == "PRD-SERVO-DRIVE":
                    base_rate = 45.0
                    shock = 1.6 if d_idx in [180, 390, 550] else 1.0
                else:  # ECU-200
                    base_rate = 110.0
                    shock = 1.4 if d_idx in [250, 420, 670] else 1.0

                noise = 1.0 + (math.sin(d_idx * 13.7) * 0.08)
                daily_volume = round(
                    base_rate * trend_multiplier * (1.0 + seasonal_quarterly + seasonal_annual) * weekend_attenuation * noise * shock,
                    1,
                )
                daily_volume = max(0.0, daily_volume)

                self.demand_history.append(
                    HistoricalDemandRecord(
                        record_id=f"DEM-{pid}-{cur_date.isoformat()}",
                        product_id=pid,
                        plant_id=prod.target_plant_id,
                        date_recorded=cur_date.isoformat(),
                        actual_units=daily_volume,
                        sales_orders_count=max(1, int(daily_volume / (prod.lot_size_units / 2 or 1))),
                        unfulfilled_backlog_units=round(daily_volume * 0.1, 1) if shock > 1.2 else 0.0,
                        demand_shock_flag=shock > 1.5,
                        data_provenance=DataProvenance.ACTUAL,
                    )
                )

        # 5. Inventory Positions
        raw_inventory = [
            InventoryPosition(
                part_or_sku_id="PRD-CNC-5X",
                item_name="5-Axis High Precision CNC Milling Spindle",
                category=ItemCategory.FINISHED_GOOD,
                plant_id="PLANT_BANGALORE",
                stock_on_hand=82,
                stock_allocated=45,
                stock_usable=37,
                daily_consumption_rate=18.5,
                days_on_hand=2.0,  # Critical!
                safety_stock_units=60,
                reorder_point_units=90,
                confirmed_incoming_pos=25,
                potential_stockout_risk=True,
                stockout_eta_days=2.0,
            ),
            InventoryPosition(
                part_or_sku_id="PRD-ARM-ROBOT",
                item_name="6-Axis Articulated Industrial Robotic Arm",
                category=ItemCategory.FINISHED_GOOD,
                plant_id="PLANT_STUTTGART",
                stock_on_hand=65,
                stock_allocated=20,
                stock_usable=45,
                daily_consumption_rate=12.2,
                days_on_hand=3.7,
                safety_stock_units=40,
                reorder_point_units=65,
                confirmed_incoming_pos=20,
                potential_stockout_risk=False,
                stockout_eta_days=None,
            ),
            InventoryPosition(
                part_or_sku_id="PRD-HYD-PRESS",
                item_name="200-Ton Heavy Duty Hydraulic Stamping Press",
                category=ItemCategory.FINISHED_GOOD,
                plant_id="PLANT_DETROIT",
                stock_on_hand=18,
                stock_allocated=12,
                stock_usable=6,
                daily_consumption_rate=4.2,
                days_on_hand=1.4,  # Critical!
                safety_stock_units=25,
                reorder_point_units=35,
                confirmed_incoming_pos=8,
                potential_stockout_risk=True,
                stockout_eta_days=1.4,
            ),
            InventoryPosition(
                part_or_sku_id="RAW-BEARING-7014",
                item_name="Super Precision Angular Contact Bearing Set",
                category=ItemCategory.RAW_MATERIAL,
                plant_id="PLANT_BANGALORE",
                stock_on_hand=320,
                stock_allocated=180,
                stock_usable=140,
                daily_consumption_rate=35.0,
                days_on_hand=4.0,
                safety_stock_units=150,
                reorder_point_units=220,
                confirmed_incoming_pos=100,
                potential_stockout_risk=False,
                stockout_eta_days=None,
            ),
            InventoryPosition(
                part_or_sku_id="RAW-MCU-8841",
                item_name="Arm Cortex High-Speed Industrial MCU",
                category=ItemCategory.RAW_MATERIAL,
                plant_id="PLANT_BANGALORE",
                stock_on_hand=110,
                stock_allocated=95,
                stock_usable=15,
                daily_consumption_rate=45.0,
                days_on_hand=0.3,  # Critical bottleneck!
                safety_stock_units=400,
                reorder_point_units=600,
                confirmed_incoming_pos=200,
                potential_stockout_risk=True,
                stockout_eta_days=0.3,
            ),
            InventoryPosition(
                part_or_sku_id="WIP-SPINDLE-SUBASSY",
                item_name="Motorized Spindle Core Sub-Assembly",
                category=ItemCategory.WORK_IN_PROGRESS,
                plant_id="PLANT_BANGALORE",
                stock_on_hand=42,
                stock_allocated=20,
                stock_usable=22,
                daily_consumption_rate=15.0,
                days_on_hand=1.5,
                safety_stock_units=30,
                reorder_point_units=45,
                confirmed_incoming_pos=15,
                potential_stockout_risk=True,
                stockout_eta_days=1.5,
            ),
            InventoryPosition(
                part_or_sku_id="SPR-SEAL-KIT-01",
                item_name="High-Pressure Hydraulic Fluorocarbon Seal Kit",
                category=ItemCategory.SPARE_PART,
                plant_id="PLANT_DETROIT",
                stock_on_hand=85,
                stock_allocated=15,
                stock_usable=70,
                daily_consumption_rate=5.0,
                days_on_hand=14.0,
                safety_stock_units=30,
                reorder_point_units=50,
                confirmed_incoming_pos=20,
                potential_stockout_risk=False,
                stockout_eta_days=None,
            ),
        ]
        self.inventory_positions = {i.part_or_sku_id: i for i in raw_inventory}

        # 6. Replenishment Recommendations
        self.replenishment_recs = {
            "REC-REP-001": ReplenishmentRecommendation(
                recommendation_id="REC-REP-001",
                item_id="RAW-MCU-8841",
                item_name="Arm Cortex High-Speed Industrial MCU",
                category=ItemCategory.RAW_MATERIAL,
                plant_id="PLANT_BANGALORE",
                current_usable_stock=15,
                reorder_point=600,
                safety_stock=400,
                suggested_order_quantity=800,
                supplier_id="SUP-MICRO-01",
                supplier_lead_time_days=21,
                urgency="CRITICAL",
                estimated_cost_usd=68000.0,
            ),
            "REC-REP-002": ReplenishmentRecommendation(
                recommendation_id="REC-REP-002",
                item_id="PRD-HYD-PRESS",
                item_name="200-Ton Heavy Duty Hydraulic Stamping Press",
                category=ItemCategory.FINISHED_GOOD,
                plant_id="PLANT_DETROIT",
                current_usable_stock=6,
                reorder_point=35,
                safety_stock=25,
                suggested_order_quantity=30,
                supplier_id="INTERNAL_PRODUCTION",
                supplier_lead_time_days=28,
                urgency="HIGH",
                estimated_cost_usd=285000.0,
            ),
        }

        # 7. Equipment Assets & Maintenance
        raw_assets = [
            EquipmentAssetReport(
                asset_id="AST-SPINDLE-CNC-01",
                asset_name="Heller 5-Axis Precision Machining Center #1",
                plant_id="PLANT_BANGALORE",
                line_id="LINE-BLR-01",
                availability_pct=94.5,
                historical_downtime_hours_30d=24.5,
                mtbf_hours=420.0,
                mttr_hours=4.2,
                active_maintenance_orders_count=1,
                planned_downtime_hours_next_14d=8.0,
                capacity_at_risk_hours=16.0,
                health_status="WARNING",
            ),
            EquipmentAssetReport(
                asset_id="AST-ROBOT-KUKA-02",
                asset_name="KUKA KR-210 Articulated Assembly Robot #2",
                plant_id="PLANT_STUTTGART",
                line_id="LINE-STG-01",
                availability_pct=98.2,
                historical_downtime_hours_30d=8.0,
                mtbf_hours=680.0,
                mttr_hours=2.5,
                active_maintenance_orders_count=0,
                planned_downtime_hours_next_14d=4.0,
                capacity_at_risk_hours=4.0,
                health_status="HEALTHY",
            ),
            EquipmentAssetReport(
                asset_id="AST-PRESS-SCHULER-03",
                asset_name="Schuler 200T Hydraulic Stamping Press #3",
                plant_id="PLANT_DETROIT",
                line_id="LINE-DET-01",
                availability_pct=88.7,
                historical_downtime_hours_30d=48.0,
                mtbf_hours=260.0,
                mttr_hours=6.5,
                active_maintenance_orders_count=2,
                planned_downtime_hours_next_14d=16.0,
                capacity_at_risk_hours=32.0,
                health_status="CRITICAL",
            ),
            EquipmentAssetReport(
                asset_id="AST-DRIVE-TEST-04",
                asset_name="Precision Servo Dynamic Load Tester #4",
                plant_id="PLANT_BANGALORE",
                line_id="LINE-BLR-02",
                availability_pct=96.8,
                historical_downtime_hours_30d=12.0,
                mtbf_hours=510.0,
                mttr_hours=3.1,
                active_maintenance_orders_count=0,
                planned_downtime_hours_next_14d=6.0,
                capacity_at_risk_hours=8.0,
                health_status="HEALTHY",
            ),
        ]
        self.equipment_assets = {a.asset_id: a for a in raw_assets}

        # 8. Downtime Events
        self.downtime_events = [
            DowntimeEventReport(
                event_id="DT-2026-001",
                asset_id="AST-PRESS-SCHULER-03",
                plant_id="PLANT_DETROIT",
                downtime_start="2026-10-15T08:30:00Z",
                downtime_end="2026-10-15T16:00:00Z",
                duration_hours=7.5,
                reason="Proportional servo valve seal failure & hydraulic leak",
                production_hours_lost=7.5,
                resolved=True,
            ),
            DowntimeEventReport(
                event_id="DT-2026-002",
                asset_id="AST-SPINDLE-CNC-01",
                plant_id="PLANT_BANGALORE",
                downtime_start="2026-10-17T12:00:00Z",
                downtime_end="2026-10-17T15:30:00Z",
                duration_hours=3.5,
                reason="High-vibration bearing thermal trip at 78°C",
                production_hours_lost=3.5,
                resolved=True,
            ),
        ]

        # 9. Quality Analytics Summaries & Trends
        self.quality_summaries = {
            "PLANT_BANGALORE": QualityMetricsSummary(
                plant_id="PLANT_BANGALORE",
                product_id="PRD-CNC-5X",
                inspected_units_total=1450,
                defective_units_total=42,
                scrapped_units_total=26,
                reworked_units_total=16,
                first_pass_yield_pct=97.1,
                defect_rate_pct=2.9,
                scrap_rate_pct=1.8,
                estimated_usable_output_pct=98.2,
                dpmo=29000.0,
            ),
            "PLANT_STUTTGART": QualityMetricsSummary(
                plant_id="PLANT_STUTTGART",
                product_id="PRD-ARM-ROBOT",
                inspected_units_total=980,
                defective_units_total=18,
                scrapped_units_total=8,
                reworked_units_total=10,
                first_pass_yield_pct=98.2,
                defect_rate_pct=1.8,
                scrap_rate_pct=0.8,
                estimated_usable_output_pct=99.2,
                dpmo=18000.0,
            ),
            "PLANT_DETROIT": QualityMetricsSummary(
                plant_id="PLANT_DETROIT",
                product_id="PRD-HYD-PRESS",
                inspected_units_total=320,
                defective_units_total=19,
                scrapped_units_total=11,
                reworked_units_total=8,
                first_pass_yield_pct=94.1,
                defect_rate_pct=5.9,
                scrap_rate_pct=3.4,
                estimated_usable_output_pct=96.6,
                dpmo=59000.0,
            ),
        }

        # 10. Model Registry
        raw_models = [
            ModelRegistryEntry(
                model_id="MOD-GBDT-V2",
                model_type=ModelType.GRADIENT_BOOSTED_TREES,
                display_name="LightGBM Lag & Calendar Feature Regressor",
                version="v2.1",
                is_active_champion=True,
                trained_on="2026-10-15",
                sample_count=2190,
                wape=0.084,
                description="Champion gradient-boosted regressor trained on 24 months with lags (1, 7, 14, 28) and rolling statistics.",
            ),
            ModelRegistryEntry(
                model_id="MOD-ARIMA-V1",
                model_type=ModelType.ARIMA,
                display_name="Auto-ARIMA (2,1,2)(1,1,1)7 Seasonal Model",
                version="v1.4",
                is_active_champion=False,
                trained_on="2026-10-10",
                sample_count=2190,
                wape=0.126,
                description="Parametric seasonal autoregressive integrated moving average baseline.",
            ),
            ModelRegistryEntry(
                model_id="MOD-ETS-V1",
                model_type=ModelType.EXPONENTIAL_SMOOTHING,
                display_name="Holt-Winters Multiplicative Exponential Smoothing",
                version="v1.2",
                is_active_champion=False,
                trained_on="2026-10-08",
                sample_count=2190,
                wape=0.148,
                description="Holt-Winters model with multiplicative trend and 7-day seasonality.",
            ),
            ModelRegistryEntry(
                model_id="MOD-SNAIVE-BASE",
                model_type=ModelType.SEASONAL_NAIVE,
                display_name="Seasonal-Naive Baseline (s=7)",
                version="v1.0",
                is_active_champion=False,
                trained_on="2026-10-01",
                sample_count=2190,
                wape=0.282,
                description="Benchmark baseline copying actual demand from the exact same day of the prior week.",
            ),
        ]
        self.model_registry = {m.model_id: m for m in raw_models}


# Global singleton instance
local_manufacturing_repo = LocalManufacturingRepository()
