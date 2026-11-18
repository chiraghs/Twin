"""Field connectors API: browse and read OPC UA servers and Modbus TCP devices (read-only), and a
simulated PLC that publishes the twin's machines on both protocols for commissioning tests."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.connectors.modbus.client import RegisterSpec, read_registers
from backend.connectors.opcua.client import browse_variables, read_values
from backend.connectors.simulated_plc import PlcMachine, plc

router = APIRouter(prefix="/field", tags=["Field connectors"])


def _endpoint_ok(endpoint: str) -> str:
    if not endpoint.startswith("opc.tcp://") or len(endpoint) > 200:
        raise HTTPException(400, "The endpoint must look like opc.tcp://host:port/path")
    return endpoint


class BrowseIn(BaseModel):
    endpoint: str


class ReadOpcUaIn(BaseModel):
    endpoint: str
    nodeIds: list[str] = Field(min_length=1, max_length=200)


class ReadModbusIn(BaseModel):
    host: str = Field(min_length=1, max_length=120)
    port: int = Field(default=502, ge=1, le=65535)
    unit: int = Field(default=1, ge=0, le=247)
    registers: list[RegisterSpec] = Field(min_length=1, max_length=200)


class LinkRead(BaseModel):
    id: str
    protocol: Literal["opcua", "modbus"]
    endpoint: str
    address: str
    scale: float = 1.0


class ReadLinksIn(BaseModel):
    links: list[LinkRead] = Field(max_length=300)


class PlcStartIn(BaseModel):
    machines: list[PlcMachine] = Field(min_length=1, max_length=60)


@router.post("/opcua/browse")
async def opcua_browse(body: BrowseIn) -> dict[str, Any]:
    try:
        return {"endpoint": body.endpoint, "variables": await browse_variables(_endpoint_ok(body.endpoint))}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Couldn't browse {body.endpoint}: {e}") from e


@router.post("/opcua/read")
async def opcua_read(body: ReadOpcUaIn) -> dict[str, Any]:
    try:
        return {"values": await read_values(_endpoint_ok(body.endpoint), body.nodeIds)}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Couldn't read {body.endpoint}: {e}") from e


@router.post("/modbus/read")
async def modbus_read(body: ReadModbusIn) -> dict[str, Any]:
    try:
        return {"values": await read_registers(body.host, body.port, body.unit, body.registers)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Couldn't read {body.host}:{body.port}: {e}") from e


def _modbus_address(address: str) -> tuple[str, int, int, RegisterSpec]:
    """`host:port/unit/table/address`, e.g. 127.0.0.1:5021/1/holding/12."""
    hostport, unit, table, reg = address.split("/")
    host, port = hostport.rsplit(":", 1)
    return host, int(port), int(unit), RegisterSpec(address=int(reg), table=table)  # type: ignore[arg-type]


@router.post("/links/read")
async def read_links(body: ReadLinksIn) -> dict[str, Any]:
    """Read every linked field tag, grouped per server so each is contacted once."""
    out: dict[str, dict[str, Any]] = {}
    opc: dict[str, list[LinkRead]] = {}
    mb: dict[tuple[str, int, int], list[tuple[LinkRead, RegisterSpec]]] = {}
    for link in body.links:
        if link.protocol == "opcua":
            opc.setdefault(link.endpoint, []).append(link)
        else:
            try:
                host, port, unit, spec = _modbus_address(link.address)
                spec.scale = link.scale
                mb.setdefault((host, port, unit), []).append((link, spec))
            except Exception:  # noqa: BLE001
                out[link.id] = {"value": None, "quality": "BAD", "error": "bad Modbus address"}
    for endpoint, links in opc.items():
        try:
            values = await read_values(_endpoint_ok(endpoint), [lk.address for lk in links])
            for lk in links:
                v = values.get(lk.address, {"value": None, "quality": "BAD"})
                val = v["value"]
                out[lk.id] = {**v, "value": round(val * lk.scale, 4) if isinstance(val, (int, float)) and not isinstance(val, bool) else val}
        except Exception as e:  # noqa: BLE001
            for lk in links:
                out[lk.id] = {"value": None, "quality": "BAD", "error": str(e)[:120]}
    for (host, port, unit), pairs in mb.items():
        try:
            values = await read_registers(host, port, unit, [s for _, s in pairs])
            for (lk, _), v in zip(pairs, values):
                out[lk.id] = {"value": v["value"], "quality": v["quality"]}
        except Exception as e:  # noqa: BLE001
            for lk, _ in pairs:
                out[lk.id] = {"value": None, "quality": "BAD", "error": str(e)[:120]}
    return {"values": out}


@router.get("/plc")
async def plc_status() -> dict[str, Any]:
    return plc.status()


@router.post("/plc/start")
async def plc_start(body: PlcStartIn) -> dict[str, Any]:
    try:
        await plc.start(body.machines)
    except OSError as e:
        await plc.stop()
        raise HTTPException(409, f"Couldn't open the simulated PLC ports ({plc.opcua_port}, {plc.modbus_port}): {e}") from e
    return plc.status()


@router.post("/plc/update")
async def plc_update(body: PlcStartIn) -> dict[str, Any]:
    if not plc.running:
        raise HTTPException(409, "The simulated PLC is not running.")
    plc.update(body.machines)
    return plc.status()


@router.post("/plc/stop")
async def plc_stop() -> dict[str, Any]:
    await plc.stop()
    return plc.status()
