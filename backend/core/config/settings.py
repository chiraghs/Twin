"""Global application settings and environment variable schema."""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


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

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = BackendSettings()
