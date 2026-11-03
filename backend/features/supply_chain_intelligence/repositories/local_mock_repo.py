"""In-Memory Mock Repository for Supply Chain Intelligence.

Provides a rich, realistic, reproducible enterprise supply chain dataset:
- Tier 1 & Tier 2 global suppliers with historical OTD and risk profiles
- Part catalog with Bill of Materials (BOM) linkages to finished assemblies
- Multi-modal active shipments with milestone tracking and delay causes
- Real-time inventory levels, daily consumption, and stockout indicators
- Customer orders with revenue and SLA penalties
- Active disruption events and actionable mitigation recommendations
"""
import uuid
from datetime import datetime, date, timedelta, timezone
from typing import Any, Optional

from backend.features.supply_chain_intelligence.schemas.ontology import (
    Supplier,
    Part,
    BillOfMaterials,
    InventoryItem,
    PurchaseOrder,
    Shipment,
    Plant,
    CustomerOrder,
    DisruptionEvent,
    MitigationRecommendation,
    RiskSeverity,
    TransportMode,
    ShipmentStatus,
    PurchaseOrderStatus,
    CustomerOrderStatus,
    DisruptionType,
    DataProvenance,
    Carrier,
    Warehouse,
    ProductionSchedule,
    DemandForecast,
    AlternativeSupplierContract,
    ExcessInventoryItem,
    EndToEndImpactTrace,
)


