"""Configurable parameters for Visual Quality Inspection domain."""
from pydantic import BaseModel, Field


class VisualQualityConfig(BaseModel):
    golden_similarity_threshold: float = Field(0.85, ge=0.0, le=1.0, description="Minimum similarity to golden board required to pass")
    min_defect_confidence_threshold: float = Field(0.80, ge=0.0, le=1.0, description="Confidence threshold to trigger defect classification")
    target_first_pass_yield_pct: float = Field(98.0, ge=0.0, le=100.0, description="Target line FPY percentage")
    max_acceptable_dpmo: float = Field(2000.0, ge=0.0, description="Maximum acceptable Defects Per Million Opportunities")


class QualityConfigStore:
    def __init__(self) -> None:
        self._config = VisualQualityConfig()

    def get_config(self) -> VisualQualityConfig:
        return self._config

    def update_config(self, new_config: VisualQualityConfig) -> VisualQualityConfig:
        self._config = new_config
        return self._config


quality_config_store = QualityConfigStore()
