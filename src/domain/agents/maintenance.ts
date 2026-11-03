import { maintenanceHoursFor } from "../scenarios";
import type { AgentFinding, AgentProposal, AgentReport, Evidence } from "../types";
import { confidenceFrom, fmtHours, type AnalysisContext } from "./context";

/**
 * Predictive Maintenance Agent
 * Method: OLS trend on the last 6 h of operating telemetry, change-point test, z-score vs
 * commissioning baseline, extrapolated time-to-alarm / time-to-trip and trip probability
 * from slope uncertainty (+25% model-form error).
 */
export function runMaintenanceAgent(ctx: AnalysisContext): AgentReport {
  const t0 = Date.now();
  const { state, focus, diagnostics, anomalies } = ctx;
  const findings: AgentFinding[] = [];
  const proposals: AgentProposal[] = [];
  const readingCount = Object.values(state.telemetry).reduce((s, r) => s + r.length, 0);

  const d = diagnostics[focus.id];
  const vib = d.vib;
  const temp = d.temp;
  const pctAbove = ((vib.current - focus.baseline.vibration) / focus.baseline.vibration) * 100;
  const evidence: Evidence[] = [
    {
      label: "Vibration (RMS)",
      value: `${vib.current.toFixed(2)} mm/s · baseline ${focus.baseline.vibration.toFixed(1)} (+${pctAbove.toFixed(0)}%)`,
      source: `${focus.id} accelerometer · ${vib.n} running readings, ${vib.windowHours} h window`,
    },
    {
      label: "Vibration trend",
      value: `${vib.slopePerHour >= 0 ? "+" : ""}${vib.slopePerHour.toFixed(3)} mm/s/h · R² ${vib.r2.toFixed(2)} · t = ${vib.tStat.toFixed(1)}`,
      source: "OLS regression on telemetry history",
    },
    {
      label: "Joint temperature",
      value: `${temp.current.toFixed(1)} °C · trend ${temp.slopePerHour >= 0 ? "+" : ""}${temp.slopePerHour.toFixed(2)} °C/h`,
      source: `${focus.id} RTD probe`,
    },
    {
      label: "Time to alarm / trip",
      value: `${fmtHours(d.hoursToAlarm)} / ${fmtHours(d.hoursToTrip)} (alarm ${focus.thresholds.vibrationAlarm}, trip ${focus.thresholds.vibrationTrip} mm/s)`,
      source: "Linear extrapolation of calibrated trend",
    },
    {
      label: "P(trip within 24 h)",
      value: `${(d.tripProbability24h * 100).toFixed(0)}%`,
      source: "Slope uncertainty + 25% model-form error (normal approx.)",
    },
  ];
  if (vib.stepChange.detected) {
    evidence.splice(2, 0, {
      label: "Step change",
      value: `+${vib.stepChange.size.toFixed(2)} mm/s at t=${vib.stepChange.atHour?.toFixed(2)} h`,
      source: "Change-point test (residuals > 4σ vs prior trend)",
    });
  }
  if (d.pmOverdueHours > 0) {
    evidence.push({
      label: "Preventive maintenance",
      value: `${d.pmOverdueHours} h overdue (interval ${focus.maintenanceIntervalHours} h)`,
      source: "Maintenance history",
    });
  }
  if (d.powerDeviationPct > 5) {
    evidence.push({
      label: "Power draw",
      value: `${focus.signal.powerKw.toFixed(1)} kW vs ${d.expectedPowerKw.toFixed(1)} kW expected (+${d.powerDeviationPct.toFixed(0)}%)`,
      source: "Power meter — consistent with increased friction",
    });
  }

  const offline = focus.mode === "down";
  const critical = offline || vib.current >= focus.thresholds.vibrationAlarm || d.hoursToTrip < 24;
  findings.push({
    id: "mf-1",
    title: offline
      ? `${focus.name} is offline after a protective trip`
      : `${focus.name}: ${focus.condition.failureMode ? "progressive " : ""}mechanical degradation`,
    detail: offline
      ? `The asset tripped and is in corrective repair. Root-cause evidence indicates ${focus.condition.failureMode?.toLowerCase() ?? "mechanical damage"}.`
      : `Vibration signature and rising joint temperature are consistent with ${(focus.condition.failureMode ?? "bearing wear").toLowerCase()}${vib.stepChange.detected ? ", with a sudden step suggesting a spall or fracture event" : ""}. At the current rate the asset reaches its protective trip in ${fmtHours(d.hoursToTrip)}.`,
    severity: critical ? "critical" : "warning",
    evidence,
    assetIds: [focus.id],
  });

  // Secondary findings across the fleet
  const others = anomalies.filter((a) => a.assetId !== focus.id && a.metric !== "power");
  const seen = new Set<string>();
  for (const a of others) {
    if (seen.has(a.assetId)) continue;
    seen.add(a.assetId);
    const asset = state.assets.find((x) => x.id === a.assetId);
    const dd = diagnostics[a.assetId];
    if (!asset || !dd) continue;
    findings.push({
      id: `mf-${findings.length + 1}`,
      title: `${asset.name}: ${a.metric} ${a.kind === "trend" ? "drift" : "deviation"} (watch)`,
      detail: `${a.detail} Time to alarm ${fmtHours(dd.hoursToAlarm)}; no action required inside the planning horizon.`,
      severity: a.severity === "critical" ? "warning" : "info",
      evidence: [
        { label: a.metric, value: a.detail, source: `${asset.id} telemetry · ${dd.readingsUsed} readings` },
        { label: "Health score", value: asset.healthScore.toFixed(0), source: "Health model" },
      ],
      assetIds: [asset.id],
    });
    if (findings.length >= 4) break;
  }

  const lead = Math.max(1, Math.min(12, Math.floor(d.hoursToTrip * 0.5)));
  if (offline) {
    proposals.push({ title: `Complete corrective repair on ${focus.id}`, detail: "Replace failed bearing / gearbox; verify alignment before restart.", priority: "now" });
  } else {
    proposals.push({
      title: `Schedule preventive maintenance on ${focus.id} within ${Number.isFinite(d.hoursToTrip) ? lead : 12} h`,
      detail: `Inspect ${(focus.condition.failureMode ?? "drive train").toLowerCase()}; replace bearing set if spalling confirmed. Estimated ${maintenanceHoursFor(state, focus.id)} h with a 3-person crew.`,
      priority: d.hoursToTrip < 24 ? "now" : "soon",
    });
    if (vib.current >= focus.thresholds.vibrationAlarm * 0.8) {
      proposals.push({
        title: `Derate ${focus.id} until serviced`,
        detail: "Wear rate scales with speed²; running at 80% cuts the degradation rate by ~36% while maintenance is arranged.",
        priority: "soon",
      });
    }
  }
  for (const f of findings.slice(1)) {
    proposals.push({ title: `Watch ${f.assetIds[0]}`, detail: "Add to next planned inspection round.", priority: "watch" });
  }

  const conf = offline ? { level: "high" as const, score: 0.95 } : confidenceFrom(vib.r2, vib.n, vib.tStat);
  return {
    agentId: "maintenance",
    status: "complete",
    summary: offline
      ? `${focus.id} is down; ${findings.length - 1} other asset(s) on watch.`
      : `${focus.id} trending to trip in ${fmtHours(d.hoursToTrip)} (P24h ${(d.tripProbability24h * 100).toFixed(0)}%). ${findings.length - 1} other asset(s) on watch.`,
    inputs: [
      `${readingCount.toLocaleString("en-US")} telemetry readings across ${state.assets.length} assets`,
      "Asset thresholds (alarm / trip) and commissioning baselines",
      `${state.maintenanceHistory.length} maintenance records`,
      "Live power-meter signals",
    ],
    method:
      "OLS trend on 6 h of running telemetry with a change-point test; z-score against commissioning baseline; linear extrapolation to alarm and trip thresholds; trip probability from slope standard error plus 25% model-form uncertainty.",
    findings,
    proposals,
    metrics: [
      { label: "Health score", value: focus.healthScore.toFixed(0), tone: focus.healthScore < 45 ? "critical" : focus.healthScore < 75 ? "warning" : "success" },
      { label: "Time to trip", value: fmtHours(d.hoursToTrip), tone: d.hoursToTrip < 24 ? "critical" : "warning" },
      { label: "P(trip ≤ 24 h)", value: `${(d.tripProbability24h * 100).toFixed(0)}%`, tone: d.tripProbability24h > 0.5 ? "critical" : "warning" },
      { label: "PM overdue", value: d.pmOverdueHours > 0 ? `${d.pmOverdueHours} h` : "No", tone: d.pmOverdueHours > 0 ? "warning" : "success" },
    ],
    confidence: {
      ...conf,
      rationale: offline
        ? "Asset state is directly observed (tripped)."
        : `Trend fit R² ${vib.r2.toFixed(2)} on ${vib.n} readings (t = ${vib.tStat.toFixed(1)}). Extrapolation assumes the wear mechanism continues at the observed rate${vib.stepChange.detected ? "; the recent step change adds uncertainty" : ""}.`,
    },
    affectedAssetIds: [...new Set(findings.flatMap((f) => f.assetIds))],
    durationMs: Date.now() - t0,
  };
}
