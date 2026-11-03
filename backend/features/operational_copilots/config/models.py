"""Configurable parameters for Operational Copilots domain."""
from pydantic import BaseModel, Field


class OperationalCopilotsConfig(BaseModel):
    alarm_critical_vibration_rms: float = Field(7.1, description="Vibration threshold triggering critical severity alarm")
    alert_cooldown_minutes: int = Field(30, ge=1, le=1440, description="Deduplication cooldown window in minutes")
    enable_safety_lockout_enforcement: bool = Field(True, description="Enforce mandatory LOTO verification in SOP guidance")
    default_shift_name: str = Field("Morning Shift", description="Default shift name for handover reports")


class CopilotConfigStore:
    def __init__(self) -> None:
        self._config = OperationalCopilotsConfig()

    def get_config(self) -> OperationalCopilotsConfig:
        return self._config

    def update_config(self, new_config: OperationalCopilotsConfig) -> OperationalCopilotsConfig:
        self._config = new_config
        return self._config


copilot_config_store = CopilotConfigStore()
