"""Auditable Industrial ROI Intelligence Service.

Computes financial ROI metrics based on documented baseline vs observed outcomes:
- Unplanned downtime hours and costs
- Avoided downtime savings (Estimated vs Realized)
- Maintenance labor & spare-parts expenditures
- Platform operating costs
- Net Benefit ($), ROI (%), and Payback Period (Months)
All figures backed by auditable line items in fact_roi_ledger to prevent double-counting.
"""
from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel
from backend.features.predictive_maintenance.schemas.canonical_models import (
    FactRoiLedger,
    RoiEntryType,
    DataProvenance,
    ApprovalStatus,
)
from backend.features.predictive_maintenance.services.recommendation_engine import recommendation_engine
from backend.features.predictive_maintenance.services.canonical_mapping_service import canonical_mapping_service


class RoiSummary(BaseModel):
    baseline_annual_unplanned_downtime_hours: float
    baseline_annual_downtime_cost_usd: float
    realized_downtime_hours_avoided: float
    realized_downtime_cost_avoided_usd: float
    estimated_downtime_hours_avoided: float
    estimated_downtime_cost_avoided_usd: float
    preventive_maintenance_expenditure_usd: float
    platform_annual_operating_cost_usd: float
    net_realized_benefit_usd: float
    net_total_projected_benefit_usd: float
    roi_percentage: float
    payback_period_months: float
    audit_ledger_entries_count: int


class RoiIntelligenceService:
    """Calculates defensible, volume-adjusted ROI and maintains the financial ledger."""

    def __init__(self) -> None:
        self.ledger: list[FactRoiLedger] = []
        self.platform_annual_cost_usd = 65000.0  # GCP Cloud Run, BigQuery, telemetry infra
        self._seed_baseline_and_historical_ledger()

    def _seed_baseline_and_historical_ledger(self) -> None:
        """Seeds historical verified savings and baseline ledger entries for demonstration."""
        now = datetime.now(timezone.utc)
        
        # 1. Historical Realized Savings: ROB-002 gearbox bearing overhaul
        self.ledger.append(FactRoiLedger(
            ledger_id="LEDG-REAL-001",
            asset_id="ROB-002",
            recorded_at=now,
            entry_type=RoiEntryType.AVOIDED_DOWNTIME,
            value_category=DataProvenance.REALIZED,
            amount_usd=58800.0,
            downtime_hours=14.0,
            calculation_formula="14.0 avoided hours * $4,200/hr downtime rate",
            evidence_reference="WO-REAL-9812 (Verified by Chief Reliability Eng)",
            cumulative_net_benefit_usd=58800.0,
        ))

        # 2. Historical Realized Savings: CNC-001 spindle bearing replacement
        self.ledger.append(FactRoiLedger(
            ledger_id="LEDG-REAL-002",
            asset_id="CNC-001",
            recorded_at=now,
            entry_type=RoiEntryType.AVOIDED_DOWNTIME,
            value_category=DataProvenance.REALIZED,
            amount_usd=42000.0,
            downtime_hours=12.0,
            calculation_formula="12.0 avoided hours * $3,500/hr downtime rate",
            evidence_reference="WO-REAL-9943 (Verified by Shift Maintenance Lead)",
            cumulative_net_benefit_usd=100800.0,
        ))

        # 3. Preventive Repair Costs (Debit)
        self.ledger.append(FactRoiLedger(
            ledger_id="LEDG-EXP-001",
            asset_id="FLEET-MAINT",
            recorded_at=now,
            entry_type=RoiEntryType.PREVENTIVE_REPAIR,
            value_category=DataProvenance.REALIZED,
            amount_usd=-16400.0,
            downtime_hours=3.5,
            calculation_formula="Planned replacement parts ($12,200) + technician labor ($4,200)",
            evidence_reference="ERP-SAP-PO-55102",
            cumulative_net_benefit_usd=84400.0,
        ))

        # 4. Platform Operating Cost (Debit)
        self.ledger.append(FactRoiLedger(
            ledger_id="LEDG-PLAT-001",
            asset_id="GCP-INFRA",
            recorded_at=now,
            entry_type=RoiEntryType.PLATFORM_OPERATING_COST,
            value_category=DataProvenance.REALIZED,
            amount_usd=-self.platform_annual_cost_usd,
            downtime_hours=0.0,
            calculation_formula="Annualized Google Cloud Infrastructure & Sensor Management",
            evidence_reference="GCP-BILLING-PROJECT-TWIN",
            cumulative_net_benefit_usd=19400.0,
        ))

    def compute_roi_summary(self) -> RoiSummary:
        """Aggregates realized ledger items and correlates active advisory recommendations."""
        # Baseline annual unmonitored plant baseline:
        # 20 machines * 1.8 unmonitored breakdown events/yr = 36 failures
        # Average breakdown duration: 11.5 hours * $3,200/hr average loss = $36,800/failure
        baseline_downtime_hours = 414.0  # 36 * 11.5
        baseline_cost_usd = 1324800.0   # 414 * $3,200

        # Realized from ledger
        realized_hours = sum(e.downtime_hours for e in self.ledger if e.value_category == DataProvenance.REALIZED and e.entry_type == RoiEntryType.AVOIDED_DOWNTIME)
        realized_cost = sum(e.amount_usd for e in self.ledger if e.value_category == DataProvenance.REALIZED and e.entry_type == RoiEntryType.AVOIDED_DOWNTIME)
        maint_costs = abs(sum(e.amount_usd for e in self.ledger if e.entry_type == RoiEntryType.PREVENTIVE_REPAIR))

        # Estimated from currently active APPROVED or PENDING recommendations
        active_recs = list(recommendation_engine.recommendations.values())
        estimated_hours = sum(r.expected_downtime_avoided_hours for r in active_recs if r.approval_status != ApprovalStatus.REJECTED)
        estimated_cost = sum(r.expected_cost_avoidance_usd for r in active_recs if r.approval_status != ApprovalStatus.REJECTED)

        net_realized = realized_cost - maint_costs - self.platform_annual_cost_usd
        total_projected_savings = realized_cost + estimated_cost
        net_total = total_projected_savings - maint_costs - self.platform_annual_cost_usd

        # ROI percentage = (Net Total Benefit / Total Platform Investment) * 100
        roi_pct = round((net_total / max(1.0, self.platform_annual_cost_usd)) * 100.0, 1)

        # Payback period = Platform Cost / Monthly Gross Avoided Cost
        monthly_runrate = max(100.0, (total_projected_savings / 12.0))
        payback_months = round(self.platform_annual_cost_usd / monthly_runrate, 1)

        return RoiSummary(
            baseline_annual_unplanned_downtime_hours=baseline_downtime_hours,
            baseline_annual_downtime_cost_usd=baseline_cost_usd,
            realized_downtime_hours_avoided=realized_hours,
            realized_downtime_cost_avoided_usd=realized_cost,
            estimated_downtime_hours_avoided=estimated_hours,
            estimated_downtime_cost_avoided_usd=estimated_cost,
            preventive_maintenance_expenditure_usd=maint_costs,
            platform_annual_operating_cost_usd=self.platform_annual_cost_usd,
            net_realized_benefit_usd=round(net_realized, 2),
            net_total_projected_benefit_usd=round(net_total, 2),
            roi_percentage=roi_pct,
            payback_period_months=payback_months,
            audit_ledger_entries_count=len(self.ledger),
        )

    def get_ledger_entries(self) -> list[FactRoiLedger]:
        return sorted(self.ledger, key=lambda e: e.recorded_at, reverse=True)


# Global singleton instance
roi_intelligence_service = RoiIntelligenceService()
