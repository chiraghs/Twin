"""Global application settings and environment variable schema.

Configuration comes from ONE file, `.env` at the repo root (template: `.env.example`), shared with the
web app and Docker Compose. It is loaded into the process environment, so code that reads os.getenv
(service tokens) sees it too. Real environment variables always win; blank values (KEY=) count as unset.
"""
import os
from pathlib import Path

from dotenv import dotenv_values
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

_ROOT = Path(__file__).resolve().parents[3]
if not os.getenv("TWIN_SKIP_ENV_FILES"):  # tests run with a clean environment
    for _k, _v in dotenv_values(_ROOT / ".env").items():
        if _v and not os.environ.get(_k):
            os.environ[_k] = _v


class BackendSettings(BaseSettings):
    """Twin Backend configuration schema with sensible industrial defaults."""
    app_name: str = "Twin Enterprise Intelligence Backend"
    environment: str = Field(default="development", description="development | staging | production")
    debug: bool = False
    port: int = 8000
    host: str = "0.0.0.0"

    # Meta Model API (the only AI platform). Without a key every feature runs deterministically.
    model_api_key: str = Field(default="", description="Meta Model API key (https://dev.meta.ai)")
    meta_api_base: str = Field(default="https://api.meta.ai/v1", description="Deployment-only base URL")
    meta_model: str = Field(default="muse-spark-1.3", description="Muse Spark: copilots, vision reasoning, OCR")
    meta_reasoning_model: str = Field(default="muse-wonder-1.0", description="Muse Wonder: planning & what-if narratives")
    meta_segmentation_model: str = Field(default="sam-3.1", description="SAM 3.1: defect localisation")
    meta_image_model: str = Field(default="muse-image-1.0", description="Muse Image: synthetic inspection images")
    ai_enabled: bool = True
    ai_timeout_s: float = 60.0

    # Industrial Connectors
    opcua_endpoint_url: str = "opc.tcp://localhost:4840"
    mqtt_broker_url: str = "mqtt://localhost:1883"
    modbus_host: str = "localhost"
    modbus_port: int = 502

    # MCP Server
    mcp_server_name: str = "twin-enterprise-mcp"
    mcp_auth_token: str = ""

    model_config = SettingsConfigDict(extra="ignore")  # values come from the environment (see the module docstring)


settings = BackendSettings()
