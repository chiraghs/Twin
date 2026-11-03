import { describe, expect, it } from "vitest";
import { approveRecommendation, DomainError, rejectRecommendation, rollbackRecommendation } from "@/domain/actions";
import { commitAnalysis, runAnalysisPipeline, type PipelineEvent } from "@/domain/agents/pipeline";
import { detectAnomalies } from "@/domain/anomaly";
import { addAsset, connectNodes, fastForward, injectFault, updateAsset } from "@/domain/commands";
import { classifyStatus, computeHealthScore } from "@/domain/health";
import { computeKpis } from "@/domain/kpis";
import { linearFit } from "@/domain/math";
import { buildDemoFactory, buildFactory, DEMO_BLUEPRINT } from "@/domain/seed";
import { advanceFactory, estimateTrend, readingsFor } from "@/domain/telemetry";
import type { FactoryState } from "@/domain/types";
import { ANCHOR, crisis, demo, NOW } from "./helpers";

async function analyse(state: FactoryState) {
  const events: PipelineEvent[] = [];
  const gen = runAnalysisPipeline(structuredClone(state), { nowISO: () => NOW, pace: async () => {} });
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, bundle: step.value };
}

describe("seeded demo factory", () => {
  it("is fully reproducible", () => {
    expect(JSON.stringify(buildDemoFactory(ANCHOR))).toBe(JSON.stringify(buildDemoFactory(ANCHOR)));
  });

  it("has the required entities and history", () => {
    const s = demo();
    expect(s.lines.map((l) => l.name)).toEqual(["Assembly Line A", "Assembly Line B", "Packaging Line C"]);
    expect(s.assets.length).toBeGreaterThanOrEqual(12);
    expect(Object.values(s.telemetry).reduce((n, r) => n + r.length, 0)).toBeGreaterThan(500);
    expect(s.production.length).toBeGreaterThanOrEqual(24 * 3);
    expect(s.orders.length).toBeGreaterThanOrEqual(3);
    expect(s.inventory.find((i) => i.id === "MCU-7")!.inbound.length).toBe(1);
    expect(s.incidents.filter((i) => i.status === "open")).toHaveLength(1);
    expect(s.maintenanceHistory.length).toBeGreaterThan(30);
  });

  it("starts with A-ROB-03 degrading (warning) and everything else healthy", () => {
    const s = demo();
    const rob = s.assets.find((a) => a.id === "A-ROB-03")!;
    expect(rob.status).toBe("warning");
    expect(s.assets.filter((a) => a.id !== "A-ROB-03").every((a) => a.status === "healthy")).toBe(true);
  });

  it("builds parametric custom factories", () => {
    const s = buildFactory({ ...DEMO_BLUEPRINT, name: "Test", assemblyLines: 3, assetKinds: ["robot", "camera"], isDemo: false, seedIncident: false }, ANCHOR, 42);
    expect(s.lines).toHaveLength(4);
    expect(s.lines[3].kind).toBe("packaging");
    expect(s.assets).toHaveLength(3 * 2 + 4);
    expect(s.incidents).toHaveLength(0);
  });
});

