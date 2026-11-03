import { describe, expect, it } from "vitest";
import { presetScenarios, applyShared, defaultAssumptions } from "@/domain/scenarios";
import { calibrateAsset, rankScenarios, simulateScenarios } from "@/domain/simulation";
import type { ScenarioDefinition } from "@/domain/types";
import { crisis, demo } from "./helpers";

const byId = (results: ReturnType<typeof simulateScenarios>, id: string) => results.find((r) => r.definition.id === id)!;
const withParams = (d: ScenarioDefinition, patch: Partial<ScenarioDefinition["params"]>): ScenarioDefinition => ({ ...d, params: { ...d.params, ...patch } });

describe("scenario engine — crisis scenario", () => {
  const state = crisis();
  const defs = presetScenarios(state, "A-ROB-03");
  const results = simulateScenarios(state, defs);

  it("produces a baseline reference and three alternative plans", () => {
    expect(defs.map((d) => d.id)).toEqual(["baseline", "continue", "preventive", "reroute"]);
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.hourly).toHaveLength(48);
      expect(r.assumptions.length).toBeGreaterThan(3);
      expect(r.explanation.length).toBeGreaterThan(0);
    }
  });

  it("reference plan assumes a healthy asset and scores 100", () => {
    const b = byId(results, "baseline");
    expect(b.metrics.failureOccurs).toBe(false);
    expect(b.metrics.lateUnits).toBe(0);
    expect(b.metrics.score).toBe(100);
  });

  it("continuing without intervention predicts a trip, unplanned downtime and late units", () => {
    const c = byId(results, "continue");
    expect(c.metrics.failureOccurs).toBe(true);
    expect(c.metrics.failureHour).toBeGreaterThan(5);
    expect(c.metrics.failureHour).toBeLessThan(24);
    expect(c.metrics.targetUnplannedDowntimeHours).toBeGreaterThan(10);
    expect(c.metrics.lateUnits).toBeGreaterThan(0);
    expect(c.metrics.repairCost).toBeGreaterThan(20000);
    expect(c.timeline.some((e) => e.kind === "failure")).toBe(true);
  });

  it("stopping immediately avoids the trip but makes the critical order late", () => {
    const p = byId(results, "preventive");
    expect(p.metrics.failureOccurs).toBe(false);
    expect(p.metrics.targetPlannedDowntimeHours).toBeCloseTo(6, 0);
    expect(p.metrics.lateUnits).toBeGreaterThan(0);
    expect(p.orders.find((o) => o.orderId === "ORD-1042")!.onTime).toBe(false);
  });

  it("rerouting to Line B and maintaining keeps every due order on time without a trip", () => {
    const r = byId(results, "reroute");
    expect(r.feasible).toBe(true);
    expect(r.metrics.failureOccurs).toBe(false);
    expect(r.metrics.lateUnits).toBe(0);
    expect(r.metrics.changeoverCost).toBeGreaterThan(0);
    expect(r.affectedLineIds).toEqual(expect.arrayContaining(["LINE-A", "LINE-B", "LINE-C"]));
    expect(r.timeline.some((e) => e.kind === "reroute-start")).toBe(true);
  });

  it("ranks reroute first and demotes the plan that runs to failure", () => {
    const ranking = rankScenarios(results);
    expect(ranking[0].scenarioId).toBe("reroute");
    expect(ranking[ranking.length - 1].scenarioId).toBe("continue");
    expect(ranking.find((x) => x.scenarioId === "baseline")).toBeUndefined();
  });

  it("is deterministic: identical inputs give identical outputs", () => {
    const again = simulateScenarios(state, defs);
    expect(JSON.stringify(again)).toBe(JSON.stringify(results));
  });

  it("calibrates condition from telemetry (not hidden state) with a significant upward trend", () => {
    const c = calibrateAsset(state, "A-ROB-03")!;
    expect(c.vibration).toBeGreaterThan(7);
    expect(c.vibrationSlope).toBeGreaterThan(0.1);
    expect(c.r2).toBeGreaterThan(0.5);
    expect(c.hoursToTrip).toBeGreaterThan(5);
  });
});

