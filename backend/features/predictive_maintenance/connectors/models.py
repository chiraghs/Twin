"""Connection contracts and health status models for industrial OT/IT systems."""
from datetime import datetime
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


class ConnectionState(str, Enum):
    CONNECTED = "CONNECTED"                      # Authenticated and receiving actual records
    CONFIGURED_UNTESTED = "CONFIGURED_UNTESTED"  # Credentials provided, probe pending
    NOT_CONFIGURED = "NOT_CONFIGURED"            # Missing required credentials or endpoints
    SIMULATED_FALLBACK = "SIMULATED_FALLBACK"    # Running simulated fallback with explicit flag
    ERROR = "ERROR"                              # Connection failure or timeout


class SourceSystemHealth(BaseModel):
    system_id: str
    system_name: str
    system_type: str  # PLC_SCADA | CMMS | MES | ERP
    state: ConnectionState
    is_actual: bool = False
    endpoint_or_path: Optional[str] = None
    missing_prerequisites: list[str] = Field(default_factory=list)
    last_sync_timestamp: Optional[datetime] = None
    records_ingested_count: int = 0
    data_freshness_seconds: Optional[float] = None
    status_detail: str


class IngestionBatchResult(BaseModel):
    source_system: str
    records_processed: int
    records_valid: int
    records_invalid: int
    data_provenance: str  # ACTUAL | SIMULATED
    duration_ms: float
    error_summary: list[str] = Field(default_factory=list)
