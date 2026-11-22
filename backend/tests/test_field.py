"""Field connectors: the simulated PLC publishes the same tags over OPC UA and Modbus TCP, and the
read-only clients browse and read them back."""
import pytest

from backend.connectors.modbus.client import RegisterSpec, read_registers
from backend.connectors.opcua.client import browse_variables, read_values
from backend.connectors.simulated_plc import PlcMachine, SimulatedPlc, modbus_map


@pytest.mark.asyncio
async def test_simulated_plc_over_opcua_and_modbus():
    plc = SimulatedPlc(opcua_port=48411, modbus_port=50211)
    machines = [
        PlcMachine(assetId="A-ROB-03", speedPct=80, vibration=6.0, temperature=68.5, throughput=96, running=True, powerKw=8.4, currentA=14.6, cycleTimeS=37.5, state=0),
        PlcMachine(assetId="A-PRS-02", speedPct=100, vibration=1.5, temperature=40, throughput=120, running=False, state=3),
    ]
    await plc.start(machines)
    try:
        variables = await browse_variables(plc.opcua_endpoint)
        paths = {v["path"]: v for v in variables}
        assert "PLC1.A-ROB-03.Vibration" in paths
        assert len([p for p in paths if p.startswith("PLC1.")]) == 18
        assert paths["PLC1.A-PRS-02.State"]["value"] == 3
        vib = paths["PLC1.A-ROB-03.Vibration"]
        assert 5.0 < vib["value"] < 7.0
        read = await read_values(plc.opcua_endpoint, [vib["nodeId"], "ns=2;s=PLC1.NOPE"])
        assert read[vib["nodeId"]]["quality"] == "GOOD"
        assert read["ns=2;s=PLC1.NOPE"]["quality"] == "BAD"

        rows = {r["tag"]: r for r in modbus_map(machines)}
        specs = [
            RegisterSpec(address=rows["A-ROB-03.SpeedSetpoint"]["address"], scale=1.0),
            RegisterSpec(address=rows["A-ROB-03.Temperature"]["address"], scale=0.1),
            RegisterSpec(address=rows["A-PRS-02.Running"]["address"]),
            RegisterSpec(address=rows["A-ROB-03.Running"]["address"]),
            RegisterSpec(address=rows["A-ROB-03.Current"]["address"], scale=0.1),
            RegisterSpec(address=rows["A-PRS-02.State"]["address"]),
        ]
        values = await read_registers("127.0.0.1", 50211, 1, specs)
        assert values[0]["value"] == 80
        assert 66 < values[1]["value"] < 71
        assert values[2]["value"] == 0
        assert values[3]["value"] == 1
        assert 13.5 < values[4]["value"] < 15.5
        assert values[5]["value"] == 3
    finally:
        await plc.stop()
    assert not plc.running