describe("scenario engine — parameter sensitivity", () => {
  const state = crisis();
  const defs = presetScenarios(state, "A-ROB-03");
  const reroute = defs.find((d) => d.id === "reroute")!;
  const preventive = defs.find((d) => d.id === "preventive")!;
  const cont = defs.find((d) => d.id === "continue")!;
  const run = (d: ScenarioDefinition) => simulateScenarios(state, [defs[0], d])[1];

  it("longer preventive maintenance increases downtime and late units", () => {
    const short = run(preventive);
    const long = run(withParams(preventive, { maintenanceDurationHours: 10 }));
    expect(long.metrics.targetPlannedDowntimeHours).toBeGreaterThan(short.metrics.targetPlannedDowntimeHours);
    expect(long.metrics.lateUnits).toBeGreaterThan(short.metrics.lateUnits);
    expect(long.metrics.maintenanceCost).toBeGreaterThan(short.metrics.maintenanceCost);
  });

  it("derating the degraded asset delays the predicted trip", () => {
    const full = run(cont);
    const derated = run(withParams(cont, { targetSpeedPct: 70 }));
    expect(derated.metrics.failureHour ?? Infinity).toBeGreaterThan(full.metrics.failureHour!);
  });

  it("a longer unplanned repair worsens the no-intervention outcome", () => {
    const a = run(withParams(cont, { unplannedRepairHours: 8 }));
    const b = run(withParams(cont, { unplannedRepairHours: 30 }));
    expect(b.metrics.targetUnplannedDowntimeHours).toBeGreaterThan(a.metrics.targetUnplannedDowntimeHours);
    expect(b.metrics.totalOutput).toBeLessThan(a.metrics.totalOutput);
  });

  it("lower line allocation to the rerouted product reduces delivered critical units", () => {
    const full = run(reroute);
    const partial = run(withParams(reroute, { reroute: { ...reroute.params.reroute, sharePct: 30 } }));
    const ecu = (r: typeof full) => r.hourly[23].cumulativeByProduct["ECU-200"];
    expect(ecu(partial)).toBeLessThan(ecu(full));
    expect(partial.metrics.lateUnits).toBeGreaterThan(full.metrics.lateUnits);
  });

  it("reduced MCU-7 availability creates late units; expediting the PO recovers them", () => {
    const shared = defaultAssumptions(state);
    const [, constrained] = simulateScenarios(state, applyShared([defs[0], reroute], { ...shared, inventoryAvailabilityPct: { "MCU-7": 85 } }));
    expect(constrained.metrics.lateUnits).toBeGreaterThan(0);
    expect(constrained.timeline.some((e) => e.kind === "stockout")).toBe(true);
    const [, expedited] = simulateScenarios(state, applyShared([defs[0], reroute], { ...shared, inventoryAvailabilityPct: { "MCU-7": 85 }, expediteItemIds: ["MCU-7"] }));
    expect(expedited.metrics.lateUnits).toBeLessThan(constrained.metrics.lateUnits);
    expect(expedited.metrics.expediteCost).toBeGreaterThan(0);
  });

  it("order quantity overrides change delivery outcomes", () => {
    const bigger = run(withParams(reroute, { orderOverrides: { "ORD-1042": { quantity: 3400 } } }));
    expect(bigger.metrics.lateUnits).toBeGreaterThan(0);
  });

  it("energy price scales energy cost linearly; idle factor changes idle energy", () => {
    const a = run(withParams(reroute, { energyPricePerKwh: 0.1 }));
    const b = run(withParams(reroute, { energyPricePerKwh: 0.2 }));
    expect(b.metrics.energyCost / a.metrics.energyCost).toBeCloseTo(2, 1);
    const lowIdle = run(withParams(reroute, { idlePowerFactor: 0.4 }));
    expect(lowIdle.metrics.idleEnergyKwh).toBeLessThan(a.metrics.idleEnergyKwh);
  });

  it("the horizon controls simulated hours", () => {
    const r = run(withParams(reroute, { horizonHours: 24 }));
    expect(r.hourly).toHaveLength(24);
  });
});

describe("scenario engine — feasibility", () => {
  it("marks rerouting infeasible for a packaging asset (no qualified alternate line)", () => {
    const state = demo();
    const results = simulateScenarios(state, presetScenarios(state, "C-PKG-02"));
    const r = byId(results, "reroute");
    expect(r.feasible).toBe(false);
    expect(r.metrics.score).toBe(0);
    expect(r.infeasibleReason).toBeTruthy();
  });
});
