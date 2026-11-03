"""Canonical Asset Mapping & Data Quality Service.

Translates native identifiers across PLC, CMMS, MES, and ERP systems into
a single canonical asset_id using the bridge_asset_source_id registry.
"""
from datetime import datetime, timezone
from typing import Optional
from backend.features.predictive_maintenance.schemas.canonical_models import (
    DimAsset,
    BridgeAssetSourceId,
    SourceSystemType,
    AssetCriticality,
    FactSensorReading,
    FactWorkOrder,
    FactProductionDowntime,
    FactInventoryCost,
    DataProvenance,
)
from backend.features.predictive_maintenance.connectors.manager import source_system_manager


class CanonicalMappingService:
    """Maintains enterprise asset catalog and cross-system bridge mappings."""

    def __init__(self) -> None:
        self.assets: dict[str, DimAsset] = {}
        self.bridge_mappings: dict[str, str] = {}  # f"{source_system}:{source_id}" -> canonical_asset_id
        from backend.core.db import bind_repository
        from backend.features.predictive_maintenance.repositories.tables import ASSETS, SOURCE_MAPPINGS

        bind_repository(self, {"assets": ASSETS, "bridge_mappings": SOURCE_MAPPINGS}, seed=self._seed_default_enterprise_catalog)

    def _seed_default_enterprise_catalog(self) -> None:
        """Seeds canonical 20-asset fleet across 3 plants with cross-system bridge mappings."""
        types_info = [
            ("CNC", "CNC_MILLING", AssetCriticality.A, 3500.0, 180000.0),
            ("ROB", "ROBOTIC_ARM", AssetCriticality.A, 4200.0, 125000.0),
            ("PMP", "CENTRIFUGAL_PUMP", AssetCriticality.B, 1800.0, 45000.0),
            ("PRS", "HYDRAULIC_PRESS", AssetCriticality.A, 5000.0, 250000.0),
            ("CNV", "CONVEYOR_SYSTEM", AssetCriticality.C, 1200.0, 35000.0),
        ]
        plants = ["PLANT_BANGALORE", "PLANT_STUTTGART", "PLANT_DETROIT"]

        count = 1
        for code, eq_type, crit, dt_cost, repl_val in types_info:
            for plant in plants:
                asset_id = f"{code}-{count:03d}"
                self.assets[asset_id] = DimAsset(
                    asset_id=asset_id,
                    asset_name=f"{plant.split('_')[1]} {eq_type.replace('_', ' ').title()} #{count}",
                    plant_id=plant,
                    line_id=f"LINE-{(count % 3) + 1}",
                    equipment_type=eq_type,
                    criticality=crit,
                    manufacturer="Twin / Fanuc Industrial",
                    model_number=f"GEN4-{code}",
                    hourly_downtime_cost_usd=dt_cost,
                    replacement_value_usd=repl_val,
                    baseline_vibration_rms=1.2,
                    baseline_temperature_c=42.0,
                )

                # Bridge mappings for each source system
                self.register_source_mapping(asset_id, SourceSystemType.PLC_SCADA, f"TAG_{plant[:4]}_{asset_id}")
                self.register_source_mapping(asset_id, SourceSystemType.CMMS_MAXIMO, f"MX-EQ-{1000 + count}")
                self.register_source_mapping(asset_id, SourceSystemType.MES_OPCENTER, f"OPC-ST-{asset_id}")
                self.register_source_mapping(asset_id, SourceSystemType.ERP_SAP, f"SAP-AST-{8000 + count}")
                count += 1
                if count > 20:
                    break
            if count > 20:
                break

    def register_source_mapping(self, canonical_asset_id: str, source_system: SourceSystemType, source_identifier: str) -> None:
        key = f"{source_system.value}:{source_identifier}"
        self.bridge_mappings[key] = canonical_asset_id

    def resolve_canonical_id(self, source_system: str, source_identifier: str) -> str:
        """Resolves any external system native ID (e.g. PLC tag or SAP asset) to canonical asset_id."""
        key = f"{source_system}:{source_identifier}"
        return self.bridge_mappings.get(key, source_identifier)

    def get_canonical_asset(self, asset_id: str) -> Optional[DimAsset]:
        return self.assets.get(asset_id)

    def list_canonical_assets(self, plant_id: Optional[str] = None, criticality: Optional[str] = None) -> list[DimAsset]:
        results = list(self.assets.values())
        if plant_id:
            results = [a for a in results if a.plant_id == plant_id]
        if criticality:
            results = [a for a in results if a.criticality.value == criticality]
        return results


# Global singleton instance
canonical_mapping_service = CanonicalMappingService()