describe("health & telemetry analytics", () => {
  it("linear fit recovers slope and intercept", () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const fit = linearFit(xs, xs.map((x) => 2 + 0.5 * x));
    expect(fit.slope).toBeCloseTo(0.5, 6);
    expect(fit.intercept).toBeCloseTo(2, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
  });

  it("health score falls monotonically with vibration and status follows thresholds", () => {
    const base = { vibration: 2.6, temperature: 56 };
    const th = { vibrationAlarm: 7.1, vibrationTrip: 11.2, temperatureAlarm: 85, temperatureTrip: 95 };
    const scores = [2.6, 4, 6, 8, 10].map((v) => computeHealthScore(v, 56, base, th));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
    expect(classifyStatus("running", 2.7, 56, 99, th)).toBe("healthy");
    expect(classifyStatus("running", 7.5, 60, 60, th)).toBe("critical");
    expect(classifyStatus("down", 0, 0, 0, th)).toBe("offline");
    expect(classifyStatus("maintenance", 0, 0, 0, th)).toBe("maintenance");
  });

  it("detects the seeded vibration trend on A-ROB-03 only", () => {
    const s = demo();
    const t = estimateTrend(readingsFor(s, "A-ROB-03"), "vibration", 2.6);
    expect(t.significant).toBe(true);
    expect(t.slopePerHour).toBeGreaterThan(0.15);
    const healthy = estimateTrend(readingsFor(s, "A-CAM-04"), "vibration", s.assets.find((a) => a.id === "A-CAM-04")!.baseline.vibration);
    expect(healthy.significant).toBe(false);
  });

  it("detects an injected step change and escalates the asset to critical with an incident", () => {
    const s = crisis();
    const rob = s.assets.find((a) => a.id === "A-ROB-03")!;
    expect(rob.status).toBe("critical");
    const t = estimateTrend(readingsFor(s, "A-ROB-03"), "vibration", rob.baseline.vibration);
    expect(t.stepChange.detected).toBe(true);
    expect(t.stepChange.size).toBeGreaterThan(1);
    const { anomalies } = detectAnomalies(s);
    expect(anomalies[0].assetId).toBe("A-ROB-03");
    expect(anomalies.some((a) => a.kind === "step")).toBe(true);
    expect(s.incidents.find((i) => i.assetId === "A-ROB-03")!.severity).toBe("critical");
  });

  it("KPIs are derived from shared state", () => {
    const k = computeKpis(demo());
    expect(k.oee.oee).toBeGreaterThan(0.7);
    expect(k.oee.oee).toBeLessThan(0.95);
    expect(k.output.actual).toBeGreaterThan(0);
    expect(k.health.distribution.warning).toBe(1);
    expect(k.incidents.open).toBe(1);
  });
});

describe("agent pipeline", () => {
  it("runs every stage in order and produces evidence-based findings and a pending recommendation", async () => {
    const s = crisis();
    const { events, bundle } = await analyse(s);
    const stageOrder = events.filter((e) => e.type === "stage" && e.status === "running").map((e) => (e as { stage: string }).stage);
    expect(stageOrder).toEqual(["observe", "investigate", "predict", "simulate", "recommend"]);
    expect(events.some((e) => e.type === "stage" && e.stage === "approval" && e.status === "waiting")).toBe(true);
    const a = bundle.analysis;
    expect(a.focusAssetId).toBe("A-ROB-03");
    for (const id of ["maintenance", "quality", "production", "supply", "energy", "orchestrator"] as const) {
      const r = a.reports[id]!;
      expect(r.findings.length).toBeGreaterThan(0);
      expect(r.inputs.length).toBeGreaterThan(0);
      expect(r.method.length).toBeGreaterThan(20);
    }
    expect(a.reports.maintenance!.findings[0].evidence.length).toBeGreaterThanOrEqual(5);
    expect(a.reports.maintenance!.findings[0].assetIds).toContain("A-ROB-03");
    expect(bundle.scenarioRun!.recommendedId).toBe("reroute");
    expect(bundle.recommendation!.status).toBe("pending");
    expect(bundle.recommendation!.actions.map((x) => x.type)).toEqual(["reroute-production", "schedule-maintenance"]);
    expect(a.narrative!.source).toBe("deterministic");
  });

  it("commits results into the live state with audit entries", async () => {
    const s = crisis();
    const { bundle } = await analyse(s);
    const before = s.audit.length;
    commitAnalysis(s, bundle, NOW);
    expect(s.analyses).toHaveLength(1);
    expect(s.recommendations[0].id).toBe(bundle.recommendation!.id);
    expect(s.incidents.find((i) => i.assetId === "A-ROB-03")!.status).toBe("investigating");
    expect(s.audit.length).toBeGreaterThan(before + 5);
  });
});

