import { oeeOf } from "../kpis";
import { round } from "../math";
import { findRerouteLine, primaryProductOf } from "../simulation";
import type { AgentFinding, AgentProposal, AgentReport } from "../types";
import { fmtInt, type AnalysisContext } from "./context";

/**
 * Production Optimization Agent
 * Method: per-line OEE over the last 8 h, bottleneck identification (min machine
 * capacity at commanded speed), order-driven capacity requirement vs available hours,
 * and slack analysis on alternate lines qualified for the affected product.
 */
export function runProductionAgent(ctx: AnalysisContext): AgentReport {
  const t0 = Date.now();
  const { state, focus } = ctx;
  const findings: AgentFinding[] = [];
  const proposals: AgentProposal[] = [];
  const now = state.clock.hour;
  const recent = state.production.filter((r) => r.hour >= Math.floor(now) - 8);
  const line = state.lines.find((l) => l.id === focus.lineId)!;
  const product = primaryProductOf(state, line.id);
  const cap = line.capabilities.find((c) => c.productId === product);
  const lineOee = oeeOf(recent.filter((r) => r.lineId === line.id));

  // Bottlenecks
  const bottlenecks = state.lines.map((l) => {
    const ms = state.assets.filter((a) => a.lineId === l.id && a.mode === "running");
    const b = ms.sort((x, y) => x.nominalRate * x.speedPct - y.nominalRate * y.speedPct)[0];
    return { line: l, asset: b, capacity: b ? (b.nominalRate * b.speedPct) / 100 : 0 };
  });

  // Requirement for the critical order(s) of this product
  const openOrders = state.orders
    .filter((o) => o.productId === product && o.completedHour === null)
    .sort((a, b) => a.dueHour - b.dueHour);
  const critical = openOrders[0];
  const remaining = critical ? critical.quantity - critical.fulfilled : 0;
  const hoursToDue = critical ? critical.dueHour - now : 0;
  const requiredHours = cap ? remaining / (cap.ratePerHour * (1 - line.baseScrapRate)) : 0;
  const slackHours = hoursToDue - requiredHours;

  findings.push({
    id: "pf-1",
    title: `${line.name} has ${slackHours >= 0 ? `only ${slackHours.toFixed(1)} h` : `a ${Math.abs(slackHours).toFixed(1)} h deficit`} of schedule slack for ${critical?.id ?? "its orders"}`,
    detail: critical
      ? `${critical.id} (${critical.customer}, ${critical.priority}) needs ${fmintSafe(remaining)} more ${product} units in ${hoursToDue.toFixed(1)} h. At ${cap?.ratePerHour} u/h this takes ${requiredHours.toFixed(1)} h of uninterrupted production — any stop longer than ${Math.max(0, slackHours).toFixed(1)} h on ${line.code} makes it late unless capacity is added elsewhere.`
      : "No open orders for this line's product.",
    severity: slackHours < 6 ? "critical" : "warning",
    evidence: [
      { label: "Line OEE (8 h)", value: `${(lineOee.oee * 100).toFixed(1)}% · A ${(lineOee.availability * 100).toFixed(0)}% · P ${(lineOee.performance * 100).toFixed(0)}% · Q ${(lineOee.quality * 100).toFixed(1)}%`, source: "Hourly production records" },
      { label: "Nameplate rate", value: `${cap?.ratePerHour ?? 0} u/h ${product}`, source: `${line.name} capability` },
      { label: "Remaining demand", value: `${fmintSafe(remaining)} units due in ${hoursToDue.toFixed(1)} h`, source: critical ? `${critical.id} order book` : "Order book" },
      { label: "Required run time", value: `${requiredHours.toFixed(1)} h (incl. ${(line.baseScrapRate * 100).toFixed(1)}% scrap)`, source: "Capacity calculation" },
    ],
    assetIds: line.assetIds,
  });

  const alt = findRerouteLine(state, focus.id);
  if (alt && product) {
    const altCap = alt.capabilities.find((c) => c.productId === product)!;
    const nativeProduct = Object.entries(alt.allocation).sort((a, b) => b[1] - a[1])[0]?.[0];
    const nativeCap = alt.capabilities.find((c) => c.productId === nativeProduct);
    const nativeOrders = state.orders.filter((o) => o.productId === nativeProduct && o.completedHour === null);
    const horizonEnd = now + 48;
    const nativeDemand = nativeOrders.filter((o) => o.dueHour <= horizonEnd).reduce((s, o) => s + (o.quantity - o.fulfilled), 0);
    const nativeHoursNeeded = nativeCap ? nativeDemand / nativeCap.ratePerHour : 0;
    const firstDue = nativeOrders.filter((o) => o.dueHour <= horizonEnd).sort((a, b) => a.dueHour - b.dueHour)[0];
    const altSlack = firstDue ? firstDue.dueHour - now - nativeHoursNeeded : 48 - nativeHoursNeeded;
    const altOee = oeeOf(recent.filter((r) => r.lineId === alt.id));
    findings.push({
      id: "pf-2",
      title: `${alt.name} can absorb ${product} production`,
      detail: `${alt.name} is qualified for ${product} at ${altCap.ratePerHour} u/h after a ${Math.round(altCap.changeoverHours * 60)}-min changeover. Its own ${nativeProduct} orders due in the next 48 h need ${nativeHoursNeeded.toFixed(1)} h of capacity, leaving ≈${Math.max(0, altSlack).toFixed(1)} h of slack before ${firstDue?.id ?? "its next due order"}.`,
      severity: "info",
      evidence: [
        { label: "Alternate rate", value: `${altCap.ratePerHour} u/h ${product} (vs ${cap?.ratePerHour} on ${line.code})`, source: `${alt.name} capability matrix` },
        { label: "Changeover", value: `${Math.round(altCap.changeoverHours * 60)} min each way`, source: "Changeover SOP" },
        { label: `${nativeProduct} demand (48 h)`, value: `${fmtInt(nativeDemand)} units → ${nativeHoursNeeded.toFixed(1)} h`, source: "Order book" },
        { label: `${alt.code} OEE (8 h)`, value: `${(altOee.oee * 100).toFixed(1)}%`, source: "Hourly production records" },
      ],
      assetIds: alt.assetIds,
    });
    proposals.push({
      title: `Reroute ${product} to ${alt.name} during the ${focus.id} maintenance window`,
      detail: `Allocate ${alt.code} to ${product} for the outage (~${(altCap.changeoverHours + 6).toFixed(1)} h incl. changeover); return to ${nativeProduct} afterwards. Protects ${critical?.id ?? "the critical order"}.`,
      priority: "now",
    });
  } else {
    findings.push({
      id: "pf-2",
      title: "No qualified alternate line",
      detail: `No other line is qualified to build ${product ?? "this product"}; capacity cannot be shifted. Consider derating instead of stopping.`,
      severity: "warning",
      evidence: [],
      assetIds: [],
    });
  }

  const pkg = bottlenecks.find((b) => b.line.kind === "packaging");
  const upstream = state.lines.filter((l) => l.kind === "assembly").reduce((s, l) => s + Object.entries(l.allocation).reduce((x, [pid, sh]) => x + (l.capabilities.find((c) => c.productId === pid)?.ratePerHour ?? 0) * sh, 0), 0);
  if (pkg) {
    findings.push({
      id: "pf-3",
      title: `${pkg.line.name} is not a constraint`,
      detail: `Packaging bottleneck ${pkg.asset?.id ?? "-"} runs at ${fmtInt(pkg.capacity)} u/h vs ${fmtInt(upstream)} u/h combined upstream plan (${((upstream / Math.max(1, pkg.capacity)) * 100).toFixed(0)}% loaded), so rerouted output can be packed without queueing.`,
      severity: "info",
      evidence: [{ label: "Packaging headroom", value: `${fmtInt(pkg.capacity - upstream)} u/h`, source: "Machine nameplate × commanded speed" }],
      assetIds: pkg.line.assetIds,
    });
  }

  return {
    agentId: "production",
    status: "complete",
    summary: alt
      ? `${line.code} slack ${slackHours.toFixed(1)} h for ${critical?.id ?? "orders"}; ${alt.name} can cover ${product}.`
      : `${line.code} slack ${slackHours.toFixed(1)} h; no alternate line qualified.`,
    inputs: [
      `${recent.length} hourly production records (8 h)`,
      `${state.lines.length} line capability matrices & allocations`,
      `${state.orders.filter((o) => o.completedHour === null).length} open customer orders`,
      "Machine nameplate rates and commanded speeds",
    ],
    method: "OEE = availability × performance × quality from hourly records; bottleneck = min(machine rate × speed); schedule slack = time-to-due − remaining demand ÷ effective rate; alternate-line slack from its own order demand.",
    findings,
    proposals,
    metrics: [
      { label: `${line.code} OEE (8 h)`, value: `${(lineOee.oee * 100).toFixed(1)}%`, tone: lineOee.oee < 0.75 ? "warning" : "success" },
      { label: "Schedule slack", value: `${slackHours.toFixed(1)} h`, tone: slackHours < 6 ? "critical" : "warning" },
      { label: "Alternate line", value: alt ? alt.code : "None", tone: alt ? "success" : "warning" },
      { label: "Packaging load", value: pkg ? `${((upstream / Math.max(1, pkg.capacity)) * 100).toFixed(0)}%` : "-" },
    ],
    confidence: {
      level: "high",
      score: 0.86,
      rationale: "Based on recorded throughput, nameplate capacities and the confirmed order book; assumes changeover times per SOP.",
    },
    affectedAssetIds: [...new Set(findings.flatMap((f) => f.assetIds))],
    durationMs: Date.now() - t0,
  };
}

function fmintSafe(n: number) {
  return fmtInt(round(n, 0));
}
