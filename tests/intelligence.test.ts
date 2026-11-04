import { describe, expect, it } from "vitest";
import { approveRecommendation, rollbackRecommendation } from "@/domain/actions";
import { enrichReport } from "@/domain/agents/external";
import { buildTwinSnapshot, type MaintenanceAssetInsight, type SupplyItemInsight } from "@/domain/intelligence";
import { proposePreventiveMaintenance, proposePurchaseOrder } from "@/domain/intelligence-actions";
import { consumptionPerHour } from "@/domain/kpis";
import type { AgentReport } from "@/domain/types";
import { crisis, NOW } from "./helpers";

const maintenanceInsight = (assetId: string): MaintenanceAssetInsight => ({
  assetId,
  name: assetId,
  lineId: "L1",
  kind: "robot",
  criticality: "A",
  status: "running",
  risk: "high",
  vibration: 6.4,
  temperature: 71,
  healthScore: 0.31,
  isoZone: "ZONE_C_UNSATISFACTORY",
  hoursToTrip: 5.2,
  tripHour: 60,
  degradationPerHour: 0.13,
  confidence: 0.92,
  tripImminent: true,
  recommendedAction: "IMMEDIATE_MAINTENANCE_REQUIRED: Schedule preventive overhaul to avoid line trip.",
  limits: { alarm: 4.5, trip: 7.1 },
});

function supplyInsight(s: ReturnType<typeof crisis>): SupplyItemInsight {
  const item = s.inventory[0];
  return {
    itemId: item.id,
    name: item.name,
    unit: item.unit,
    category: item.category,
    supplier: item.supplier,
    onHand: item.onHand,
    reorderPoint: item.reorderPoint,
    consumptionPerHour: 40,
    daysOfSupply: 1.2,
    runwayHours: 30,
    leadTimeHours: 72,
    inboundQty: 0,
    nextInboundHour: null,
    atRisk: true,
    usedBy: [{ lineId: s.lines[0].id, productId: s.products[0].id, qty: 1 }],
    unitCost: 5,
    purchaseOrder: { qty: 3000, supplier: item.supplier, etaInHours: 72, cost: 15000, urgency: "CRITICAL" },
    expediteNeeded: false,
  };
}

describe("intelligence features on the twin", () => {
  it("builds a snapshot with only what the enabled features need", () => {
    const s = crisis();
    const none = buildTwinSnapshot(s, []);
    expect(none.assets).toEqual([]);
    expect(none.items).toEqual([]);
    const all = buildTwinSnapshot(s, ["maintenance", "supply", "demand", "vision"]);
    expect(all.facilityId).toBe(s.profile.id);
    expect(all.assets).toHaveLength(s.assets.length);
    const rob = all.assets.find((a) => a.id === "A-ROB-03")!;
    expect(rob.history.length).toBeGreaterThan(10);
    expect(rob.history.length).toBeLessThanOrEqual(60);
    expect(rob.vibrationTrip).toBe(s.assets.find((a) => a.id === "A-ROB-03")!.thresholds.vibrationTrip);
    const item = all.items[0];
    expect(item.consumptionPerHour).toBe(consumptionPerHour(s, item.id));
    expect(item.usedBy.length).toBeGreaterThan(0);
    expect(all.cameras.every((c) => c.kind === "inspection")).toBe(true);
    expect(all.orders.every((o) => o.quantity >= o.fulfilled)).toBe(true);
  });

  it("adds a sourced backend finding to the agent's report, and nothing without insights", () => {
    const s = crisis();
    const report: AgentReport = {
      agentId: "maintenance", status: "complete", summary: "", inputs: [], method: "", findings: [], proposals: [], metrics: [],
      confidence: { level: "high", score: 0.9, rationale: "" }, affectedAssetIds: ["A-ROB-03"], durationMs: 1,
    };
    expect(enrichReport("maintenance", report, undefined, s)).toBe(report);
    const insights = { maintenance: { feature: "maintenance" as const, simHour: 1, engine: "test", assets: [maintenanceInsight("A-ROB-03")], counts: { high: 1, medium: 0, low: 0 }, preventiveCost: 3920, unplannedCost: 24000, imminentHours: 24, zoneMix: {} } };
    const out = enrichReport("maintenance", report, insights, s);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe("critical");
    expect(out.findings[0].evidence.some((e) => e.source === "Intelligence backend")).toBe(true);
    expect(enrichReport("energy", report, insights, s)).toBe(report);
  });

  it("proposes preventive maintenance as a pending recommendation from the twin's own simulation", () => {
    const s = crisis();
    const rec = proposePreventiveMaintenance(s, maintenanceInsight("A-ROB-03"), NOW, "Planner");
    expect(rec.status).toBe("pending");
    expect(rec.source).toBe("intelligence");
    expect(rec.scenarioId).toBe("preventive");
    expect(rec.actions.some((a) => a.type === "schedule-maintenance")).toBe(true);
    expect(rec.evidence.some((e) => e.label === "Remaining useful life")).toBe(true);
    expect(() => proposePreventiveMaintenance(s, maintenanceInsight("A-ROB-03"), NOW, "Planner")).toThrow(/already proposes/);
    expect(() => proposePreventiveMaintenance(s, { ...maintenanceInsight("A-ROB-03"), risk: "low" }, NOW, "Planner")).toThrow(/low risk/);
  });

  it("a purchase order adds an inbound delivery on approval, is cancelled on rollback, and never supersedes machine plans", () => {
    const s = crisis();
    const maint = proposePreventiveMaintenance(s, maintenanceInsight("A-ROB-03"), NOW, "Planner");
    const ins = supplyInsight(s);
    const po = proposePurchaseOrder(s, ins, NOW, "Planner");
    expect(po.status).toBe("pending");
    expect(s.recommendations.find((r) => r.id === maint.id)!.status).toBe("pending");
    expect(() => proposePurchaseOrder(s, ins, NOW, "Planner")).toThrow(/already proposes/);

    const item = s.inventory.find((i) => i.id === ins.itemId)!;
    const before = item.inbound.length;
    approveRecommendation(s, po.id, "Planner", "", NOW);
    expect(item.inbound).toHaveLength(before + 1);
    const added = item.inbound.find((b) => b.poId === po.actions[0].params.poId)!;
    expect(added.qty).toBe(3000);
    expect(added.etaHour).toBeCloseTo(s.clock.hour + 72, 3);
    expect(s.recommendations.find((r) => r.id === maint.id)!.status).toBe("pending");

    rollbackRecommendation(s, po.id, "Planner", NOW);
    expect(item.inbound).toHaveLength(before);
    expect(s.recommendations.find((r) => r.id === po.id)!.status).toBe("rolled-back");
  });
});
