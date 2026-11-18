import { describe, expect, it } from "vitest";
import { aasEnvironment, idShort } from "@/domain/aas";
import { injectFault } from "@/domain/commands";
import { maintenanceGuide, signMaintenanceStep } from "@/domain/guided-maintenance";
import { isoModelFromState, layoutIso } from "@/domain/layout";
import { activeAlarms, assetSignals, lineFlow, lineOutput } from "@/domain/live";
import { advanceFactory } from "@/domain/telemetry";
import type { FactoryState } from "@/domain/types";
import { alignToLine } from "@/components/playground/model";
import { crisis, demo, NOW } from "./helpers";

function withWorkOrder(s: FactoryState, assetId: string) {
  s.workOrders.unshift({ id: "WO-TEST", assetId, type: "preventive", status: "scheduled", startHour: s.clock.hour + 1, durationHours: 6, reason: "test", cost: 1000 });
  return s;
}

describe("live operating view", () => {
  it("line flow follows the slowest running machine and is 0 when a line stops", () => {
    const s = demo();
    const line = s.lines[0];
    const flow = lineFlow(s, line.id);
    expect(flow).toBeGreaterThan(0);
    expect(flow).toBeLessThanOrEqual(1.3);
    injectFault(s, { assetId: line.assetIds[0], mode: "failure", severity: 100 }, NOW);
    advanceFactory(s, 0.2, { nowISO: NOW });
    expect(lineFlow(s, line.id)).toBe(0);
  });

  it("exposes a machine's signals with limits and states, and the line's output counter on its last machine", () => {
    const s = demo();
    const a = s.assets[0];
    const sig = assetSignals(s, a);
    const vib = sig.find((x) => x.name === "Vibration")!;
    expect(vib.limits).toEqual({ alarm: a.thresholds.vibrationAlarm, trip: a.thresholds.vibrationTrip });
    expect(sig.find((x) => x.name === "Speed setpoint")!.command).toBe("speed");
    const last = s.assets.find((x) => x.id === s.lines[0].assetIds.at(-1))!;
    const count = assetSignals(s, last).find((x) => x.name === "Line output (8 h)")!;
    expect(count.value).toBe(lineOutput(s, s.lines[0].id));
    expect(lineOutput(s, s.lines[0].id)).toBeGreaterThan(0);
  });

  it("lists open incidents and live limit breaches as alarms, critical first", () => {
    const s = crisis();
    const alarms = activeAlarms(s);
    expect(alarms.length).toBeGreaterThan(0);
    expect(alarms[0].severity).toBe("critical");
    expect(alarms.some((x) => x.source === "incident" && x.assetId === "A-ROB-03")).toBe(true);
  });
});

describe("guided maintenance", () => {
  it("builds an ordered procedure from the machine's failure mode", () => {
    const s = withWorkOrder(crisis(), "A-ROB-03");
    const g = maintenanceGuide(s, "WO-TEST");
    expect(g.steps.map((x) => x.kind)).toEqual(["safety", "safety", "inspect", "repair", "repair", "safety", "verify", "close"]);
    expect(g.steps[0].detail).toMatch(/E-stop|locked/);
    expect(g.nextStepId).toBe("s1");
  });

  it("signs steps in order, records who, and gates the test run on the live limit", () => {
    const s = withWorkOrder(crisis(), "A-ROB-03");
    expect(() => signMaintenanceStep(s, "WO-TEST", "s2", "Asha", NOW)).toThrow(/in order/);
    for (const id of ["s1", "s2", "s3", "s4", "s5", "s6"]) signMaintenanceStep(s, "WO-TEST", id, "Asha", NOW);
    const g = maintenanceGuide(s, "WO-TEST");
    expect(g.progress.done).toBe(6);
    expect(s.workOrders[0].steps?.s1.by).toBe("Asha");
    expect(s.audit.some((e) => e.title === "WO-TEST · Lock out and tag out" && e.actor === "Asha")).toBe(true);
    // The crisis robot still vibrates above its alarm limit: the test run cannot be signed yet.
    const run = g.steps.find((x) => x.id === "s7")!;
    expect(run.check!.pass).toBe(false);
    expect(() => signMaintenanceStep(s, "WO-TEST", "s7", "Asha", NOW)).toThrow(/not yet below/);
    // Repaired: vibration back to baseline, the test run passes and the procedure completes.
    injectFault(s, { assetId: "A-ROB-03", mode: "restore", severity: 0 }, NOW);
    advanceFactory(s, 0.5, { nowISO: NOW });
    const robot = s.assets.find((a) => a.id === "A-ROB-03")!;
    expect(robot.mode).toBe("running");
    expect(robot.signal.vibration).toBeLessThan(robot.thresholds.vibrationAlarm);
    signMaintenanceStep(s, "WO-TEST", "s7", "Asha", NOW);
    signMaintenanceStep(s, "WO-TEST", "s8", "Asha", NOW);
    expect(maintenanceGuide(s, "WO-TEST").nextStepId).toBeNull();
    expect(() => signMaintenanceStep(s, "WO-TEST", "s8", "Asha", NOW)).toThrow(/already signed/);
  });
});

describe("asset administration shell export", () => {
  it("exports one shell per machine with three resolvable submodels and valid idShorts", () => {
    const s = demo();
    const env = aasEnvironment(s);
    expect(env.assetAdministrationShells).toHaveLength(s.assets.length);
    expect(env.submodels).toHaveLength(s.assets.length * 3);
    const ids = new Set(env.submodels.map((m) => m.id));
    for (const shell of env.assetAdministrationShells) {
      expect(shell.idShort).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
      for (const ref of shell.submodels) expect(ids.has(ref.keys[0].value)).toBe(true);
    }
    for (const sm of env.submodels) for (const p of sm.submodelElements) expect(p.idShort).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
    const op = env.submodels.find((m) => m.idShort === "OperationalData")!;
    expect(op.submodelElements.find((p) => p.idShort === "Vibration")!.valueType).toBe("xs:double");
    expect(aasEnvironment(s, [s.assets[0].id]).assetAdministrationShells).toHaveLength(1);
    expect(idShort("3-axis cnc")).toBe("A_3_axis_cnc");
  });
});

describe("snap-to-line in the playground", () => {
  it("locks a dragged machine onto its line's axis and standard spacing when close, not when far", () => {
    const layout = layoutIso(isoModelFromState(demo()));
    const line = layout.machines.filter((m) => m.lineId === layout.machines[0].lineId);
    const pm = line[1];
    const near = alignToLine(layout, pm.m.id, pm.x + 0.1, pm.y + 0.3);
    expect(near.y).toBe(pm.y);
    expect(near.guide).not.toBeNull();
    const far = alignToLine(layout, pm.m.id, pm.x, pm.y + 3);
    expect(far.y).toBe(pm.y + 3);
  });
});
