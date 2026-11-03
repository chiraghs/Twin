"""Predictive maintenance application service implementing deterministic physics & trend evaluation."""
from datetime import datetime, timedelta
from typing import Optional
from backend.features.predictive_maintenance.ports.contracts import (
    IPredictiveMaintenanceUseCase,
    ITelemetryReader,
)
from backend.features.predictive_maintenance.domain.models import (
    AssetDiagnosticReport,
    BearingHealth,
    RulEstimate,
    ISO10816Severity,
)
from backend.features.predictive_maintenance.config.models import (
    MaintenanceConfigStore,
    maintenance_config_store,
)


class PredictiveMaintenanceService(IPredictiveMaintenanceUseCase):
    """Application service calculating condition metrics, ISO 10816-3 zones, and RUL dynamically."""

    def __init__(
        self,
        telemetry_reader: ITelemetryReader,
        config_store: Optional[MaintenanceConfigStore] = None,
    ) -> None:
        self.telemetry = telemetry_reader
        self.config_store = config_store or maintenance_config_store

    def _classify_iso_zone(self, vib_rms: float) -> ISO10816Severity:
        # Dynamic thresholds read from runtime config store
        cfg = self.config_store.get_config().iso_thresholds
        if vib_rms < cfg.zone_a_good_max:
            return ISO10816Severity.ZONE_A_GOOD
        elif vib_rms < cfg.zone_b_acceptable_max:
            return ISO10816Severity.ZONE_B_ACCEPTABLE
        elif vib_rms < cfg.zone_c_unsatisfactory_max:
            return ISO10816Severity.ZONE_C_UNSATISFACTORY
        else:
            return ISO10816Severity.ZONE_D_UNACCEPTABLE

    def _calculate_health_score(self, vib_rms: float, temp_c: float) -> float:
        cfg = self.config_store.get_config()
        # Base penalty from vibration
        vib_headroom = max(0.1, cfg.trip_threshold_rms - 1.0)
        vib_penalty = min(1.0, max(0.0, (vib_rms - 1.0) / vib_headroom))
        
        # Thermal penalty
        temp_span = max(1.0, cfg.max_temperature_c - cfg.nominal_temperature_c)
        temp_penalty = min(1.0, max(0.0, (temp_c - cfg.nominal_temperature_c) / temp_span))
        
        composite_damage = (
            cfg.vibration_damage_weight * vib_penalty +
            cfg.temperature_damage_weight * temp_penalty
        )
        return max(0.0, min(1.0, round(1.0 - composite_damage, 3)))

    def _compute_linear_slope(self, values: list[float]) -> float:
        n = len(values)
        if n < 2:
            return 0.0
        x = list(range(n))
        x_mean = sum(x) / n
        y_mean = sum(values) / n
        numerator = sum((x[i] - x_mean) * (values[i] - y_mean) for i in range(n))
        denominator = sum((x[i] - x_mean) ** 2 for i in range(n))
        if denominator == 0.0:
            return 0.0
        return numerator / denominator

    async def estimate_rul(self, asset_id: str) -> RulEstimate:
        cfg = self.config_store.get_config()
        history = await self.telemetry.get_vibration_history(asset_id, limit=30)
        current_rms = await self.telemetry.get_latest_vibration_rms(asset_id)

        # Slope per 10-minute interval converted to slope per hour (x6)
        interval_slope = self._compute_linear_slope(history)
        hourly_degradation = max(0.01, interval_slope * 6.0)

        remaining_headroom = max(0.0, cfg.trip_threshold_rms - current_rms)
        hours_to_trip = round(remaining_headroom / hourly_degradation, 1)

        estimated_trip = datetime.utcnow() + timedelta(hours=hours_to_trip)
        confidence = 0.92 if len(history) >= 20 else 0.70

        return RulEstimate(
            asset_id=asset_id,
            hours_to_trip=hours_to_trip,
            estimated_trip_time=estimated_trip,
            confidence=confidence,
            degradation_rate_per_hour=round(hourly_degradation, 4),
        )

    async def diagnose_asset(self, asset_id: str) -> AssetDiagnosticReport:
        cfg = self.config_store.get_config()
        vib_rms = await self.telemetry.get_latest_vibration_rms(asset_id)
        temp_c = await self.telemetry.get_latest_temperature(asset_id)
        iso_zone = self._classify_iso_zone(vib_rms)
        health_score = self._calculate_health_score(vib_rms, temp_c)
        rul = await self.estimate_rul(asset_id)

        is_imminent = (
            iso_zone == ISO10816Severity.ZONE_D_UNACCEPTABLE or
            rul.hours_to_trip <= cfg.imminent_trip_hours_threshold
        )

        if is_imminent:
            rec = "IMMEDIATE_MAINTENANCE_REQUIRED: Schedule preventive overhaul to avoid line trip."
        elif iso_zone == ISO10816Severity.ZONE_C_UNSATISFACTORY:
            rec = "SCHEDULE_INSPECTION: Lubricate bearings and inspect alignment at next planned shift change."
        else:
            rec = "NORMAL_OPERATION: Continue condition monitoring."

        bearing_health = BearingHealth(
            asset_id=asset_id,
            vibration_rms=round(vib_rms, 2),
            temperature_c=round(temp_c, 1),
            iso_zone=iso_zone,
            health_score=health_score,
            primary_fault_signature="BEARING_DEGRADATION" if vib_rms > cfg.iso_thresholds.zone_b_acceptable_max else None,
        )

        return AssetDiagnosticReport(
            asset_id=asset_id,
            health=bearing_health,
            rul=rul,
            is_trip_imminent=is_imminent,
            recommended_action=rec,
        )
