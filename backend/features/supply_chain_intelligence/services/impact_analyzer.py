"""Multi-Echelon End-to-End Impact Analyzer.

Traces supply chain disruptions deterministically across the multi-echelon network:
Inbound Disruption -> Purchase Orders -> In-Transit Shipments ->
Inventory Depletion & Time-to-Depletion (TTD) -> Starved Production Lines ->
Customer Orders & SLA Penalty Penalties -> Prescriptive Mitigation Action.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from backend.features.supply_chain_intelligence.schemas.ontology import (
    EndToEndImpactTrace,
    DataProvenance,
    DisruptionEvent,
    RiskSeverity,
)
from backend.features.supply_chain_intelligence.repositories.local_mock_repo import (
    LocalMockSupplyChainRepository,
    local_supply_chain_repo,
)


class MultiEchelonImpactAnalyzer:
    """Calculates deterministic downstream impact propagation across the supply network."""

    def __init__(self, repository: Optional[LocalMockSupplyChainRepository] = None) -> None:
        self.repo = repository or local_supply_chain_repo

    def trace_disruption_impact(self, disruption_id: str) -> Optional[EndToEndImpactTrace]:
        """Traces a disruption event across multi-echelon tiers to customer SLA impacts."""
        disruptions = self.repo.list_disruptions(active_only=False)
        target_disruption = next((d for d in disruptions if d.disruption_id == disruption_id), None)
        if not target_disruption:
            return None

        # 1. Affected Parts & Suppliers
        affected_parts = list(target_disruption.affected_part_ids)
        affected_suppliers = list(target_disruption.affected_supplier_ids)

        # 2. Associated Purchase Orders & Shipments
        affected_pos: list[str] = []
        for po in self.repo.list_purchase_orders():
            if po.part_id in affected_parts or po.supplier_id in affected_suppliers:
                affected_pos.append(po.po_id)

        affected_shipments = list(target_disruption.affected_shipment_ids)
        if not affected_shipments:
            for shp in self.repo.list_shipments():
                if shp.po_id in affected_pos:
                    affected_shipments.append(shp.shipment_id)

        # 3. Time to Depletion (TTD) Calculation
        # TTD = (stock_available / daily_consumption_rate) * 24 hours
        min_ttd_hours = 999.0
        now = datetime.now(timezone.utc)

        for inv in self.repo.list_inventory():
            if inv.part_id in affected_parts:
                daily_burn = max(1.0, inv.daily_consumption_rate)
                avail_units = max(0, inv.stock_available)
                hours_left = (avail_units / daily_burn) * 24.0
                if hours_left < min_ttd_hours:
                    min_ttd_hours = hours_left

        if min_ttd_hours == 999.0:
            min_ttd_hours = 48.0  # Default baseline if no inventory records

        depletion_dt = now + timedelta(hours=min_ttd_hours)
        depletion_timestamp = depletion_dt.strftime("%Y-%m-%d %H:%M:%S UTC")

        # 4. Starved Production Lines
        starved_lines: list[str] = []
        for sched in self.repo.list_production_schedules():
            if sched.bottleneck_part_id in affected_parts:
                starved_lines.append(f"{sched.plant_id}:{sched.line_id} ({sched.assembly_id})")
            else:
                # Check BOM linkages
                boms = [b for b in self.repo.boms if b.finished_assembly_id == sched.assembly_id]
                if any(b.part_id in affected_parts for b in boms):
                    starved_lines.append(f"{sched.plant_id}:{sched.line_id} ({sched.assembly_id})")

        # 5. Customer Orders at Risk & Financial Exposure
        threatened_orders: list[str] = []
        total_revenue_at_risk = 0.0
        daily_sla_penalties = 0.0

        for order in self.repo.list_customer_orders():
            is_affected = (
                order.order_id in target_disruption.affected_customer_orders
                or order.associated_disruption_id == disruption_id
            )
            if not is_affected:
                # Check BOM relationship with finished assembly
                boms = [b for b in self.repo.boms if b.finished_assembly_id == order.finished_assembly_id]
                if any(b.part_id in affected_parts for b in boms):
                    is_affected = True

            if is_affected:
                threatened_orders.append(order.order_id)
                total_revenue_at_risk += order.revenue_usd
                daily_sla_penalties += order.sla_penalty_per_day_usd

        # 6. Mitigations & Contingency Options
        contingency_mitigations: list[str] = []
        for mit in self.repo.list_mitigations():
            if mit.disruption_id == disruption_id or mit.target_part_id in affected_parts:
                contingency_mitigations.append(mit.recommendation_id)

        # Also check pre-negotiated alternative contracts
        for alt in self.repo.list_alternative_contracts():
            if alt.part_id in affected_parts and alt.is_contract_active:
                contingency_mitigations.append(f"ALT_CONTRACT:{alt.contract_id}:{alt.alternative_supplier_name}")

        return EndToEndImpactTrace(
            disruption_id=disruption_id,
            root_cause_type=target_disruption.disruption_type.value,
            trigger_entity_id=affected_suppliers[0] if affected_suppliers else (affected_parts[0] if affected_parts else "NETWORK"),
            affected_pos=affected_pos,
            affected_shipments=affected_shipments,
            affected_parts=affected_parts,
            time_to_depletion_hours=round(min_ttd_hours, 1),
            depletion_timestamp=depletion_timestamp,
            starved_production_lines=list(set(starved_lines)),
            threatened_customer_orders=list(set(threatened_orders)),
            total_revenue_at_risk_usd=round(total_revenue_at_risk, 2),
            daily_sla_penalties_usd=round(daily_sla_penalties, 2),
            total_projected_loss_usd=round(target_disruption.total_projected_disruption_cost_usd, 2),
            contingency_mitigation_ids=contingency_mitigations,
            data_provenance=DataProvenance.ACTUAL,
        )

    def simulate_what_if_impact(
        self,
        scenario_name: str,
        target_part_id: str,
        delay_days: float,
        plant_id: str = "PLANT_BANGALORE",
    ) -> EndToEndImpactTrace:
        """Simulates what-if impact for hypothetical disruptions, tagged with SIMULATED_SCENARIO provenance."""
        part = self.repo.get_part(target_part_id)
        part_name = part.part_name if part else target_part_id

        # Find inventory
        inv = next((i for i in self.repo.list_inventory(plant_id) if i.part_id == target_part_id), None)
        daily_burn = inv.daily_consumption_rate if inv else 30.0
        stock_avail = inv.stock_available if inv else 50
        ttd_hours = max(0.0, (stock_avail / daily_burn) * 24.0)
        depletion_dt = datetime.now(timezone.utc) + timedelta(hours=ttd_hours)

        # Downstream assemblies
        impacted_boms = [b for b in self.repo.boms if b.part_id == target_part_id]
        assembly_ids = [b.finished_assembly_id for b in impacted_boms]

        # Starved schedules
        starved_lines = [
            f"{s.plant_id}:{s.line_id} ({s.assembly_id})"
            for s in self.repo.list_production_schedules(plant_id)
            if s.assembly_id in assembly_ids or s.bottleneck_part_id == target_part_id
        ]

        # Customer orders
        impacted_orders = [
            o for o in self.repo.list_customer_orders()
            if o.finished_assembly_id in assembly_ids and (plant_id == "All" or o.plant_id == plant_id)
        ]

        revenue_at_risk = sum(o.revenue_usd for o in impacted_orders)
        daily_sla = sum(o.sla_penalty_per_day_usd for o in impacted_orders)
        total_loss = (daily_sla * delay_days) + (delay_days * 24.0 * 3500.0 * 0.4)  # downtime + SLA

        # Mitigations
        mitigations = [
            f"ALT_CONTRACT:{c.contract_id}:{c.alternative_supplier_name}"
            for c in self.repo.list_alternative_contracts(target_part_id)
        ]

        return EndToEndImpactTrace(
            disruption_id=f"SIM-{scenario_name.upper()}-{target_part_id}",
            root_cause_type="SIMULATED_DISRUPTION",
            trigger_entity_id=target_part_id,
            affected_pos=[f"SIM-PO-{target_part_id}"],
            affected_shipments=[f"SIM-SHP-{target_part_id}"],
            affected_parts=[target_part_id],
            time_to_depletion_hours=round(ttd_hours, 1),
            depletion_timestamp=depletion_dt.strftime("%Y-%m-%d %H:%M:%S UTC"),
            starved_production_lines=starved_lines,
            threatened_customer_orders=[o.order_id for o in impacted_orders],
            total_revenue_at_risk_usd=round(revenue_at_risk, 2),
            daily_sla_penalties_usd=round(daily_sla, 2),
            total_projected_loss_usd=round(total_loss, 2),
            contingency_mitigation_ids=mitigations,
            data_provenance=DataProvenance.SIMULATED_SCENARIO,
        )


# Global singleton instance
multi_echelon_impact_analyzer = MultiEchelonImpactAnalyzer()