describe("approval, execution and rollback", () => {
  async function withRecommendation() {
    const s = crisis();
    const { bundle } = await analyse(s);
    commitAnalysis(s, bundle, NOW);
    return { s, id: bundle.recommendation!.id };
  }

  it("approval applies directives, which the plant model executes to completion", async () => {
    const { s, id } = await withRecommendation();
    approveRecommendation(s, id, "Tester", "ok", NOW);
    expect(s.directives.filter((d) => d.recommendationId === id)).toHaveLength(2);
    expect(s.workOrders[0].status).toBe("scheduled");
    expect(s.incidents.find((i) => i.assetId === "A-ROB-03")!.status).toBe("mitigating");
    advanceFactory(s, 2, { nowISO: NOW });
    expect(s.assets.find((a) => a.id === "A-ROB-03")!.mode).toBe("maintenance");
    expect(s.lines.find((l) => l.id === "LINE-B")!.allocation["ECU-200"]).toBe(1);
    fastForward(s, 8, NOW);
    const rob = s.assets.find((a) => a.id === "A-ROB-03")!;
    expect(rob.mode).toBe("running");
    expect(rob.status).toBe("healthy");
    expect(rob.healthScore).toBeGreaterThan(90);
    expect(s.lines.find((l) => l.id === "LINE-B")!.allocation["SH-40"]).toBe(1);
    expect(s.workOrders[0].status).toBe("completed");
    expect(s.incidents.find((i) => i.assetId === "A-ROB-03")!.status).toBe("resolved");
    expect(s.audit.some((e) => e.category === "approval")).toBe(true);
    expect(s.audit.some((e) => e.title.includes("returned to service"))).toBe(true);
  });

  it("rejection records the decision without changing the factory", async () => {
    const { s, id } = await withRecommendation();
    rejectRecommendation(s, id, "Tester", "not now", NOW);
    expect(s.directives).toHaveLength(0);
    expect(s.recommendations[0].status).toBe("rejected");
    expect(s.audit[0].category).toBe("rejection");
  });

  it("only pending recommendations can be decided", async () => {
    const { s, id } = await withRecommendation();
    approveRecommendation(s, id, "Tester", "", NOW);
    expect(() => approveRecommendation(s, id, "Tester", "", NOW)).toThrow(DomainError);
  });

  it("rollback cancels scheduled directives and reverts active allocations", async () => {
    const { s, id } = await withRecommendation();
    approveRecommendation(s, id, "Tester", "", NOW);
    advanceFactory(s, 0.2, { nowISO: NOW });
    rollbackRecommendation(s, id, "Tester", NOW);
    const dirs = s.directives.filter((d) => d.recommendationId === id);
    expect(dirs.every((d) => d.status === "cancelled")).toBe(true);
    expect(s.lines.find((l) => l.id === "LINE-B")!.allocation["SH-40"]).toBe(1);
    expect(s.workOrders[0].status).toBe("cancelled");
  });
});

describe("commands", () => {
  it("adds an asset into the line flow and validates edits", () => {
    const s = demo();
    const a = addAsset(s, { lineId: "LINE-A", kind: "camera", position: 2 }, NOW);
    expect(s.lines[0].assetIds[2]).toBe(a.id);
    advanceFactory(s, 0.5, { nowISO: NOW });
    expect(s.telemetry[a.id].length).toBeGreaterThan(0);
    updateAsset(s, a.id, { name: "Secondary AOI", speedPct: 90 }, NOW);
    expect(s.assets.find((x) => x.id === a.id)!.name).toBe("Secondary AOI");
    expect(() => updateAsset(s, a.id, { speedPct: 500 }, NOW)).toThrow(DomainError);
  });

  it("records user-defined connections and rejects unknown nodes", () => {
    const s = demo();
    connectNodes(s, "inv:MCU-7", "B-ROB-03", NOW);
    expect(s.connections).toHaveLength(1);
    expect(() => connectNodes(s, "nope", "B-ROB-03", NOW)).toThrow(DomainError);
  });

  it("a forced trip takes the asset offline, stops its line and opens a critical incident", () => {
    const s = demo();
    injectFault(s, { assetId: "B-PRS-02", mode: "failure", severity: 50 }, NOW);
    const p = s.assets.find((a) => a.id === "B-PRS-02")!;
    expect(p.status).toBe("offline");
    expect(s.lines.find((l) => l.id === "LINE-B")!.state).toBe("down");
    expect(s.incidents.some((i) => i.assetId === "B-PRS-02")).toBe(true);
  });
});
