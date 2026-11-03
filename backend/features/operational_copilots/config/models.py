"""Configurable parameters for Operational Copilots domain."""
from backend.core.db.config_store import PersistentConfig
from pydantic import BaseModel, Field


class OperationalCopilotsConfig(BaseModel):
    alarm_critical_vibration_rms: float = Field(7.1, description="Vibration threshold triggering critical severity alarm")
    alert_cooldown_minutes: int = Field(30, ge=1, le=1440, description="Deduplication cooldown window in minutes")
    enable_safety_lockout_enforcement: bool = Field(True, description="Enforce mandatory LOTO verification in SOP guidance")
    default_shift_name: str = Field("Morning Shift", description="Default shift name for handover reports")


class CopilotConfigStore:
    """Runtime configuration persisted in SQLite (app_config, every change in app_config_history)."""

    def __init__(self) -> None:
        self._store = PersistentConfig("operational_copilots", OperationalCopilotsConfig)

    def get_config(self) -> OperationalCopilotsConfig:
        return self._store.get()

    def update_config(self, new_config: OperationalCopilotsConfig, updated_by: str | None = "api") -> OperationalCopilotsConfig:
        return self._store.put(new_config, updated_by)

    def history(self, limit: int = 20) -> list[dict]:
        return self._store.history(limit)


copilot_config_store = CopilotConfigStore()
