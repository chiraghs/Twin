"""Enterprise Source System Manager & Ingestion Orchestrator.

Manages all external OT/IT connections (PLC, CMMS, MES, ERP).
Enforces data provenance tagging and transparently reports missing access prerequisites.
"""
from typing import Optional
from backend.features.predictive_maintenance.connectors.models import SourceSystemHealth
from backend.features.predictive_maintenance.connectors.plc_adapter import PlcScadaAdapter
from backend.features.predictive_maintenance.connectors.cmms_adapter import CmmsAdapter
from backend.features.predictive_maintenance.connectors.mes_adapter import MesAdapter
from backend.features.predictive_maintenance.connectors.erp_adapter import ErpAdapter
from backend.features.predictive_maintenance.schemas.canonical_models import DataProvenance


class SourceSystemManager:
    """Singleton coordinator monitoring source health and executing ingestion pipelines."""

    def __init__(self) -> None:
        self.plc = PlcScadaAdapter()
        self.cmms = CmmsAdapter()
        self.mes = MesAdapter()
        self.erp = ErpAdapter()

    def get_fleet_source_health(self) -> list[SourceSystemHealth]:
        """Returns health status, active endpoints, and missing prerequisites for all 4 systems."""
        return [
            self.plc.get_health(),
            self.cmms.get_health(),
            self.mes.get_health(),
            self.erp.get_health(),
        ]

    def has_any_actual_sources(self) -> bool:
        """Returns True if any of the industrial sources have real credentials configured."""
        return any(s.is_actual for s in self.get_fleet_source_health())

    def get_effective_provenance(self) -> DataProvenance:
        """Returns ACTUAL if actual feeds are connected, otherwise explicitly SIMULATED."""
        return DataProvenance.ACTUAL if self.has_any_actual_sources() else DataProvenance.SIMULATED


# Global singleton instance
source_system_manager = SourceSystemManager()
