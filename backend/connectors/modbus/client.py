"""Modbus TCP read-only connector (pymodbus): holding / input registers and coils."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Table = Literal["holding", "input", "coil"]


class RegisterSpec(BaseModel):
    address: int = Field(ge=0, le=65535)
    table: Table = "holding"
    scale: float = Field(default=1.0, description="Engineering value = raw × scale")
    signed: bool = False


async def read_registers(host: str, port: int, unit: int, specs: list[RegisterSpec]) -> list[dict[str, Any]]:
    """Read each register (or coil) and return raw and scaled values. Never writes."""
    from pymodbus.client import AsyncModbusTcpClient

    client = AsyncModbusTcpClient(host, port=port, timeout=4, retries=0)
    out: list[dict[str, Any]] = []
    try:
        if not await client.connect():
            raise ConnectionError(f"Modbus device at {host}:{port} is not reachable")
        for s in specs:
            try:
                if s.table == "coil":
                    r = await client.read_coils(s.address, count=1, device_id=unit)
                    raw: int | bool = bool(r.bits[0]) if not r.isError() else False
                elif s.table == "input":
                    r = await client.read_input_registers(s.address, count=1, device_id=unit)
                    raw = r.registers[0] if not r.isError() else 0
                else:
                    r = await client.read_holding_registers(s.address, count=1, device_id=unit)
                    raw = r.registers[0] if not r.isError() else 0
                if r.isError():
                    out.append({"address": s.address, "table": s.table, "raw": None, "value": None, "quality": "BAD"})
                    continue
                if isinstance(raw, int) and not isinstance(raw, bool) and s.signed and raw >= 0x8000:
                    raw -= 0x10000
                value = raw if isinstance(raw, bool) else round(raw * s.scale, 4)
                out.append({"address": s.address, "table": s.table, "raw": raw, "value": value, "quality": "GOOD"})
            except Exception as e:  # noqa: BLE001
                out.append({"address": s.address, "table": s.table, "raw": None, "value": None, "quality": "BAD", "error": str(e)[:120]})
    finally:
        client.close()
    return out
