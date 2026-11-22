import { describe, expect, it } from "vitest";
import { injectFault } from "@/domain/commands";
import { amrFleet } from "@/domain/intralogistics";
import { activeAlarms, assetSignals } from "@/domain/live";
import { bottlenecks, cycleTime, electrical, machineStates, MACHINE_STATE_CODE, partCounts, processValues, remainingLife, robotBatteries, throughputExplanation, zoneEnvironment } from "@/domain/process-signals";
import { advanceFactory } from "@/domain/telemetry";
import { crisis, demo, NOW } from "./helpers";

describe("process signals", () => {
  it("names the line constraint: the machine closest to its own capacity", () => {
    const s = demo();
    const st = machineStates(s);
    expect(st["A-ROB-03"]).toMatchObject({ state: "running", bottleneck: true });
    expect(st["A-CNV-01"].reason).toMatch(/paced by Assembly Robot A3/);
    expect(bottlenecks(s).find((b) => b.lineId === "LINE-A")!.assetId).toBe("A-ROB-03");
    expect(throughputExplanation(s, "LINE-A")).toMatch(/A-ROB-03.*constraint/);
  });

  it("a tripped machine blocks the machines before it and starves the ones after it", () => {
    const s = demo();
    const ids = s.lines[0].assetIds;
    injectFault(s, { assetId: ids[2], mode: "failure", severity: 100 }, NOW);
    advanceFactory(s, 0.3, { nowISO: NOW });
    const st = machineStates(s);
    expect(st[ids[2]].state).toBe("fault");
    expect(st[ids[0]].state).toBe("blocked");
    expect(st[ids[1]].reason).toMatch(/downstream is down/);
    expect(st[ids[3]].state).toBe("starved");
    expect(assetSignals(s, s.assets.find((a) => a.id === ids[0])!).find((x) => x.name === "Machine state")).toMatchObject({ value: MACHINE_STATE_CODE.blocked, text: "blocked", state: "alarm" });
  });

  it("electrical values are physically consistent with power", () => {
    const s = demo();
    for (const a of s.assets) {
      const e = electrical(s, a);
      expect(e.voltageV).toBeGreaterThan(390);
      expect(e.voltageV).toBeLessThan(410);
      expect(e.powerFactor).toBeGreaterThanOrEqual(0.5);
      expect(e.powerFactor).toBeLessThanOrEqual(0.95);
      // P = √3 · V · I · PF
      expect((Math.sqrt(3) * e.voltageV * e.currentA * e.powerFactor) / 1000).toBeCloseTo(a.signal.powerKw, 0);
    }
  });

  it("process values follow the machine type, and cycle time follows throughput", () => {
    const s = demo();
    const press = s.assets.find((a) => a.kind === "press")!;
    expect(processValues(s, press).map((p) => p.key)).toEqual(["Pressure", "ToolWear"]);
    const camera = s.assets.find((a) => a.kind === "camera")!;
    expect(processValues(s, camera)).toEqual([]);
    const ct = cycleTime(press);
    expect(ct.idealS).toBeCloseTo(3600 / press.nominalRate, 1);
    expect(ct.actualS).toBeCloseTo(3600 / press.signal.throughput, 1);
  });

  it("predicts remaining useful life only for a machine that is wearing", () => {
    const s = crisis();
    const worn = remainingLife(s, s.assets.find((a) => a.id === "A-ROB-03")!);
    expect(worn.hoursToTrip).not.toBeNull();
    expect(worn.hoursToTrip!).toBeLessThan(48);
    expect(worn.tone).toBe("bad");
    expect(worn.summary).toMatch(/Predicted trip in/);
    const healthy = remainingLife(s, s.assets.find((a) => a.id === "B-PRS-02")!);
    expect(healthy.hoursToTrip).toBeNull();
    expect(healthy.summary).toMatch(/No wear trend/);
  });

  it("counts good and rejected units and attributes rejects to the machine that caused them", () => {
    const s = crisis();
    const pc = partCounts(s);
    expect(pc.lines["LINE-A"].good).toBeGreaterThan(0);
    expect(pc.byMachine["A-ROB-03"]).toBeGreaterThan(0);
  });

  it("zone environment and robot batteries stay in plausible ranges", () => {
    const s = demo();
    for (const z of zoneEnvironment(s)) {
      expect(z.noiseDb).toBeGreaterThan(60);
      expect(z.noiseDb).toBeLessThan(100);
      expect(z.humidityPct).toBeGreaterThanOrEqual(25);
    }
    const b = robotBatteries(s, amrFleet(s));
    expect(b.length).toBeGreaterThan(0);
    for (const x of b) expect(x.pct).toBeGreaterThanOrEqual(0);
  });

  it("derived process values never raise alarms on their own", () => {
    const s = crisis();
    const derived = new Set(assetSignals(s, s.assets[0]).filter((x) => x.group).map((x) => x.name));
    for (const al of activeAlarms(s)) for (const n of derived) expect(al.title).not.toContain(n.toLowerCase());
  });
});
