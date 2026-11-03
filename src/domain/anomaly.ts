import { normalCdf, round } from "./math";
import { estimateTrend, hoursToThreshold, readingsFor, type TrendEstimate } from "./telemetry";
import type { Asset, FactoryState, Severity } from "./types";

export interface Anomaly {
  assetId: string;
  metric: "vibration" | "temperature" | "power";
  kind: "level" | "trend" | "step" | "threshold" | "efficiency" | "offline";
  severity: Severity;
  value: number;
  expected: number;
  zScore: number;
  detail: string;
}

export interface AssetDiagnostics {
  assetId: string;
  vib: TrendEstimate;
  temp: TrendEstimate;
  hoursToAlarm: number;
  hoursToTrip: number;
  tripProbability24h: number;
  tripProbabilityHorizon: number;
  expectedPowerKw: number;
  powerDeviationPct: number;
  pmOverdueHours: number;
  readingsUsed: number;
}

/** Probability that the trip threshold is crossed within `hours`, from slope uncertainty plus 25% model-form error. */
export function tripProbability(current: number, slope: number, slopeSe: number, trip: number, hours: number) {
  if (current >= trip) return 1;
  const required = (trip - current) / hours;
  const se = Math.sqrt((Number.isFinite(slopeSe) ? slopeSe : 0) ** 2 + (0.25 * Math.max(slope, 0)) ** 2 + 0.01 ** 2);
  return round(1 - normalCdf((required - slope) / se), 3);
}

export function diagnoseAsset(state: FactoryState, asset: Asset, horizonHours = 48): AssetDiagnostics {
  const readings = readingsFor(state, asset.id);
  const vib = estimateTrend(readings, "vibration", asset.baseline.vibration, 6);
  const temp = estimateTrend(readings, "temperature", asset.baseline.temperature, 6);
  const s = Math.max(0.3, asset.speedPct / 100);
  const vibSlope = vib.significant ? vib.slopePerHour : 0;
  const tempSlope = temp.significant ? temp.slopePerHour : 0;
  const hVibAlarm = hoursToThreshold(vib.current, vibSlope, asset.thresholds.vibrationAlarm);
  const hTempAlarm = hoursToThreshold(temp.current, tempSlope, asset.thresholds.temperatureAlarm);
  const hVibTrip = hoursToThreshold(vib.current, vibSlope, asset.thresholds.vibrationTrip);
  const hTempTrip = hoursToThreshold(temp.current, tempSlope, asset.thresholds.temperatureTrip);
  const pVib24 = vib.significant ? tripProbability(vib.current, vib.slopePerHour, vib.slopeStdErr, asset.thresholds.vibrationTrip, 24) : 0;
  const pTemp24 = temp.significant ? tripProbability(temp.current, temp.slopePerHour, temp.slopeStdErr, asset.thresholds.temperatureTrip, 24) : 0;
  const pVibH = vib.significant ? tripProbability(vib.current, vib.slopePerHour, vib.slopeStdErr, asset.thresholds.vibrationTrip, horizonHours) : 0;
  const pTempH = temp.significant ? tripProbability(temp.current, temp.slopePerHour, temp.slopeStdErr, asset.thresholds.temperatureTrip, horizonHours) : 0;
  const latest = state.latest[asset.id];
  const load = latest?.running ? s : 0;
  const expectedPowerKw = latest?.running ? asset.idlePowerKw + (asset.ratedPowerKw - asset.idlePowerKw) * load : asset.idlePowerKw;
  const powerDeviationPct = expectedPowerKw > 0 ? round(((asset.signal.powerKw - expectedPowerKw) / expectedPowerKw) * 100, 1) : 0;
  const pmOverdueHours = round(state.clock.hour - asset.lastMaintenanceHour - asset.maintenanceIntervalHours, 0);
  return {
    assetId: asset.id,
    vib,
    temp,
    hoursToAlarm: Math.min(hVibAlarm, hTempAlarm),
    hoursToTrip: Math.min(hVibTrip, hTempTrip),
    tripProbability24h: asset.mode === "down" ? 1 : Math.max(pVib24, pTemp24),
    tripProbabilityHorizon: asset.mode === "down" ? 1 : Math.max(pVibH, pTempH),
    expectedPowerKw: round(expectedPowerKw, 2),
    powerDeviationPct,
    pmOverdueHours,
    readingsUsed: readings.length,
  };
}

