"""Maintenance and Equipment Reliability Service.

Calculates:
- Asset availability = (Operating Hours - Downtime Hours) / Operating Hours
- Mean Time Between Failures (MTBF)
- Mean Time To Repair (MTTR)
- Scheduled Maintenance Windows and Capacity at Risk
"""
from typing import Any, Optional

from backend.features.demand_forecasting.schemas.manufacturing import (
    EquipmentAssetReport,
    DowntimeEventReport,
)
from backend.features.demand_forecasting.repositories.local_manufacturing_repo import (
    LocalManufacturingRepository,
    local_manufacturing_repo,
)


class MaintenanceEquipmentService:
    """Manages plant asset availability, historical downtime, and scheduled maintenance windows."""

    def __init__(self, repository: Optional[LocalManufacturingRepository] = None) -> None:
        self.repo = repository or local_manufacturing_repo

    def get_asset_reports(self, plant_id: Optional[str] = None) -> list[EquipmentAssetReport]:
        assets = list(self.repo.equipment_assets.values())
        if plant_id and plant_id != "All":
            assets = [a for a in assets if a.plant_id == plant_id]
        return assets

    def get_downtime_history(
        self, plant_id: Optional[str] = None, status: Optional[str] = None
    ) -> list[DowntimeEventReport]:
        events = self.repo.downtime_events
        if plant_id and plant_id != "All":
            events = [e for e in events if e.plant_id == plant_id]
        return events

    def get_capacity_risks(self, plant_id: Optional[str] = None) -> list[dict[str, Any]]:
        assets = self.get_asset_reports(plant_id=plant_id)
        risks = []
        for a in assets:
            if a.planned_downtime_hours_next_14d > 0 or a.health_status in ["WARNING", "CRITICAL"]:
                risks.append({
                    "asset_id": a.asset_id,
                    "asset_name": a.asset_name,
                    "plant_id": a.plant_id,
                    "line_id": a.line_id,
                    "health_status": a.health_status,
                    "planned_maintenance_hours": a.planned_downtime_hours_next_14d,
                    "capacity_at_risk_hours": a.capacity_at_risk_hours,
                    "mtbf_hours": a.mtbf_hours,
                    "mttr_hours": a.mttr_hours,
                })
        return risks


# Global singleton instance
maintenance_equipment_service = MaintenanceEquipmentService()
