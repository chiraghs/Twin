import { computeQuality, defectTrend, recentDefectTypes, usesIpc } from "../quality";
import type { AgentFinding, AgentProposal, AgentReport } from "../types";
import { fmtInt, type AnalysisContext } from "./context";

const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;

/**
 * Quality Inspection Agent
 * Method: per-station first-pass yield, DPMO and defect-class Pareto from the AOI and final
 * inspection cameras (24 h); recent-vs-baseline defect rate; Pearson correlation between each
 * machine's hourly vibration and its line's hourly defect rate (cross-modal corroboration).
 */
export function runQualityAgent(ctx: AnalysisContext): AgentReport {
  const t0 = Date.now();
  const { state, focus } = ctx;
  const q = computeQuality(state, 24);
  const findings: AgentFinding[] = [];
  const proposals: AgentProposal[] = [];
  const focusStation = q.stations.find((s) => s.lineId === focus.lineId);
  const corr = q.correlations.find((c) => c.assetId === focus.id) ?? q.correlations[0];

  if (focusStation) {
    const top = focusStation.defectTypes[0];
    const rising = focusStation.recentRate > focusStation.baselineRate * 1.4 && focusStation.recentRate - focusStation.baselineRate > 0.005;
    const trend = defectTrend(focusStation);
    const recentTop = recentDefectTypes(state, focusStation.lineId, 3)[0];
    findings.push({
      id: "qf-1",
      title: rising
        ? `${focusStation.camera.name.split(" (")[0]}: defect rate up ${pct(focusStation.baselineRate)} → ${pct(focusStation.recentRate)}`
        : `${focusStation.camera.name.split(" (")[0]}: defect rate ${pct(focusStation.recentRate)}`,
      detail: `${fmtInt(focusStation.inspected)} units inspected in 24 h against ${focusStation.camera.standard?.split(" · ")[0] ?? "the product specification"} · first-pass yield ${pct(focusStation.fpy)} · ${fmtInt(focusStation.dpmo)} DPMO. ${
        top ? `Leading defect class over 24 h: ${top.type} (${pct(top.share, 0)} of rejects).` : ""
      }${recentTop && top && recentTop.type !== top.type ? ` In the last 3 h the mix has shifted: ${recentTop.type} now leads (${pct(recentTop.share, 0)}).` : ""}`,
      severity: rising ? "warning" : "info",
      evidence: [
        { label: "Inspected (24 h)", value: fmtInt(focusStation.inspected), source: `${focusStation.camera.id} · 100% AOI` },
        { label: "First-pass yield", value: pct(focusStation.fpy), source: "Rejects ÷ inspected" },
        { label: "DPMO", value: `${fmtInt(focusStation.dpmo)} (${focusStation.opportunities} opportunities/unit)`, source: "Defects ÷ (units × opportunities) × 10⁶" },
        { label: "Recent vs baseline", value: `${pct(focusStation.recentRate)} vs ${pct(focusStation.baselineRate)}`, source: "Last 2 h vs earlier hours" },
        { label: "Trend", value: `${(trend.slopePerHour * 100).toFixed(3)} pts/h (R² ${trend.r2.toFixed(2)})`, source: "OLS on hourly defect rate" },
        ...(top ? [{ label: "Top defect class (24 h)", value: `${top.type} · ${top.criterion}`, source: "Defect classification" }] : []),
        ...(recentTop ? [{ label: "Top defect class (3 h)", value: `${recentTop.type} · ${pct(recentTop.share, 0)} of recent rejects`, source: "Defect classification, recent hours" }] : []),
      ],
      assetIds: [focusStation.camera.assetId ?? focus.id],
    });
  }

  if (corr) {
    const asset = state.assets.find((a) => a.id === corr.assetId);
    const strong = corr.r >= 0.8;
    findings.push({
      id: "qf-2",
      title: `Camera evidence ${strong ? "corroborates" : "partially supports"} ${corr.assetId} degradation (r = ${corr.r.toFixed(2)})`,
      detail: `Hourly defect rate at the AOI station tracks ${asset?.name ?? corr.assetId} vibration over ${corr.n} hours: about +${corr.slope.toFixed(2)} defect-rate points per mm/s. Two independent signals — the accelerometer and the inspection camera — point to the same root cause.`,
      severity: strong ? "warning" : "info",
      evidence: [
        { label: "Pearson r", value: corr.r.toFixed(3), source: `${corr.n} hourly pairs (vibration, defect rate)` },
        { label: "Sensitivity", value: `+${corr.slope.toFixed(2)} pts per mm/s`, source: "OLS slope" },
        { label: "Signals", value: "Accelerometer ↔ AOI rejects", source: "Cross-modal correlation" },
      ],
      assetIds: [corr.assetId],
    });
  }

  for (const st of q.stations.filter((s) => s.lineId !== focus.lineId)) {
    const top = st.defectTypes[0];
    if (!top) continue;
    const pack = state.lines.find((l) => l.id === st.lineId)?.kind === "packaging";
    findings.push({
      id: `qf-${findings.length + 1}`,
      title: `${st.lineName}: FPY ${pct(st.fpy)}${pack ? " at pack-out" : ""}`,
      detail: `${fmtInt(st.inspected)} units · ${fmtInt(st.dpmo)} DPMO · top class ${top.type}. ${st.recentRate > st.baselineRate * 1.4 ? "Rising — watch." : "Stable."}`,
      severity: st.recentRate > st.baselineRate * 1.4 ? "warning" : "info",
      evidence: [{ label: "Standard", value: st.camera.standard ?? "—", source: st.camera.id }],
      assetIds: st.camera.assetId ? [st.camera.assetId] : [],
    });
    if (findings.length >= 5) break;
  }

  if (focusStation && focusStation.recentRate > focusStation.baselineRate * 1.4) {
    const lastTwo = focusStation.hourly.slice(-2).reduce((s, h) => s + h.inspected, 0);
    proposals.push({
      title: `Contain: hold and re-inspect the last 2 h of ${focusStation.lineName} output (~${fmtInt(lastTwo)} units)`,
      detail: `Quarantine units produced since the defect rate rose; re-inspect to ${usesIpc(state) ? "IPC-A-610 Class 2" : "the product specification"} before release. Human disposition of every reject.`,
      priority: "now",
    });
  }
  if (corr && corr.r >= 0.8) {
    proposals.push({ title: `Treat ${corr.assetId} as root cause — fix the machine, not the inspection`, detail: "Defects follow the mechanical condition; adjusting inspection thresholds would hide the problem.", priority: "now" });
  }
  proposals.push({
    title: "Validate the inspection system before changing thresholds",
    detail: "Run an attribute-agreement study (AIAG MSA) on AOI decisions vs. certified inspectors; never tune reject limits on unvalidated data.",
    priority: "watch",
  });

  const conf = corr ? Math.min(0.95, 0.5 + 0.4 * Math.max(0, corr.r) + 0.05 * Math.min(1, corr.n / 18)) : 0.6;
  return {
    agentId: "quality",
    status: "complete",
    summary: focusStation
      ? `${focusStation.lineName} AOI: ${pct(focusStation.recentRate)} rejects (FPY ${pct(focusStation.fpy, 1)})${corr ? `; tracks ${corr.assetId} vibration (r = ${corr.r.toFixed(2)})` : ""}.`
      : "No inspection station on the focus line.",
    inputs: [
      `${q.stations.length} inspection cameras (AOI + pack-out), ${fmtInt(q.totalInspected)} units in 24 h`,
      usesIpc(state) ? "Defect classes mapped to IPC-A-610J Class 2 and ISO/IEC 15416 criteria" : "Defect classes mapped to each machine's failure modes and ISO/IEC 15416 at pack-out",
      "Hourly vibration telemetry for cross-modal correlation",
    ],
    method:
      "First-pass yield and DPMO per station; Pareto of defect classes; recent-vs-baseline reject rate; OLS trend; Pearson correlation of hourly defect rate with each machine's hourly vibration. Inspection outcomes in demo mode are derived from the plant model's scrap attribution.",
    findings,
    proposals,
    metrics: [
      { label: "Rolled throughput yield", value: pct(q.rty, 1), tone: q.rty < 0.96 ? "warning" : "success" },
      { label: "Focus-line rejects", value: focusStation ? pct(focusStation.recentRate) : "—", tone: focusStation && focusStation.recentRate > 0.04 ? "critical" : "warning" },
      { label: "Correlation r", value: corr ? corr.r.toFixed(2) : "—", tone: corr && corr.r >= 0.8 ? "critical" : undefined },
      { label: "Top defect", value: q.pareto[0]?.type ?? "—" },
    ],
    confidence: {
      level: conf >= 0.75 ? "high" : conf >= 0.5 ? "medium" : "low",
      score: Math.round(conf * 100) / 100,
      rationale: corr ? `Correlation r = ${corr.r.toFixed(2)} over ${corr.n} hours; defect classes come from a deterministic attribution model, not a validated vision model.` : "No strong machine correlation found.",
    },
    affectedAssetIds: [...new Set(findings.flatMap((f) => f.assetIds))],
    durationMs: Date.now() - t0,
  };
}
