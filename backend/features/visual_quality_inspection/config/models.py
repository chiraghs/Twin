"""Configurable parameters for Visual Quality Inspection domain."""
from backend.core.db.config_store import PersistentConfig
from pydantic import BaseModel, Field


class VisualQualityConfig(BaseModel):
    golden_similarity_threshold: float = Field(0.85, ge=0.0, le=1.0, description="Minimum similarity to golden board required to pass")
    min_defect_confidence_threshold: float = Field(0.80, ge=0.0, le=1.0, description="Confidence threshold to trigger defect classification")
    target_first_pass_yield_pct: float = Field(98.0, ge=0.0, le=100.0, description="Target line FPY percentage")
    max_acceptable_dpmo: float = Field(2000.0, ge=0.0, description="Maximum acceptable Defects Per Million Opportunities")


class QualityConfigStore:
    """Runtime configuration persisted in SQLite (app_config, every change in app_config_history)."""

    def __init__(self) -> None:
        self._store = PersistentConfig("visual_quality_inspection", VisualQualityConfig)

    def get_config(self) -> VisualQualityConfig:
        return self._store.get()

    def update_config(self, new_config: VisualQualityConfig, updated_by: str | None = "api") -> VisualQualityConfig:
        return self._store.put(new_config, updated_by)

    def history(self, limit: int = 20) -> list[dict]:
        return self._store.history(limit)


quality_config_store = QualityConfigStore()
