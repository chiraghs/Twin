import { round } from "../math";
import type { AgentFinding, AgentProposal, AgentReport } from "../types";
import { fmtInt, type AnalysisContext } from "./context";

/**
 * Energy & Sustainability Agent
 * Method: 24 h energy roll-up per line, energy intensity (kWh per good unit), idle-energy
 * share, excess draw of degraded assets vs expected load, and idle waste exposure of an
 * unplanned stop.
 */
export function runEnergyAgent(ctx: AnalysisContext): AgentReport {
  const t0 = Date.now();
  const { state, focus, diagnostics } = ctx;
  const findings: AgentFinding[] = [];
  const proposals: AgentProposal[] = [];
  const price = state.costModel.energyPricePerKwh;
  const now = state.clock.hour;
  const recs = state.production.filter((r) => r.hour >= Math.floor(now) - 24);
  const byLine = state.lines.map((l) => {
    const rs = recs.filter((r) => r.lineId === l.id);
    const kwh = rs.reduce((s, r) => s + r.energyKwh, 0);
    const idle = rs.reduce((s, r) => s + r.idleEnergyKwh, 0);
    const good = rs.reduce((s, r) => s + r.goodUnits, 0);
    const starved = rs.reduce((s, r) => s + r.starvedHours, 0);
    const planned = rs.reduce((s, r) => s + r.plannedHours, 0);
    return { line: l, kwh, idle, good, intensity: good > 0 ? kwh / good : 0, starvedPct: planned > 0 ? starved / planned : 0 };
  });
  const total = byLine.reduce((s, x) => s + x.kwh, 0);
  const totalIdle = byLine.reduce((s, x) => s + x.idle, 0);
  const pkg = byLine.find((x) => x.line.kind === "packaging");
  const factoryOut = pkg?.good ?? 0;

  // Idle waste on the most idle-heavy line
  const idleLine = [...byLine].sort((a, b) => b.idle - a.idle)[0];
  if (idleLine && idleLine.idle > 5) {
    const standbySaving = idleLine.idle * 0.6;
    findings.push({
      id: "ef-1",
      title: `${idleLine.line.name} idles ${(idleLine.starvedPct * 100).toFixed(0)}% of the time at full idle draw`,
      detail: `${fmtInt(idleLine.idle)} kWh of the last 24 h (${((idleLine.idle / Math.max(1, idleLine.kwh)) * 100).toFixed(0)}% of the line's energy) was consumed while waiting for upstream units. An auto-standby rule (drives to standby after 5 min starved, assumed 60% idle reduction) would avoid ≈${fmtInt(standbySaving)} kWh/day ($${(standbySaving * price).toFixed(0)}/day).`,
      severity: "warning",
      evidence: [
        { label: "Idle energy (24 h)", value: `${fmtInt(idleLine.idle)} kWh`, source: "Power meters, idle-state tagging" },
        { label: "Starved time", value: `${(idleLine.starvedPct * 100).toFixed(1)}% of planned hours`, source: "Line state log" },
        { label: "Assumption", value: "60% idle draw reduction in standby", source: "Typical drive standby spec (demo assumption)" },
      ],
      assetIds: idleLine.line.assetIds,
    });
    proposals.push({
      title: `Enable auto-standby on ${idleLine.line.name}`,
      detail: `Estimated ≈${fmtInt(standbySaving)} kWh/day avoidable (assumption-based estimate, not measured).`,
      priority: "soon",
    });
  }

  // Degraded asset drawing excess power
  const d = diagnostics[focus.id];
  if (d && d.powerDeviationPct > 4 && focus.mode === "running") {
    const excessKw = focus.signal.powerKw - d.expectedPowerKw;
    findings.push({
      id: "ef-2",
      title: `${focus.id} draws ${d.powerDeviationPct.toFixed(0)}% more power than expected`,
      detail: `At the same throughput the robot uses ${focus.signal.powerKw.toFixed(1)} kW vs ${d.expectedPowerKw.toFixed(1)} kW expected — friction losses consistent with drive-train wear (+${excessKw.toFixed(2)} kW, ≈${(excessKw * 24).toFixed(0)} kWh/day).`,
      severity: "info",
      evidence: [{ label: "Power deviation", value: `+${d.powerDeviationPct.toFixed(1)}%`, source: `${focus.id} power meter vs load model` }],
      assetIds: [focus.id],
    });
  }

  // Idle waste exposure of an unplanned stop on the focus line
  const line = state.lines.find((l) => l.id === focus.lineId);
  if (line) {
    const peers = state.assets.filter((a) => a.lineId === line.id && a.id !== focus.id);
    const idleKw = peers.reduce((s, a) => s + a.idlePowerKw, 0);
    const repair = state.costModel.unplannedRepairHours;
    findings.push({
      id: "ef-3",
      title: `Unplanned stop would idle ${line.code} for ${repair} h`,
      detail: `If ${focus.id} trips, ${peers.length} upstream/downstream machines stay energised at ≈${idleKw.toFixed(1)} kW for the ${repair} h repair (≈${fmtInt(idleKw * repair)} kWh wasted). A planned stop allows lock-out/tag-out at 0 kW.`,
      severity: "info",
      evidence: [{ label: "Idle load", value: `${idleKw.toFixed(1)} kW across ${peers.length} machines`, source: "Rated idle power" }],
      assetIds: peers.map((a) => a.id),
    });
    proposals.push({
      title: `Lock out ${line.code} during planned maintenance`,
      detail: "Power down peer machines instead of idling while the asset is serviced.",
      priority: "soon",
    });
  }

  const scrapRecs = recs.filter((r) => state.lines.find((l) => l.id === r.lineId)?.kind === "assembly");
  const scrap = scrapRecs.reduce((s, r) => s + r.scrapUnits, 0);
  return {
    agentId: "energy",
    status: "complete",
    summary: `${fmtInt(total)} kWh in 24 h (${factoryOut > 0 ? (total / factoryOut).toFixed(3) : "-"} kWh/unit); ${((totalIdle / Math.max(1, total)) * 100).toFixed(0)}% idle.`,
    inputs: [
      `${recs.length} hourly energy records (24 h)`,
      `Live power signals for ${state.assets.length} assets`,
      "Rated & idle power per machine",
      `Energy price $${price.toFixed(2)}/kWh (assumption)`,
    ],
    method: "Energy intensity = kWh ÷ packaged good units; idle energy = draw while not producing; excess draw = measured kW vs load model; standby savings use a stated 60% reduction assumption.",
    findings,
    proposals,
    metrics: [
      { label: "Energy (24 h)", value: `${fmtInt(total)} kWh` },
      { label: "Intensity", value: factoryOut > 0 ? `${(total / factoryOut).toFixed(3)} kWh/u` : "-" },
      { label: "Idle share", value: `${((totalIdle / Math.max(1, total)) * 100).toFixed(1)}%`, tone: totalIdle / Math.max(1, total) > 0.1 ? "warning" : "success" },
      { label: "Scrap (24 h)", value: `${fmtInt(scrap)} units`, tone: "warning" },
    ],
    confidence: {
      level: "medium",
      score: round(0.68, 2),
      rationale: "Energy is metered, but savings figures depend on the stated standby-reduction assumption.",
    },
    affectedAssetIds: [...new Set(findings.flatMap((f) => f.assetIds))],
    durationMs: Date.now() - t0,
  };
}
