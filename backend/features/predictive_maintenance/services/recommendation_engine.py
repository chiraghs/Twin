"""Twin Maintenance Recommendation Engine.

Ranks assets by Criticality-Adjusted Risk Index (CARI), correlates with
spare-parts availability from ERP and downtime impact from MES, and produces
actionable, explainable maintenance advisories requiring human-in-the-loop approval.
"""
from datetime import datetime, timezone
from typing import Any, Optional
from backend.features.predictive_maintenance.schemas.canonical_models import (
    DimAsset,
    FactMaintenanceRecommendation,
    RecommendationUrgency,
    ApprovalStatus,
    AssetCriticality,
)
from backend.features.predictive_maintenance.services.canonical_mapping_service import canonical_mapping_service
from backend.features.predictive_maintenance.config.models import maintenance_config_store


class RecommendationEngine:
    """Evaluates multi-factor industrial risk to generate prioritized maintenance recommendations."""

    def __init__(self) -> None:
        self.recommendations: dict[str, FactMaintenanceRecommendation] = {}

    def generate_recommendations_for_fleet(self, fleet_status: list[dict[str, Any]]) -> list[FactMaintenanceRecommendation]:
        """Evaluates live machines, ranks them by CARI, and creates or updates advisory recommendations."""
        results = []
        cfg = maintenance_config_store.get_config()

        for m in fleet_status:
            asset_id = m.get("machine_id")
            if not asset_id:
                continue
            dim = canonical_mapping_service.get_canonical_asset(asset_id)
            if not dim:
                # Auto-synthesize catalog entry for uncataloged assets
                dim = DimAsset(
                    asset_id=asset_id,
                    asset_name=f"Industrial Machine {asset_id}",
                    plant_id=m.get("plant_id", "PLANT_BANGALORE"),
                    line_id="LINE-1",
                    equipment_type=m.get("machine_type", "GENERAL_MACHINERY"),
                    criticality=AssetCriticality.B,
                    hourly_downtime_cost_usd=2500.0,
                    replacement_value_usd=100000.0,
                )
                canonical_mapping_service.assets[asset_id] = dim

            p_fail = float(m.get("failure_probability", 0.05))
            vibration = float(m.get("latest_vibration", 1.2))
            temperature = float(m.get("latest_temperature", 42.0))

            # Criticality weight: A (3.0), B (1.8), C (1.0)
            crit_weight = 3.0 if dim.criticality == AssetCriticality.A else (1.8 if dim.criticality == AssetCriticality.B else 1.0)
            hourly_loss = dim.hourly_downtime_cost_usd

            # Criticality-Adjusted Risk Index (CARI)
            cari = round(p_fail * crit_weight * (hourly_loss / 1000.0), 2)

            # Spare parts check (simulated ERP link)
            parts_needed = [f"BEARING-SKF-{dim.equipment_type[:3]}", f"SEAL-NITRILE-{dim.equipment_type[:3]}"]
            parts_available = True
            # Mock part constraint: PMP assets have low inventory
            if "PMP" in asset_id:
                parts_available = False

            # Determine urgency and action
            if p_fail >= cfg.high_risk_probability_threshold or cari >= 15.0 or vibration >= cfg.iso_thresholds.zone_c_unsatisfactory_max:
                urgency = RecommendationUrgency.IMMEDIATE
                action = f"EMERGENCY OVERHAUL: Replace {parts_needed[0]} within 4-8 hours"
                rationale = (
                    f"Asset {asset_id} exhibits imminent failure probability (P={p_fail:.1%}) with vibration ({vibration:.1f} mm/s) "
                    f"exceeding ISO 10816 Zone D trip threshold. Production stoppage risk is ${hourly_loss:,.0f}/hr."
                )
                hours_saved = 14.0
            elif p_fail >= cfg.medium_risk_probability_threshold or cari >= 7.0:
                urgency = RecommendationUrgency.SCHEDULED_NEXT_SHIFT
                action = f"PLANNED INSPECTION & LUBRICATION: Inspect {parts_needed[0]} and re-align drive shaft"
                rationale = (
                    f"Thermal drift ({temperature:.1f}°C) and vibration slope indicate accelerated mechanical friction. "
                    f"Maintenance recommended during upcoming scheduled shift change to prevent unplanned breakdown."
                )
                hours_saved = 6.0
            elif p_fail >= 0.15:
                urgency = RecommendationUrgency.SCHEDULED_WEEKLY
                action = "SCHEDULED VIBRATION AUDIT: Collect high-frequency spectral FFT reading"
                rationale = f"Slight harmonic elevation detected. Asset remains within acceptable ISO Zone B operational bounds."
                hours_saved = 2.0
            else:
                urgency = RecommendationUrgency.MONITOR
                action = "CONTINUOUS CONDITION MONITORING: Maintain nominal operating envelope"
                rationale = "Operating telemetry nominal. All mechanical components within design tolerances."
                hours_saved = 0.0

            cost_avoidance = round(hours_saved * hourly_loss, 2)

            rec_id = f"REC-{asset_id}"
            # Preserve existing approval state if already decided
            existing = self.recommendations.get(rec_id)
            status = existing.approval_status if existing else ApprovalStatus.PENDING_APPROVAL
            approved_by = existing.approved_by if existing else None
            approved_at = existing.approved_at if existing else None

            rec = FactMaintenanceRecommendation(
                recommendation_id=rec_id,
                asset_id=asset_id,
                created_at=datetime.now(timezone.utc),
                urgency=urgency,
                recommended_action=action,
                rationale=rationale,
                supporting_evidence={
                    "failure_probability": p_fail,
                    "vibration_rms": vibration,
                    "temperature_celsius": temperature,
                    "criticality_weight": crit_weight,
                    "hourly_downtime_cost_usd": hourly_loss,
                    "cari_score": cari,
                },
                expected_downtime_avoided_hours=hours_saved,
                expected_cost_avoidance_usd=cost_avoidance,
                required_parts=parts_needed,
                parts_available=parts_available,
                approval_status=status,
                approved_by=approved_by,
                approved_at=approved_at,
            )
            self.recommendations[rec_id] = rec
            results.append(rec)

        # Sort recommendations by CARI score descending
        results.sort(key=lambda r: r.supporting_evidence.get("cari_score", 0.0), reverse=True)
        return results

    def approve_recommendation(self, recommendation_id: str, approver_name: str) -> Optional[FactMaintenanceRecommendation]:
        """Human approval action transitioning recommendation to APPROVED status."""
        rec = self.recommendations.get(recommendation_id)
        if rec:
            rec.approval_status = ApprovalStatus.APPROVED
            rec.approved_by = approver_name
            rec.approved_at = datetime.now(timezone.utc)
            rec.cmms_work_order_created = f"WO-AUTO-{int(datetime.now(timezone.utc).timestamp())}"
            return rec
        return None

    def reject_recommendation(self, recommendation_id: str, approver_name: str) -> Optional[FactMaintenanceRecommendation]:
        """Human rejection action for false alarms or deferred maintenance."""
        rec = self.recommendations.get(recommendation_id)
        if rec:
            rec.approval_status = ApprovalStatus.REJECTED
            rec.approved_by = approver_name
            rec.approved_at = datetime.now(timezone.utc)
            return rec
        return None


# Global singleton instance
recommendation_engine = RecommendationEngine()