export function detectAnomalies(state: FactoryState): { anomalies: Anomaly[]; diagnostics: Record<string, AssetDiagnostics> } {
  const anomalies: Anomaly[] = [];
  const diagnostics: Record<string, AssetDiagnostics> = {};
  for (const a of state.assets) {
    const d = diagnoseAsset(state, a);
    diagnostics[a.id] = d;
    if (a.mode === "down") {
      anomalies.push({
        assetId: a.id,
        metric: "vibration",
        kind: "offline",
        severity: "critical",
        value: 0,
        expected: a.baseline.vibration,
        zScore: 0,
        detail: `${a.name} is offline (unplanned stop).`,
      });
      continue;
    }
    for (const t of [d.vib, d.temp]) {
      const unit = t.metric === "vibration" ? "mm/s" : "°C";
      const alarm = t.metric === "vibration" ? a.thresholds.vibrationAlarm : a.thresholds.temperatureAlarm;
      if (t.current >= alarm) {
        anomalies.push({
          assetId: a.id,
          metric: t.metric,
          kind: "threshold",
          severity: "critical",
          value: t.current,
          expected: t.baselineMean,
          zScore: t.zScore,
          detail: `${t.metric} ${t.current.toFixed(2)} ${unit} is above the alarm limit (${alarm} ${unit}).`,
        });
      } else if (t.zScore > 4) {
        anomalies.push({
          assetId: a.id,
          metric: t.metric,
          kind: "level",
          severity: t.zScore > 12 ? "warning" : "info",
          value: t.current,
          expected: t.baselineMean,
          zScore: t.zScore,
          detail: `${t.metric} ${t.current.toFixed(2)} ${unit} vs baseline ${t.baselineMean.toFixed(1)} ${unit} (z = ${t.zScore.toFixed(1)}).`,
        });
      }
      if (t.stepChange.detected) {
        anomalies.push({
          assetId: a.id,
          metric: t.metric,
          kind: "step",
          severity: "critical",
          value: t.current,
          expected: t.current - t.stepChange.size,
          zScore: t.zScore,
          detail: `Step change of +${t.stepChange.size.toFixed(2)} ${unit} detected — consistent with sudden mechanical damage.`,
        });
      }
      if (t.significant && t.slopePerHour > (t.metric === "vibration" ? 0.03 : 0.15)) {
        anomalies.push({
          assetId: a.id,
          metric: t.metric,
          kind: "trend",
          severity: t.metric === "vibration" && d.hoursToTrip < 48 ? "critical" : "warning",
          value: t.slopePerHour,
          expected: 0,
          zScore: t.tStat,
          detail: `${t.metric} rising ${t.slopePerHour.toFixed(t.metric === "vibration" ? 3 : 2)} ${unit}/h (R² ${t.r2.toFixed(2)}, t = ${t.tStat.toFixed(1)}).`,
        });
      }
    }
    if (Math.abs(d.powerDeviationPct) > 8 && state.latest[a.id]?.running) {
      anomalies.push({
        assetId: a.id,
        metric: "power",
        kind: "efficiency",
        severity: "info",
        value: a.signal.powerKw,
        expected: d.expectedPowerKw,
        zScore: 0,
        detail: `Power draw ${a.signal.powerKw.toFixed(1)} kW is ${d.powerDeviationPct > 0 ? "+" : ""}${d.powerDeviationPct.toFixed(0)}% vs expected at current load.`,
      });
    }
  }
  const rank = { critical: 0, warning: 1, info: 2, success: 3 } as const;
  anomalies.sort((x, y) => rank[x.severity] - rank[y.severity]);
  return { anomalies, diagnostics };
}
