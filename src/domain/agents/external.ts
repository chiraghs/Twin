import type { BackendInsights } from "../intelligence";
import type { AgentFinding, AgentId, AgentReport, FactoryState, Severity } from "../types";
import { fmtInt } from "./context";

const SOURCE = "Intelligence backend";
const fmtH = (h: number | null | undefined) => (h == null ? "not trending" : h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h)} h`);

/**
 * Adds the intelligence backend's results for this plant to a specialist's report as a separate,
 * clearly sourced finding. The agent's own analysis is unchanged; nothing is added when the
 * feature is off or has no result yet.
 */
export function enrichReport(agentId: AgentId, report: AgentReport, insights: BackendInsights | undefined, state: FactoryState): AgentReport {
  if (!insights) return report;
  const finding = findingFor(agentId, insights, state, report);
  if (!finding) return report;
  return { ...report, findings: [...report.findings, finding], inputs: [...report.inputs, `${SOURCE} (${finding.evidence[finding.evidence.length - 1]?.source ?? "backend"})`] };
}

function findingFor(agentId: AgentId, ins: BackendInsights, state: FactoryState, report: AgentReport): AgentFinding | null {
  if (agentId === "maintenance" && ins.maintenance) {
    const m = ins.maintenance;
    const focusId = report.affectedAssetIds[0];
    const a = m.assets.find((x) => x.assetId === focusId && x.status === "running") ?? m.assets.find((x) => x.status === "running");
    if (!a) return null;
    const severity: Severity = a.risk === "high" ? "critical" : a.risk === "medium" ? "warning" : "info";
    return {
      id: "xb-maint",
      title: `${a.assetId}: ${a.risk} risk, ${a.hoursToTrip == null ? "no degradation trend" : `trip in ≈${fmtH(a.hoursToTrip)}`} (backend RUL)`,
      detail: `${a.recommendedAction ?? ""} ${m.counts.high} high and ${m.counts.medium} medium-risk machine(s) across the plant.`.trim(),
      severity,
      evidence: [
        { label: "ISO 10816-3 zone", value: `${(a.isoZone ?? "").replace("ZONE_", "").replace(/_/g, " ").toLowerCase()} at ${a.vibration?.toFixed(2)} mm/s (alarm ${a.limits?.alarm}, trip ${a.limits?.trip})`, source: SOURCE },
        { label: "Remaining useful life", value: `${fmtH(a.hoursToTrip)} at ${a.degradationPerHour?.toFixed(3)} mm/s per hour (confidence ${Math.round((a.confidence ?? 0) * 100)}%)`, source: SOURCE },
        { label: "Health score", value: `${Math.round((a.healthScore ?? 0) * 100)}/100`, source: m.engine },
      ],
      assetIds: [a.assetId],
    };
  }
  if (agentId === "supply" && ins.supply) {
    const s = ins.supply;
    const top = s.items.find((i) => i.purchaseOrder) ?? s.items.find((i) => i.expediteNeeded) ?? s.items.find((i) => i.atRisk);
    if (!top) return null;
    const line = s.lines.filter((l) => l.runwayHours != null).sort((a, b) => a.runwayHours! - b.runwayHours!)[0];
    return {
      id: "xb-supply",
      title: `${top.name}: ${fmtH(top.runwayHours)} of supply vs ${fmtH(top.leadTimeHours)} lead time`,
      detail: `${s.counts.atRisk} material(s) at stock-out risk; ${s.counts.toOrder} purchase order(s) recommended${s.counts.toExpedite ? `; ${s.counts.toExpedite} already on order but arriving after the stock-out (expedite)` : ""}.${line ? ` ${line.name} is first to starve (${fmtH(line.runwayHours)}).` : ""}`,
      severity: top.runwayHours != null && top.runwayHours < top.leadTimeHours ? "critical" : "warning",
      evidence: [
        { label: "On hand / reorder point", value: `${fmtInt(top.onHand)} / ${fmtInt(top.reorderPoint)} ${top.unit}`, source: "Inventory ledger" },
        { label: "Consumption", value: `${top.consumptionPerHour.toFixed(1)} ${top.unit}/h (${top.daysOfSupply ?? "—"} days of supply)`, source: SOURCE },
        ...(top.purchaseOrder
          ? [{ label: "Recommended PO", value: `${fmtInt(top.purchaseOrder.qty)} ${top.unit} from ${top.purchaseOrder.supplier}, ETA h+${top.purchaseOrder.etaInHours}, $${fmtInt(top.purchaseOrder.cost)} (${top.purchaseOrder.urgency.toLowerCase()})`, source: SOURCE }]
          : []),
        { label: "Engine", value: "days of supply, stock-out risk, PO sizing", source: s.engine },
      ],
      assetIds: state.assets.filter((x) => top.usedBy.some((u) => u.lineId === x.lineId)).slice(0, 4).map((x) => x.id),
    };
  }
  if (agentId === "production" && ins.demand) {
    const d = ins.demand;
    const p = [...d.products].sort((a, b) => (b.utilizationPct ?? 0) - (a.utilizationPct ?? 0))[0];
    if (!p) return null;
    return {
      id: "xb-demand",
      title: `${p.name}: forecast ${fmtInt(p.dailyP50)}/day vs capacity ${fmtInt(p.capacityPerDay)}/day${p.utilizationPct != null ? ` (${p.utilizationPct.toFixed(0)}%)` : ""}`,
      detail: `${d.horizonDays}-day forecast (P50 ${fmtInt(p.totalP50)} units; P90 ${fmtInt(p.dailyP90)}/day${p.p90ExceedsCapacity ? ", above current capacity" : ""}). Open orders cover ${p.orderCoveragePct ?? "—"}% of it.`,
      severity: p.p90ExceedsCapacity || p.capacityWarning ? "warning" : "info",
      evidence: [
        { label: "Forecast accuracy", value: `WAPE ${(p.metrics.wape * 100).toFixed(1)}% vs baseline ${(p.metrics.baselineWape * 100).toFixed(1)}%`, source: p.model },
        { label: "History", value: "generated from the plant's capacity and product mix", source: "Simulated (labelled)" },
        { label: "Engine", value: `${d.counts.capacityWarnings} capacity warning(s) at ≥${d.capacityWarningPct}%`, source: SOURCE },
      ],
      assetIds: [],
    };
  }
  if (agentId === "quality" && ins.vision && ins.vision.counts.inspected > 0) {
    const v = ins.vision;
    const worst = [...v.lines].sort((a, b) => (a.fpyPct ?? 100) - (b.fpyPct ?? 100))[0];
    return {
      id: "xb-vision",
      title: `AOI: ${v.counts.inspected} inspected, ${v.counts.failed} failed${worst?.fpyPct != null ? `; lowest FPY ${worst.fpyPct}% on ${worst.lineId}` : ""}`,
      detail: `${v.dispositions.pending} awaiting a person's decision.${v.pareto[0] ? ` Top defect: ${v.pareto[0].defectClass.replace(/_/g, " ").toLowerCase()} (${v.pareto[0].count}).` : ""}`,
      severity: v.counts.failed > 0 ? "warning" : "info",
      evidence: [
        { label: "Detector precision", value: v.detectorPrecisionPct != null ? `${v.detectorPrecisionPct}% of flagged parts confirmed by people` : "no decisions yet", source: "Human dispositions" },
        { label: "Engine", value: "Muse Spark + SAM 3.1, OpenCV, IPC-A-610 rules", source: SOURCE },
      ],
      assetIds: [],
    };
  }
  return null;
}
