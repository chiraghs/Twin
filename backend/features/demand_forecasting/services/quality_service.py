"""Quality Analytics Service for Manufacturing Intelligence.

Calculates:
- First-Pass Yield (FPY) = (Inspected Units - Scrapped Units - Reworked Units) / Inspected Units
- Defect Rate & Scrap Rate
- Defects Per Million Opportunities (DPMO)
- Estimated Usable Output percentage used directly in production planning
"""
from typing import Any, Optional

from backend.features.demand_forecasting.schemas.manufacturing import (
    QualityMetricsSummary,
    QualityTrendRecord,
)
from backend.features.demand_forecasting.repositories.local_manufacturing_repo import (
    LocalManufacturingRepository,
    local_manufacturing_repo,
)


class QualityAnalyticsService:
    """Computes quality yield metrics, scrap rates, and feeds usable output to production planning."""

    def __init__(self, repository: Optional[LocalManufacturingRepository] = None) -> None:
        self.repo = repository or local_manufacturing_repo

    def get_quality_metrics(
        self, plant_id: Optional[str] = None, product_id: Optional[str] = None
    ) -> QualityMetricsSummary:
        """Retrieves quality summary for a plant or returns network aggregate."""
        if plant_id and plant_id in self.repo.quality_summaries:
            return self.repo.quality_summaries[plant_id]

        # Aggregate across all plants
        all_sums = list(self.repo.quality_summaries.values())
        tot_inspected = sum(s.inspected_units_total for s in all_sums)
        tot_defective = sum(s.defective_units_total for s in all_sums)
        tot_scrapped = sum(s.scrapped_units_total for s in all_sums)
        tot_reworked = sum(s.reworked_units_total for s in all_sums)

        fpy = ((tot_inspected - tot_scrapped - tot_reworked) / max(1, tot_inspected)) * 100.0
        defect_rate = (tot_defective / max(1, tot_inspected)) * 100.0
        scrap_rate = (tot_scrapped / max(1, tot_inspected)) * 100.0
        usable_out = 100.0 - scrap_rate

        return QualityMetricsSummary(
            plant_id=plant_id or "ALL_PLANTS",
            product_id=product_id,
            inspected_units_total=tot_inspected,
            defective_units_total=tot_defective,
            scrapped_units_total=tot_scrapped,
            reworked_units_total=tot_reworked,
            first_pass_yield_pct=round(fpy, 1),
            defect_rate_pct=round(defect_rate, 1),
            scrap_rate_pct=round(scrap_rate, 1),
            estimated_usable_output_pct=round(usable_out, 1),
            dpmo=round((tot_defective / max(1, tot_inspected)) * 1_000_000.0, 0),
        )

    def get_quality_trends(self, plant_id: Optional[str] = None) -> list[QualityTrendRecord]:
        """Provides chronological weekly quality trends."""
        trends = [
            QualityTrendRecord(date="2026-09-20", plant_id="PLANT_BANGALORE", fpy_pct=96.4, scrap_rate_pct=2.1, defect_type_primary="DEF-ALIGN-01"),
            QualityTrendRecord(date="2026-09-27", plant_id="PLANT_BANGALORE", fpy_pct=97.0, scrap_rate_pct=1.9, defect_type_primary="DEF-SURF-SCRATCH"),
            QualityTrendRecord(date="2026-10-04", plant_id="PLANT_BANGALORE", fpy_pct=96.8, scrap_rate_pct=2.0, defect_type_primary="DEF-ALIGN-01"),
            QualityTrendRecord(date="2026-10-11", plant_id="PLANT_BANGALORE", fpy_pct=97.5, scrap_rate_pct=1.6, defect_type_primary="DEF-TORQUE-DRIFT"),
            QualityTrendRecord(date="2026-10-18", plant_id="PLANT_BANGALORE", fpy_pct=97.1, scrap_rate_pct=1.8, defect_type_primary="DEF-ALIGN-01"),
        ]
        if plant_id and plant_id != "All":
            trends = [t for t in trends if t.plant_id == plant_id]
        return trends


# Global singleton instance
quality_analytics_service = QualityAnalyticsService()
