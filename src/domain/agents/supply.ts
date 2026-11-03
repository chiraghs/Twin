import { scrapContribution } from "../health";
import { consumptionPerHour } from "../kpis";
import { primaryProductOf } from "../simulation";
import type { AgentFinding, AgentProposal, AgentReport } from "../types";
import { fmtInt, type AnalysisContext } from "./context";

/**
 * Supply Chain Agent
 * Method: BOM explosion of open orders, coverage = on-hand ÷ planned consumption rate,
 * inbound-PO timing vs projected exhaustion, and scrap sensitivity of the critical
 * component under the degraded-asset condition.
 */
export function runSupplyAgent(ctx: AnalysisContext): AgentReport {
  const t0 = Date.now();
  const { state, focus, diagnostics } = ctx;
  const now = state.clock.hour;
  const findings: AgentFinding[] = [];
  const proposals: AgentProposal[] = [];
  const line = state.lines.find((l) => l.id === focus.lineId)!;
  const product = primaryProductOf(state, line.id);
  const cap = line.capabilities.find((c) => c.productId === product);

  const coverage = state.inventory.map((i) => {
    const rate = consumptionPerHour(state, i.id);
    const hours = rate > 0 ? i.onHand / rate : Infinity;
    const nextInbound = [...i.inbound].sort((a, b) => a.etaHour - b.etaHour)[0];
    const gap = nextInbound && Number.isFinite(hours) ? Math.max(0, nextInbound.etaHour - now - hours) : Number.isFinite(hours) && hours < 48 ? 48 - hours : 0;
    return { item: i, rate, hours, nextInbound, gap };
  });

  // Critical component: the focus product's BOM item with the least coverage.
  const bomIds = new Set(cap?.bom.map((b) => b.itemId) ?? []);
  const critical = coverage.filter((c) => bomIds.has(c.item.id)).sort((a, b) => a.hours - b.hours)[0];
  const order = state.orders
    .filter((o) => o.productId === product && o.completedHour === null)
    .sort((a, b) => a.dueHour - b.dueHour)[0];

  if (critical && order && cap) {
    const qtyPer = cap.bom.find((b) => b.itemId === critical.item.id)?.qty ?? 1;
    const remaining = order.quantity - order.fulfilled;
    const scrapNow = line.baseScrapRate;
    const need = (remaining * qtyPer) / (1 - scrapNow);
    const margin = critical.item.onHand - need;
    // Scrap sensitivity if the degraded asset keeps running until the order is due.
    const d = diagnostics[focus.id];
    const horizon = Math.max(1, Math.min(order.dueHour - now, Number.isFinite(d.hoursToTrip) ? d.hoursToTrip : order.dueHour - now));
    const avgVib = d.vib.current + (d.vib.significant ? d.vib.slopePerHour * horizon * 0.5 : 0);
    const degradedScrap = Math.min(0.5, line.baseScrapRate + scrapContribution(avgVib, focus.thresholds));
    const needDegraded = (remaining * qtyPer) / (1 - degradedScrap);
    findings.push({
      id: "sf-1",
      title: `${critical.item.name}: ${margin >= 0 ? `thin ${((margin / need) * 100).toFixed(0)}% margin` : "shortfall"} for ${order.id}`,
      detail: `${order.id} needs ${fmtInt(need)} × ${critical.item.id} at the current ${(scrapNow * 100).toFixed(1)}% scrap rate; ${fmtInt(critical.item.onHand)} are on hand. If ${focus.id} keeps running degraded, projected scrap rises to ${(degradedScrap * 100).toFixed(1)}% and consumption to ${fmtInt(needDegraded)} (${fmtInt(needDegraded - need)} extra units of a constrained part).`,
      severity: margin < 0 ? "critical" : margin / need < 0.15 ? "warning" : "info",
      evidence: [
        { label: "On hand", value: `${fmtInt(critical.item.onHand)} ${critical.item.unit}`, source: "Inventory ledger" },
        { label: `${order.id} requirement`, value: `${fmtInt(remaining)} units × ${qtyPer} ÷ (1 − ${(scrapNow * 100).toFixed(1)}%) = ${fmtInt(need)}`, source: "BOM explosion" },
        { label: "Scrap sensitivity", value: `${(scrapNow * 100).toFixed(1)}% → ${(degradedScrap * 100).toFixed(1)}% if degraded`, source: `Projected ${focus.id} vibration ${avgVib.toFixed(1)} mm/s` },
        {
          label: "Next inbound",
          value: critical.nextInbound ? `${critical.nextInbound.poId}: ${fmtInt(critical.nextInbound.qty)} at h+${(critical.nextInbound.etaHour - now).toFixed(0)}` : "None scheduled",
          source: `Supplier: ${critical.item.supplier}`,
        },
      ],
      assetIds: [focus.id],
    });
    proposals.push({
      title: `Protect ${critical.item.id} allocation for ${order.id}`,
      detail: `Do not start lower-priority ${product} work until ${order.id} is complete; avoid running ${focus.id} in a high-scrap condition.`,
      priority: "now",
    });
  }

  for (const c of coverage) {
    if (!Number.isFinite(c.hours) || c.hours > 48) continue;
    if (c.gap <= 0.25) continue;
    findings.push({
      id: `sf-${findings.length + 1}`,
      title: `${c.item.name} exhausted in ≈${c.hours.toFixed(0)} h`,
      detail: `At ${fmtInt(c.rate)} ${c.item.unit}/h, stock runs out at h+${c.hours.toFixed(0)}; ${c.nextInbound ? `${c.nextInbound.poId} arrives at h+${(c.nextInbound.etaHour - now).toFixed(0)}, a ≈${c.gap.toFixed(0)} h gap` : "no inbound PO is scheduled"}. Expediting is available for $${fmtInt(c.item.expediteCost)} (ETA h+${c.item.expediteEtaHours}).`,
      severity: c.gap > 8 ? "warning" : "info",
      evidence: [
        { label: "Coverage", value: `${c.hours.toFixed(1)} h at current allocation`, source: "On-hand ÷ planned consumption" },
        { label: "Consumption", value: `${fmtInt(c.rate)} ${c.item.unit}/h`, source: "Line allocations × BOM" },
      ],
      assetIds: [],
    });
    proposals.push({
      title: `Evaluate expediting ${c.nextInbound?.poId ?? c.item.id}`,
      detail: `Only needed if the stock gap would delay an order due before h+${((c.nextInbound?.etaHour ?? now + 48) - now).toFixed(0)}; the simulator quantifies this.`,
      priority: "watch",
    });
  }

  const belowReorder = state.inventory.filter((i) => i.onHand < i.reorderPoint);
  return {
    agentId: "supply",
    status: "complete",
    summary: critical
      ? `${critical.item.id} is the binding component (${critical.hours.toFixed(0)} h cover); ${findings.length - 1} other supply risk(s).`
      : "No binding component constraints found.",
    inputs: [
      `${state.inventory.length} inventory items with reorder points`,
      `${state.inventory.reduce((s, i) => s + i.inbound.length, 0)} inbound purchase orders`,
      `${state.orders.filter((o) => o.completedHour === null).length} open orders × bills of materials`,
      `Scrap projection for ${focus.id}`,
    ],
    method: "BOM explosion of open orders; coverage hours = on-hand ÷ (allocated rate × BOM qty × (1 + scrap)); exhaustion vs inbound ETA; scrap sensitivity from the vibration→scrap model.",
    findings,
    proposals,
    metrics: [
      { label: "Binding part", value: critical?.item.id ?? "-", tone: "warning" },
      { label: "Coverage", value: critical ? `${critical.hours.toFixed(0)} h` : "-", tone: critical && critical.hours < 30 ? "warning" : "success" },
      { label: "Below reorder", value: String(belowReorder.length), tone: belowReorder.length ? "warning" : "success" },
      { label: "Inbound POs", value: String(state.inventory.reduce((s, i) => s + i.inbound.length, 0)) },
    ],
    confidence: {
      level: "high",
      score: 0.82,
      rationale: "Inventory, BOM and PO data are deterministic; supplier ETAs are taken as committed dates.",
    },
    affectedAssetIds: [focus.id],
    durationMs: Date.now() - t0,
  };
}
