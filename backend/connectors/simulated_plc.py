"""A simulated PLC for commissioning without hardware: one OPC UA server and one Modbus TCP server
publishing the same tags. Values follow the twin's machines (sent when the PLC is started) with
noise, so field values can be linked to twin signals and compared.

OPC UA:  opc.tcp://127.0.0.1:<opcua_port>/twin-plc/  →  Objects/PLC1/<asset>/<Signal>
Modbus:  127.0.0.1:<modbus_port>, unit 1. Read-only holding registers, from machine index × 10:
         +0 speed % (×1), +1 vibration mm/s (×0.01), +2 temperature °C (×0.1), +3 throughput u/h (×1),
         +4 running (0 / 1).
"""
from __future__ import annotations

import asyncio
import math
import random
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

from backend.core.telemetry.logger import get_logger

logger = get_logger("connectors.simulated_plc")


class PlcMachine(BaseModel):
    assetId: str = Field(min_length=1, max_length=40)
    speedPct: float = 100
    vibration: float = 2.0
    temperature: float = 45.0
    throughput: float = 100
    running: bool = True


SIGNALS = ("SpeedSetpoint", "Vibration", "Temperature", "Throughput", "Running")
MODBUS_LAYOUT = {"SpeedSetpoint": (0, 1.0), "Vibration": (1, 0.01), "Temperature": (2, 0.1), "Throughput": (3, 1.0), "Running": (4, 1.0)}


def modbus_map(machines: list[PlcMachine]) -> list[dict[str, Any]]:
    """Where each signal lives in the Modbus tables."""
    out: list[dict[str, Any]] = []
    for i, m in enumerate(machines):
        base = i * 10
        for sig, (off, scale) in MODBUS_LAYOUT.items():
            out.append({"tag": f"{m.assetId}.{sig}", "table": "holding", "address": base + off, "scale": scale})
    return out


@dataclass
class SimulatedPlc:
    opcua_port: int = 4841
    modbus_port: int = 5021
    machines: list[PlcMachine] = field(default_factory=list)
    _opc: Any = None
    _opc_nodes: dict[str, Any] = field(default_factory=dict)
    _modbus: Any = None
    _modbus_task: asyncio.Task | None = None
    _regs: dict[int, int] = field(default_factory=dict)
    _loop_task: asyncio.Task | None = None
    _t: float = 0.0

    @property
    def running(self) -> bool:
        return self._loop_task is not None and not self._loop_task.done()

    @property
    def opcua_endpoint(self) -> str:
        return f"opc.tcp://127.0.0.1:{self.opcua_port}/twin-plc/"

    def values(self) -> dict[str, float | bool]:
        """Current field values (twin values with sensor noise and a slow drift)."""
        out: dict[str, float | bool] = {}
        for i, m in enumerate(self.machines):
            wobble = math.sin(self._t / 7 + i)
            on = m.running
            out[f"{m.assetId}.SpeedSetpoint"] = round(m.speedPct, 1)
            out[f"{m.assetId}.Vibration"] = round(max(0.0, m.vibration * (1 + 0.04 * wobble) + random.uniform(-0.05, 0.05)), 2) if on else 0.0
            out[f"{m.assetId}.Temperature"] = round(m.temperature + 0.6 * wobble + random.uniform(-0.2, 0.2), 1)
            out[f"{m.assetId}.Throughput"] = round(max(0.0, m.throughput * (1 + 0.02 * wobble)), 1) if on else 0.0
            out[f"{m.assetId}.Running"] = on
        return out

    async def start(self, machines: list[PlcMachine]) -> None:
        await self.stop()
        self.machines = machines
        await self._start_opcua()
        await self._start_modbus()
        await self._publish()
        self._loop_task = asyncio.create_task(self._loop())
        logger.info(f"Simulated PLC started: {self.opcua_endpoint} and modbus 127.0.0.1:{self.modbus_port}")

    def update(self, machines: list[PlcMachine]) -> None:
        """New twin values for machines already on the PLC (tags stay the same)."""
        by_id = {m.assetId: m for m in machines}
        self.machines = [by_id.get(m.assetId, m) for m in self.machines]

    async def stop(self) -> None:
        if self._loop_task:
            self._loop_task.cancel()
            self._loop_task = None
        if self._modbus is not None:
            try:
                await self._modbus.shutdown()
            except Exception:  # noqa: BLE001
                pass
            self._modbus = None
        if self._modbus_task:
            self._modbus_task.cancel()
            self._modbus_task = None
        if self._opc is not None:
            try:
                await self._opc.stop()
            except Exception:  # noqa: BLE001
                pass
            self._opc = None
        self._opc_nodes = {}

    async def _start_opcua(self) -> None:
        from asyncua import Server, ua

        server = Server()
        await server.init()
        server.set_endpoint(self.opcua_endpoint)
        # Local simulation only: plain endpoint, no certificates.
        server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
        server.set_server_name("Twin simulated PLC")
        ns = await server.register_namespace("urn:twin:simulated-plc")
        plc = await server.nodes.objects.add_object(ns, "PLC1")
        values = self.values()
        for m in self.machines:
            obj = await plc.add_object(ns, m.assetId)
            for sig in SIGNALS:
                tag = f"{m.assetId}.{sig}"
                node = await obj.add_variable(f"ns={ns};s=PLC1.{tag}", sig, values[tag])
                self._opc_nodes[tag] = node
        await server.start()
        self._opc = server

    async def _start_modbus(self) -> None:
        from pymodbus.server import ModbusTcpServer
        from pymodbus.simulator import DataType, SimData, SimDevice

        size = max(16, len(self.machines) * 10 + 10)
        regs = self._regs

        async def action(function_code, start_address, address, count, registers, set_values):  # noqa: ANN001
            # Every read sees the latest field values; writes are refused (the twin never writes to a PLC).
            if set_values is not None:
                from pymodbus.constants import ExcCodes

                return ExcCodes.ILLEGAL_FUNCTION
            for i in range(len(registers)):
                registers[i] = regs.get(start_address + i, 0)
            return None

        device = SimDevice(id=1, simdata=[SimData(address=0, count=size, values=0, datatype=DataType.REGISTERS)], action=action)
        self._modbus = ModbusTcpServer(device, address=("127.0.0.1", self.modbus_port))
        self._modbus_task = asyncio.create_task(self._modbus.serve_forever())
        await asyncio.sleep(0.2)

    async def _publish(self) -> None:
        values = self.values()
        for tag, node in self._opc_nodes.items():
            v = values[tag]
            await node.write_value(v if isinstance(v, bool) else float(v))
        for row in modbus_map(self.machines):
            v = values[row["tag"]]
            self._regs[row["address"]] = int(bool(v)) if isinstance(v, bool) else max(0, min(65535, int(round(float(v) / row["scale"]))))

    async def _loop(self) -> None:
        try:
            while True:
                await asyncio.sleep(0.5)
                self._t += 0.5
                await self._publish()
        except asyncio.CancelledError:
            pass

    def status(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "opcuaEndpoint": self.opcua_endpoint if self.running else None,
            "modbus": {"host": "127.0.0.1", "port": self.modbus_port, "unit": 1} if self.running else None,
            "machines": [m.assetId for m in self.machines] if self.running else [],
            "modbusMap": modbus_map(self.machines) if self.running else [],
        }


plc = SimulatedPlc()