class LocalMockSupplyChainRepository:
    """Zero-cloud runnable in-memory supply chain repository."""

    def __init__(self) -> None:
        self.suppliers: dict[str, Supplier] = {}
        self.parts: dict[str, Part] = {}
        self.boms: list[BillOfMaterials] = []
        self.inventory: dict[str, InventoryItem] = {}
        self.purchase_orders: dict[str, PurchaseOrder] = {}
        self.shipments: dict[str, Shipment] = {}
        self.plants: dict[str, Plant] = {}
        self.customer_orders: dict[str, CustomerOrder] = {}
        self.disruptions: dict[str, DisruptionEvent] = {}
        self.mitigations: dict[str, MitigationRecommendation] = {}
        self.carriers: dict[str, Carrier] = {}
        self.warehouses: dict[str, Warehouse] = {}
        self.production_schedules: dict[str, ProductionSchedule] = {}
        self.demand_forecasts: dict[str, DemandForecast] = {}
        self.alternative_contracts: dict[str, AlternativeSupplierContract] = {}
        self.excess_inventory: dict[str, ExcessInventoryItem] = {}

        self._seed_reproducible_data()

    def _seed_reproducible_data(self) -> None:
        """Seeds realistic supply chain network."""
        # 1. Plants
        self.plants = {
            "PLANT_BANGALORE": Plant(
                plant_id="PLANT_BANGALORE",
                plant_name="Bangalore Advanced Machinery Facility",
                location_city="Bangalore",
                country="India",
                daily_production_target=45,
                active_production_lines=4,
                hourly_unplanned_downtime_cost_usd=3500.0,
            ),
            "PLANT_STUTTGART": Plant(
                plant_id="PLANT_STUTTGART",
                plant_name="Stuttgart Precision Robotics Plant",
                location_city="Stuttgart",
                country="Germany",
                daily_production_target=60,
                active_production_lines=6,
                hourly_unplanned_downtime_cost_usd=4800.0,
            ),
            "PLANT_DETROIT": Plant(
                plant_id="PLANT_DETROIT",
                plant_name="Detroit Heavy Automation Works",
                location_city="Detroit",
                country="United States",
                daily_production_target=50,
                active_production_lines=5,
                hourly_unplanned_downtime_cost_usd=4200.0,
            ),
        }

        # 2. Suppliers
        raw_suppliers = [
            Supplier(
                supplier_id="SUP-MICRO-01",
                supplier_name="Apex Micro Devices & Silicon",
                country="Taiwan",
                tier=1,
                category="Semiconductors",
                contract_start="2024-01-01",
                contract_end="2027-12-31",
                lead_time_days_mean=21.0,
                lead_time_variance_days=4.5,
                on_time_delivery_rate=0.84,  # Degraded
                defect_ppm=42.0,
                geopolitical_risk_score=0.45,
                financial_stability_score=0.92,
                composite_risk_level=RiskSeverity.HIGH,
                data_provenance=DataProvenance.ACTUAL,
            ),
            Supplier(
                supplier_id="SUP-MECH-02",
                supplier_name="Bavaria Precision Bearings GmbH",
                country="Germany",
                tier=1,
                category="Bearings & Spindles",
                contract_start="2023-06-01",
                contract_end="2026-12-31",
                lead_time_days_mean=14.0,
                lead_time_variance_days=1.2,
                on_time_delivery_rate=0.97,
                defect_ppm=18.0,
                geopolitical_risk_score=0.08,
                financial_stability_score=0.95,
                composite_risk_level=RiskSeverity.LOW,
                data_provenance=DataProvenance.ACTUAL,
            ),
            Supplier(
                supplier_id="SUP-HYD-03",
                supplier_name="Nippon Fluid Power Dynamics",
                country="Japan",
                tier=1,
                category="Hydraulics",
                contract_start="2024-03-01",
                contract_end="2027-03-01",
                lead_time_days_mean=28.0,
                lead_time_variance_days=6.2,
                on_time_delivery_rate=0.76,  # Disrupted
                defect_ppm=85.0,
                geopolitical_risk_score=0.20,
                financial_stability_score=0.88,
                composite_risk_level=RiskSeverity.CRITICAL,
                data_provenance=DataProvenance.ACTUAL,
            ),
            Supplier(
                supplier_id="SUP-MOT-04",
                supplier_name="Seoul Servo & Motion Systems",
                country="South Korea",
                tier=1,
                category="Motors & Drives",
                contract_start="2024-01-15",
                contract_end="2026-12-31",
                lead_time_days_mean=18.0,
                lead_time_variance_days=2.1,
                on_time_delivery_rate=0.93,
                defect_ppm=25.0,
                geopolitical_risk_score=0.15,
                financial_stability_score=0.91,
                composite_risk_level=RiskSeverity.MEDIUM,
                data_provenance=DataProvenance.ACTUAL,
            ),
            Supplier(
                supplier_id="SUP-FAST-05",
                supplier_name="Midwest Aerospace Fasteners",
                country="United States",
                tier=2,
                category="Fasteners",
                contract_start="2023-01-01",
                contract_end="2026-06-30",
                lead_time_days_mean=7.0,
                lead_time_variance_days=0.8,
                on_time_delivery_rate=0.99,
                defect_ppm=12.0,
                geopolitical_risk_score=0.05,
                financial_stability_score=0.96,
                composite_risk_level=RiskSeverity.LOW,
                data_provenance=DataProvenance.ACTUAL,
            ),
            Supplier(
                supplier_id="SUP-OPT-06",
                supplier_name="Photonix Sensor Optics",
                country="Germany",
                tier=2,
                category="Sensors",
                contract_start="2024-05-01",
                contract_end="2027-05-01",
                lead_time_days_mean=12.0,
                lead_time_variance_days=1.5,
                on_time_delivery_rate=0.95,
                defect_ppm=30.0,
                geopolitical_risk_score=0.07,
                financial_stability_score=0.93,
                composite_risk_level=RiskSeverity.LOW,
                data_provenance=DataProvenance.ACTUAL,
            ),
        ]
        self.suppliers = {s.supplier_id: s for s in raw_suppliers}

        # 3. Parts Catalog
        raw_parts = [
            Part(
                part_id="PRT-MCU-8841",
                part_name="High-Speed Industrial Arm Cortex MCU",
                primary_supplier_id="SUP-MICRO-01",
                alternate_supplier_id=None,  # Single-sourced!
                unit_cost_usd=85.00,
                criticality="A",
                category="Semiconductors",
                weight_kg=0.05,
                safety_stock_units=400,
                reorder_point_units=600,
                standard_lead_time_days=21,
                dual_sourced=False,
            ),
            Part(
                part_id="PRT-BRG-7014",
                part_name="Super Precision Angular Contact Bearing Set",
                primary_supplier_id="SUP-MECH-02",
                alternate_supplier_id="SUP-FAST-05",
                unit_cost_usd=340.00,
                criticality="A",
                category="Bearings",
                weight_kg=1.8,
                safety_stock_units=150,
                reorder_point_units=250,
                standard_lead_time_days=14,
                dual_sourced=True,
            ),
            Part(
                part_id="PRT-HYD-VLV-09",
                part_name="Proportional Hydraulic Directional Servo Valve 350bar",
                primary_supplier_id="SUP-HYD-03",
                alternate_supplier_id=None,  # Single-sourced!
                unit_cost_usd=920.00,
                criticality="A",
                category="Hydraulics",
                weight_kg=5.4,
                safety_stock_units=80,
                reorder_point_units=140,
                standard_lead_time_days=28,
                dual_sourced=False,
            ),
            Part(
                part_id="PRT-SRV-MTR-400",
                part_name="Brushless AC Synchronous Servomotor 4.5kW",
                primary_supplier_id="SUP-MOT-04",
                alternate_supplier_id="SUP-MECH-02",
                unit_cost_usd=760.00,
                criticality="A",
                category="Motors",
                weight_kg=12.2,
                safety_stock_units=100,
                reorder_point_units=180,
                standard_lead_time_days=18,
                dual_sourced=True,
            ),
            Part(
                part_id="PRT-SNS-VIB-01",
                part_name="Triaxial High-Frequency Accelerometer Sensor",
                primary_supplier_id="SUP-OPT-06",
                alternate_supplier_id=None,
                unit_cost_usd=145.00,
                criticality="B",
                category="Sensors",
                weight_kg=0.15,
                safety_stock_units=300,
                reorder_point_units=450,
                standard_lead_time_days=12,
                dual_sourced=False,
            ),
            Part(
                part_id="PRT-BOLT-M16-HT",
                part_name="M16 Grade 12.9 High-Tensile Machine Bolt (Pack of 50)",
                primary_supplier_id="SUP-FAST-05",
                alternate_supplier_id=None,
                unit_cost_usd=32.00,
                criticality="C",
                category="Fasteners",
                weight_kg=2.5,
                safety_stock_units=1000,
                reorder_point_units=1500,
                standard_lead_time_days=7,
                dual_sourced=True,
            ),
        ]
        self.parts = {p.part_id: p for p in raw_parts}

        # 4. Bill of Materials (BOM)
        self.boms = [
            BillOfMaterials(
                finished_assembly_id="ASM-CNC-MILL-5X",
                assembly_name="5-Axis High Precision CNC Milling Center",
                part_id="PRT-MCU-8841",
                quantity_required_per_unit=2,
                critical_for_assembly=True,
            ),
            BillOfMaterials(
                finished_assembly_id="ASM-CNC-MILL-5X",
                assembly_name="5-Axis High Precision CNC Milling Center",
                part_id="PRT-BRG-7014",
                quantity_required_per_unit=4,
                critical_for_assembly=True,
            ),
            BillOfMaterials(
                finished_assembly_id="ASM-CNC-MILL-5X",
                assembly_name="5-Axis High Precision CNC Milling Center",
                part_id="PRT-SRV-MTR-400",
                quantity_required_per_unit=5,
                critical_for_assembly=True,
            ),
            BillOfMaterials(
                finished_assembly_id="ASM-ROBOTIC-ARM-6AXIS",
                assembly_name="6-Axis Articulated Industrial Robotic Arm",
                part_id="PRT-MCU-8841",
                quantity_required_per_unit=3,
                critical_for_assembly=True,
            ),
            BillOfMaterials(
                finished_assembly_id="ASM-ROBOTIC-ARM-6AXIS",
                assembly_name="6-Axis Articulated Industrial Robotic Arm",
                part_id="PRT-SRV-MTR-400",
                quantity_required_per_unit=6,
                critical_for_assembly=True,
            ),
            BillOfMaterials(
                finished_assembly_id="ASM-HYD-PRESS-200T",
                assembly_name="200-Ton High Duty Hydraulic Stamping Press",
                part_id="PRT-HYD-VLV-09",
                quantity_required_per_unit=2,
                critical_for_assembly=True,
            ),
        ]

        # 5. Inventory Items
        raw_inventory = [
            InventoryItem(
                inventory_id="INV-BLR-MCU-01",
                part_id="PRT-MCU-8841",
                warehouse_id="WH-BLR-01",
                plant_id="PLANT_BANGALORE",
                stock_on_hand=95,  # CRITICAL: Well below safety stock (400)
                stock_allocated=80,
                stock_available=15,
                daily_consumption_rate=45.0,
                days_of_inventory_remaining=2.1,  # Stockout in ~2 days!
                stockout_risk_score=0.92,
                is_at_risk_of_stockout=True,
            ),
            InventoryItem(
                inventory_id="INV-STG-BRG-01",
                part_id="PRT-BRG-7014",
                warehouse_id="WH-STG-01",
                plant_id="PLANT_STUTTGART",
                stock_on_hand=220,
                stock_allocated=60,
                stock_available=160,
                daily_consumption_rate=18.0,
                days_of_inventory_remaining=12.2,
                stockout_risk_score=0.15,
                is_at_risk_of_stockout=False,
            ),
            InventoryItem(
                inventory_id="INV-DET-HYD-01",
                part_id="PRT-HYD-VLV-09",
                warehouse_id="WH-DET-01",
                plant_id="PLANT_DETROIT",
                stock_on_hand=28,  # CRITICAL: Below safety stock (80)
                stock_allocated=24,
                stock_available=4,
                daily_consumption_rate=12.0,
                days_of_inventory_remaining=2.3,  # Stockout in ~2 days!
                stockout_risk_score=0.88,
                is_at_risk_of_stockout=True,
            ),
            InventoryItem(
                inventory_id="INV-STG-MTR-01",
                part_id="PRT-SRV-MTR-400",
                warehouse_id="WH-STG-01",
                plant_id="PLANT_STUTTGART",
                stock_on_hand=180,
                stock_allocated=90,
                stock_available=90,
                daily_consumption_rate=22.0,
                days_of_inventory_remaining=8.1,
                stockout_risk_score=0.30,
                is_at_risk_of_stockout=False,
            ),
            InventoryItem(
                inventory_id="INV-BLR-SNS-01",
                part_id="PRT-SNS-VIB-01",
                warehouse_id="WH-BLR-01",
                plant_id="PLANT_BANGALORE",
                stock_on_hand=480,
                stock_allocated=120,
                stock_available=360,
                daily_consumption_rate=25.0,
                days_of_inventory_remaining=19.2,
                stockout_risk_score=0.08,
                is_at_risk_of_stockout=False,
            ),
            InventoryItem(
                inventory_id="INV-DET-BLT-01",
                part_id="PRT-BOLT-M16-HT",
                warehouse_id="WH-DET-01",
                plant_id="PLANT_DETROIT",
                stock_on_hand=2200,
                stock_allocated=500,
                stock_available=1700,
                daily_consumption_rate=150.0,
                days_of_inventory_remaining=14.6,
                stockout_risk_score=0.05,
                is_at_risk_of_stockout=False,
            ),
        ]
        self.inventory = {inv.inventory_id: inv for inv in raw_inventory}

        # 6. Purchase Orders
        today = date.today()
        self.purchase_orders = {
            "PO-2026-8801": PurchaseOrder(
                po_id="PO-2026-8801",
                supplier_id="SUP-MICRO-01",
                part_id="PRT-MCU-8841",
                destination_plant_id="PLANT_BANGALORE",
                destination_warehouse_id="WH-BLR-01",
                quantity_ordered=800,
                quantity_received=0,
                unit_price_usd=85.00,
                total_amount_usd=68000.00,
                po_status=PurchaseOrderStatus.SHIPPED,
                order_date=str(today - timedelta(days=18)),
                promised_delivery_date=str(today - timedelta(days=2)),
                estimated_arrival_date=str(today + timedelta(days=6)),
                is_delayed=True,
                delay_days=8.0,
            ),
            "PO-2026-8802": PurchaseOrder(
                po_id="PO-2026-8802",
                supplier_id="SUP-HYD-03",
                part_id="PRT-HYD-VLV-09",
                destination_plant_id="PLANT_DETROIT",
                destination_warehouse_id="WH-DET-01",
                quantity_ordered=120,
                quantity_received=0,
                unit_price_usd=920.00,
                total_amount_usd=110400.00,
                po_status=PurchaseOrderStatus.SHIPPED,
                order_date=str(today - timedelta(days=22)),
                promised_delivery_date=str(today - timedelta(days=1)),
                estimated_arrival_date=str(today + timedelta(days=5)),
                is_delayed=True,
                delay_days=6.0,
            ),
            "PO-2026-8803": PurchaseOrder(
                po_id="PO-2026-8803",
                supplier_id="SUP-MECH-02",
                part_id="PRT-BRG-7014",
                destination_plant_id="PLANT_STUTTGART",
                destination_warehouse_id="WH-STG-01",
                quantity_ordered=200,
                quantity_received=0,
                unit_price_usd=340.00,
                total_amount_usd=68000.00,
                po_status=PurchaseOrderStatus.SHIPPED,
                order_date=str(today - timedelta(days=10)),
                promised_delivery_date=str(today + timedelta(days=4)),
                estimated_arrival_date=str(today + timedelta(days=4)),
                is_delayed=False,
                delay_days=0.0,
            ),
            "PO-2026-8804": PurchaseOrder(
                po_id="PO-2026-8804",
                supplier_id="SUP-MOT-04",
                part_id="PRT-SRV-MTR-400",
                destination_plant_id="PLANT_STUTTGART",
                destination_warehouse_id="WH-STG-01",
                quantity_ordered=150,
                quantity_received=0,
                unit_price_usd=760.00,
                total_amount_usd=114000.00,
                po_status=PurchaseOrderStatus.IN_FULFILLMENT,
                order_date=str(today - timedelta(days=5)),
                promised_delivery_date=str(today + timedelta(days=12)),
                estimated_arrival_date=str(today + timedelta(days=13)),
                is_delayed=False,
                delay_days=1.0,
            ),
        }

        # 7. Shipments
        self.shipments = {
            "SHP-OCEAN-771": Shipment(
                shipment_id="SHP-OCEAN-771",
                po_id="PO-2026-8801",
                carrier_name="Evergreen Marine Logistics",
                transport_mode=TransportMode.OCEAN,
                origin_hub="Kaohsiung Port (TW)",
                destination_hub="Chennai Port (IN)",
                status=ShipmentStatus.PORT_CONGESTION,
                dispatch_date=str(today - timedelta(days=14)),
                scheduled_eta=str(today - timedelta(days=2)),
                current_projected_eta=str(today + timedelta(days=6)),
                eta_drift_days=8.0,
                current_location_lat=13.0827,
                current_location_lon=80.2707,
                milestone_summary="Anchored outside Chennai outer anchorage due to berth congestion & monsoon container backlog.",
                delay_root_cause="Port berth congestion and regional logistics bottlenecks.",
                carbon_emissions_kg_co2e=340.0,
            ),
            "SHP-OCEAN-772": Shipment(
                shipment_id="SHP-OCEAN-772",
                po_id="PO-2026-8802",
                carrier_name="ONE Ocean Network Express",
                transport_mode=TransportMode.OCEAN,
                origin_hub="Yokohama (JP)",
                destination_hub="Long Beach Port (US)",
                status=ShipmentStatus.CUSTOMS_HOLD,
                dispatch_date=str(today - timedelta(days=16)),
                scheduled_eta=str(today - timedelta(days=1)),
                current_projected_eta=str(today + timedelta(days=5)),
                eta_drift_days=6.0,
                current_location_lat=33.7701,
                current_location_lon=-118.1937,
                milestone_summary="Held at Long Beach terminal 302 under customs documentation audit for origin certificate re-verification.",
                delay_root_cause="US Customs documentation hold & inspection delay.",
                carbon_emissions_kg_co2e=480.0,
            ),
            "SHP-ROAD-309": Shipment(
                shipment_id="SHP-ROAD-309",
                po_id="PO-2026-8803",
                carrier_name="Dachser European Logistics",
                transport_mode=TransportMode.ROAD_FREIGHT,
                origin_hub="Nuremberg (DE)",
                destination_hub="Stuttgart Plant (DE)",
                status=ShipmentStatus.IN_TRANSIT,
                dispatch_date=str(today - timedelta(days=1)),
                scheduled_eta=str(today + timedelta(days=4)),
                current_projected_eta=str(today + timedelta(days=4)),
                eta_drift_days=0.0,
                current_location_lat=49.4521,
                current_location_lon=11.0767,
                milestone_summary="En route on Autobahn A6, on schedule.",
                delay_root_cause=None,
                carbon_emissions_kg_co2e=65.0,
            ),
        }

        # 8. Customer Orders
        self.customer_orders = {
            "ORD-CUST-901": CustomerOrder(
                order_id="ORD-CUST-901",
                customer_name="Siemag Precision Aerospace Inc.",
                finished_assembly_id="ASM-CNC-MILL-5X",
                plant_id="PLANT_BANGALORE",
                quantity=4,
                revenue_usd=720000.00,
                sla_delivery_deadline=str(today + timedelta(days=3)),
                order_status=CustomerOrderStatus.DELAY_AT_RISK,
                sla_penalty_per_day_usd=2500.0,
                downstream_delay_days=5.0,
                is_impacted_by_supply_disruption=True,
                associated_disruption_id="DISRUPT-2026-001",
            ),
            "ORD-CUST-902": CustomerOrder(
                order_id="ORD-CUST-902",
                customer_name="Nordic Automotive Group AB",
                finished_assembly_id="ASM-HYD-PRESS-200T",
                plant_id="PLANT_DETROIT",
                quantity=2,
                revenue_usd=580000.00,
                sla_delivery_deadline=str(today + timedelta(days=4)),
                order_status=CustomerOrderStatus.DELAY_AT_RISK,
                sla_penalty_per_day_usd=3000.0,
                downstream_delay_days=4.0,
                is_impacted_by_supply_disruption=True,
                associated_disruption_id="DISRUPT-2026-002",
            ),
            "ORD-CUST-903": CustomerOrder(
                order_id="ORD-CUST-903",
                customer_name="EuroTech Robotics Corp",
                finished_assembly_id="ASM-ROBOTIC-ARM-6AXIS",
                plant_id="PLANT_STUTTGART",
                quantity=8,
                revenue_usd=640000.00,
                sla_delivery_deadline=str(today + timedelta(days=14)),
                order_status=CustomerOrderStatus.IN_PRODUCTION,
                sla_penalty_per_day_usd=1500.0,
                downstream_delay_days=0.0,
                is_impacted_by_supply_disruption=False,
                associated_disruption_id=None,
            ),
        }

        # 9. Disruption Events
        self.disruptions = {
            "DISRUPT-2026-001": DisruptionEvent(
                disruption_id="DISRUPT-2026-001",
                disruption_type=DisruptionType.PORT_CONGESTION,
                severity=RiskSeverity.CRITICAL,
                title="Chennai Port Berth Congestion — MCU Shipment Blocked",
                description="Evergreen container vessel carrying 800 units of PRT-MCU-8841 is anchored outside Chennai harbor with an 8-day berth backlog.",
                affected_supplier_ids=["SUP-MICRO-01"],
                affected_part_ids=["PRT-MCU-8841"],
                affected_shipment_ids=["SHP-OCEAN-771"],
                affected_plants=["PLANT_BANGALORE"],
                affected_customer_orders=["ORD-CUST-901"],
                estimated_daily_financial_impact_usd=28000.00,
                total_projected_disruption_cost_usd=140000.00,
                detected_at=datetime.now(timezone.utc) - timedelta(days=2),
                resolved=False,
            ),
            "DISRUPT-2026-002": DisruptionEvent(
                disruption_id="DISRUPT-2026-002",
                disruption_type=DisruptionType.CUSTOMS_CLEARANCE_FAILURE,
                severity=RiskSeverity.HIGH,
                title="Long Beach Customs Hold — Hydraulic Servo Valves",
                description="ONE container carrying 120 units of PRT-HYD-VLV-09 flagged for certificate of origin audit. Clearance delayed 6 days.",
                affected_supplier_ids=["SUP-HYD-03"],
                affected_part_ids=["PRT-HYD-VLV-09"],
                affected_shipment_ids=["SHP-OCEAN-772"],
                affected_plants=["PLANT_DETROIT"],
                affected_customer_orders=["ORD-CUST-902"],
                estimated_daily_financial_impact_usd=33600.00,
                total_projected_disruption_cost_usd=168000.00,
                detected_at=datetime.now(timezone.utc) - timedelta(days=1),
                resolved=False,
            ),
        }

        # 10. Mitigation Recommendations
        self.mitigations = {
            "REC-MIT-001": MitigationRecommendation(
                recommendation_id="REC-MIT-001",
                disruption_id="DISRUPT-2026-001",
                action_type="EXPEDITE_AIR_FREIGHT",
                description="Air-freight 200 units of PRT-MCU-8841 directly from Taiwan via China Airlines Cargo to Bangalore Kempegowda (BLR).",
                target_part_id="PRT-MCU-8841",
                source_supplier_id="SUP-MICRO-01",
                target_supplier_id="SUP-MICRO-01",
                estimated_mitigation_cost_usd=4200.00,
                estimated_downtime_cost_avoided_usd=84000.00,
                net_financial_benefit_usd=79800.00,
                speed_hours_to_execute=48,
                feasibility_score=0.92,
                urgency=RiskSeverity.CRITICAL,
                status="PENDING_APPROVAL",
                approved_by=None,
            ),
            "REC-MIT-002": MitigationRecommendation(
                recommendation_id="REC-MIT-002",
                disruption_id="DISRUPT-2026-002",
                action_type="DUAL_SOURCE_ALLOCATION",
                description="Activate regional backup stock from Midwest Aerospace Fasteners & local distributor to provide 30 emergency hydraulic kits.",
                target_part_id="PRT-HYD-VLV-09",
                source_supplier_id="SUP-HYD-03",
                target_supplier_id="SUP-FAST-05",
                estimated_mitigation_cost_usd=6500.00,
                estimated_downtime_cost_avoided_usd=100800.00,
                net_financial_benefit_usd=94300.00,
                speed_hours_to_execute=72,
                feasibility_score=0.85,
                urgency=RiskSeverity.HIGH,
                status="PENDING_APPROVAL",
                approved_by=None,
            ),
        }

        # 11. Logistics Carriers
        raw_carriers = [
            Carrier(
                carrier_id="CRR-EVERGREEN-01",
                carrier_name="Evergreen Marine Line",
                transport_mode=TransportMode.OCEAN,
                on_time_performance_rate=0.74,
                average_transit_delay_days=5.2,
                carbon_efficiency_rating="B",
                primary_corridors=["Kaohsiung-Chennai", "Ningbo-Rotterdam"],
                contact_dispatch="ops@evergreen-marine.com",
            ),
            Carrier(
                carrier_id="CRR-CAL-02",
                carrier_name="China Airlines Cargo",
                transport_mode=TransportMode.AIR,
                on_time_performance_rate=0.96,
                average_transit_delay_days=0.5,
                carbon_efficiency_rating="C",
                primary_corridors=["Taipei-Bangalore", "Incheon-Frankfurt"],
                contact_dispatch="cargo@china-airlines.com",
            ),
            Carrier(
                carrier_id="CRR-DACHSER-03",
                carrier_name="Dachser European Logistics",
                transport_mode=TransportMode.ROAD,
                on_time_performance_rate=0.95,
                average_transit_delay_days=0.8,
                carbon_efficiency_rating="B",
                primary_corridors=["Stuttgart-Rotterdam", "Munich-Milan"],
                contact_dispatch="dispatch@dachser.com",
            ),
            Carrier(
                carrier_id="CRR-ONE-04",
                carrier_name="Ocean Network Express (ONE)",
                transport_mode=TransportMode.OCEAN,
                on_time_performance_rate=0.81,
                average_transit_delay_days=4.1,
                carbon_efficiency_rating="B",
                primary_corridors=["Yokohama-Los Angeles", "Kobe-Hamburg"],
                contact_dispatch="line-ops@one-line.com",
            ),
        ]
        self.carriers = {c.carrier_id: c for c in raw_carriers}

        # 12. Warehouses
        raw_warehouses = [
            Warehouse(
                warehouse_id="WH-BLR-01",
                warehouse_name="Bangalore Central Logistics Hub",
                location_city="Bangalore",
                storage_capacity_pallets=4500,
                utilized_capacity_pct=88.5,
                associated_plant_id="PLANT_BANGALORE",
                annual_holding_cost_rate_pct=22.0,
            ),
            Warehouse(
                warehouse_id="WH-STG-01",
                warehouse_name="Stuttgart High-Bay Automated Warehouse",
                location_city="Stuttgart",
                storage_capacity_pallets=6200,
                utilized_capacity_pct=72.0,
                associated_plant_id="PLANT_STUTTGART",
                annual_holding_cost_rate_pct=20.0,
            ),
            Warehouse(
                warehouse_id="WH-DET-01",
                warehouse_name="Detroit Great Lakes Fulfillment Center",
                location_city="Detroit",
                storage_capacity_pallets=5500,
                utilized_capacity_pct=81.0,
                associated_plant_id="PLANT_DETROIT",
                annual_holding_cost_rate_pct=24.0,
            ),
        ]
        self.warehouses = {w.warehouse_id: w for w in raw_warehouses}

        # 13. Production Schedules & Starvation Risks
        raw_schedules = [
            ProductionSchedule(
                schedule_id="SCH-2026-W42-BLR-L1",
                plant_id="PLANT_BANGALORE",
                line_id="LINE-BLR-01",
                assembly_id="ASM-CNC-MILL-5X",
                assembly_name="5-Axis High Precision CNC Milling Center",
                planned_start_date="2026-10-19",
                planned_end_date="2026-10-24",
                planned_units=25,
                daily_run_rate=5,
                required_parts_allocated=False,
                starvation_risk_level=RiskSeverity.CRITICAL,
                estimated_starvation_hours=32.0,
                bottleneck_part_id="PRT-MCU-8841",
            ),
            ProductionSchedule(
                schedule_id="SCH-2026-W42-DET-L2",
                plant_id="PLANT_DETROIT",
                line_id="LINE-DET-02",
                assembly_id="ASM-HYD-PRESS-200T",
                assembly_name="200-Ton High Duty Hydraulic Stamping Press",
                planned_start_date="2026-10-20",
                planned_end_date="2026-10-25",
                planned_units=15,
                daily_run_rate=3,
                required_parts_allocated=False,
                starvation_risk_level=RiskSeverity.HIGH,
                estimated_starvation_hours=48.0,
                bottleneck_part_id="PRT-HYD-VLV-09",
            ),
            ProductionSchedule(
                schedule_id="SCH-2026-W42-STG-L1",
                plant_id="PLANT_STUTTGART",
                line_id="LINE-STG-01",
                assembly_id="ASM-ROBOTIC-ARM-6AXIS",
                assembly_name="6-Axis Articulated Industrial Robotic Arm",
                planned_start_date="2026-10-19",
                planned_end_date="2026-10-25",
                planned_units=30,
                daily_run_rate=5,
                required_parts_allocated=True,
                starvation_risk_level=RiskSeverity.LOW,
                estimated_starvation_hours=0.0,
                bottleneck_part_id=None,
            ),
        ]
        self.production_schedules = {s.schedule_id: s for s in raw_schedules}

        # 14. Probabilistic Demand Forecasts
        raw_forecasts = [
            DemandForecast(
                forecast_id="FC-2026-Q4-MILL",
                assembly_id="ASM-CNC-MILL-5X",
                assembly_name="5-Axis High Precision CNC Milling Center",
                horizon_days=30,
                p10_units=20,
                p50_units=28,
                p90_units=42,
                forecast_growth_rate_pct=14.5,
                demand_surge_risk=True,
                generated_at="2026-10-18",
            ),
            DemandForecast(
                forecast_id="FC-2026-Q4-ROBOT",
                assembly_id="ASM-ROBOTIC-ARM-6AXIS",
                assembly_name="6-Axis Articulated Industrial Robotic Arm",
                horizon_days=30,
                p10_units=25,
                p50_units=35,
                p90_units=48,
                forecast_growth_rate_pct=6.0,
                demand_surge_risk=False,
                generated_at="2026-10-18",
            ),
            DemandForecast(
                forecast_id="FC-2026-Q4-PRESS",
                assembly_id="ASM-HYD-PRESS-200T",
                assembly_name="200-Ton High Duty Hydraulic Stamping Press",
                horizon_days=30,
                p10_units=12,
                p50_units=16,
                p90_units=22,
                forecast_growth_rate_pct=3.0,
                demand_surge_risk=False,
                generated_at="2026-10-18",
            ),
        ]
        self.demand_forecasts = {f.forecast_id: f for f in raw_forecasts}

        # 15. Alternative Supplier Pre-Negotiated Contracts
        raw_alt_contracts = [
            AlternativeSupplierContract(
                contract_id="ALT-CONT-01",
                primary_supplier_id="SUP-MICRO-01",
                alternative_supplier_id="SUP-KOREA-SEMI-08",
                alternative_supplier_name="Hana Semiconductor Solutions",
                part_id="PRT-MCU-8841",
                guaranteed_capacity_units_per_month=500,
                expedited_lead_time_days=7,
                price_premium_pct=18.0,
                is_contract_active=True,
            ),
            AlternativeSupplierContract(
                contract_id="ALT-CONT-02",
                primary_supplier_id="SUP-HYD-03",
                alternative_supplier_id="SUP-EU-HYD-09",
                alternative_supplier_name="Danfoss Industrial Fluid Systems",
                part_id="PRT-HYD-VLV-09",
                guaranteed_capacity_units_per_month=150,
                expedited_lead_time_days=10,
                price_premium_pct=12.5,
                is_contract_active=True,
            ),
        ]
        self.alternative_contracts = {c.contract_id: c for c in raw_alt_contracts}

        # 16. Excess Inventory & Tied-Up Working Capital Items
        raw_excess = [
            ExcessInventoryItem(
                part_id="PRT-BOLT-M16-HT",
                part_name="M16 Grade 12.9 High-Tensile Machine Bolt (Pack of 50)",
                stock_on_hand=8500,
                days_of_inventory=212.5,
                excess_units=5500,
                tied_up_capital_usd=176000.0,
                annual_holding_cost_usd=38720.0,
                obsolescence_risk_score=0.18,
                recommended_action="REBALANCE_TO_PLANT",
            ),
            ExcessInventoryItem(
                part_id="PRT-FLT-SEAL-99",
                part_name="Nitrile O-Ring Flange Gasket Seal 120mm",
                stock_on_hand=3500,
                days_of_inventory=225.0,
                excess_units=2500,
                tied_up_capital_usd=52500.0,
                annual_holding_cost_usd=11550.0,
                obsolescence_risk_score=0.45,
                recommended_action="RETURN_TO_SUPPLIER",
            ),
        ]
        self.excess_inventory = {e.part_id: e for e in raw_excess}

    # Repository Access Methods
    def list_suppliers(self, risk_level: Optional[str] = None) -> list[Supplier]:
        res = list(self.suppliers.values())
        if risk_level and risk_level != "All":
            res = [s for s in res if s.composite_risk_level.value == risk_level]
        return res

    def get_supplier(self, supplier_id: str) -> Optional[Supplier]:
        return self.suppliers.get(supplier_id)

    def list_parts(self) -> list[Part]:
        return list(self.parts.values())

    def get_part(self, part_id: str) -> Optional[Part]:
        return self.parts.get(part_id)

    def list_inventory(self, plant_id: Optional[str] = None) -> list[InventoryItem]:
        res = list(self.inventory.values())
        if plant_id and plant_id != "All":
            res = [i for i in res if i.plant_id == plant_id]
        return res

    def list_purchase_orders(self) -> list[PurchaseOrder]:
        return list(self.purchase_orders.values())

    def list_shipments(self, status: Optional[str] = None) -> list[Shipment]:
        res = list(self.shipments.values())
        if status and status != "All":
            res = [s for s in res if s.status.value == status]
        return res

    def list_customer_orders(self, at_risk_only: bool = False) -> list[CustomerOrder]:
        res = list(self.customer_orders.values())
        if at_risk_only:
            res = [o for o in res if o.is_impacted_by_supply_disruption]
        return res

    def list_disruptions(self, active_only: bool = True) -> list[DisruptionEvent]:
        res = list(self.disruptions.values())
        if active_only:
            res = [d for d in res if not d.resolved]
        return res

    def list_mitigations(self) -> list[MitigationRecommendation]:
        return list(self.mitigations.values())

    def approve_mitigation(self, recommendation_id: str, approver: str) -> Optional[MitigationRecommendation]:
        rec = self.mitigations.get(recommendation_id)
        if rec:
            rec.status = "APPROVED"
            rec.approved_by = approver
            # Auto-resolve disruption if mitigation is approved
            dis = self.disruptions.get(rec.disruption_id)
            if dis:
                dis.resolved = True
        return rec

    def list_carriers(self) -> list[Carrier]:
        return list(self.carriers.values())

    def get_carrier(self, carrier_id: str) -> Optional[Carrier]:
        return self.carriers.get(carrier_id)

    def list_warehouses(self, plant_id: Optional[str] = None) -> list[Warehouse]:
        res = list(self.warehouses.values())
        if plant_id and plant_id != "All":
            res = [w for w in res if w.associated_plant_id == plant_id]
        return res

    def get_warehouse(self, warehouse_id: str) -> Optional[Warehouse]:
        return self.warehouses.get(warehouse_id)

    def list_production_schedules(self, plant_id: Optional[str] = None, at_risk_only: bool = False) -> list[ProductionSchedule]:
        res = list(self.production_schedules.values())
        if plant_id and plant_id != "All":
            res = [s for s in res if s.plant_id == plant_id]
        if at_risk_only:
            res = [s for s in res if s.starvation_risk_level in [RiskSeverity.HIGH, RiskSeverity.CRITICAL]]
        return res

    def list_demand_forecasts(self, assembly_id: Optional[str] = None) -> list[DemandForecast]:
        res = list(self.demand_forecasts.values())
        if assembly_id:
            res = [f for f in res if f.assembly_id == assembly_id]
        return res

    def list_alternative_contracts(self, part_id: Optional[str] = None) -> list[AlternativeSupplierContract]:
        res = list(self.alternative_contracts.values())
        if part_id:
            res = [c for c in res if c.part_id == part_id]
        return res

    def list_excess_inventory(self) -> list[ExcessInventoryItem]:
        return list(self.excess_inventory.values())


# Global singleton instance
local_supply_chain_repo = LocalMockSupplyChainRepository()
