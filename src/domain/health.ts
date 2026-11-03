import { clamp, round } from "./math";
import type { Asset, AssetStatus, MachineMode, RiskLevel, Thresholds } from "./types";

/**
 * Health score (0–100) from vibration and temperature severity relative to the asset's
 * baseline and trip thresholds. Vibration dominates because it is the leading indicator
 * of mechanical wear; temperature contributes the remaining 30 points.
 */
export function computeHealthScore(
  vibration: number,
  temperature: number,
  baseline: { vibration: number; temperature: number },
  thresholds: Thresholds,
) {
  const vibRatio = clamp((vibration - baseline.vibration) / (thresholds.vibrationTrip - baseline.vibration), 0, 1);
  const tempRatio = clamp((temperature - baseline.temperature) / (thresholds.temperatureTrip - baseline.temperature), 0, 1);
  return round(clamp(100 - 70 * Math.pow(vibRatio, 0.9) - 30 * Math.pow(tempRatio, 1.1), 0, 100), 1);
}

export function classifyStatus(
  mode: MachineMode,
  vibration: number,
  temperature: number,
  healthScore: number,
  thresholds: Thresholds,
): AssetStatus {
  if (mode === "down") return "offline";
  if (mode === "maintenance") return "maintenance";
  if (vibration >= thresholds.vibrationAlarm || temperature >= thresholds.temperatureAlarm || healthScore < HEALTH_BANDS.critical) return "critical";
  if (healthScore < HEALTH_BANDS.warning || vibration >= thresholds.vibrationAlarm * 0.8 || temperature >= thresholds.temperatureAlarm * 0.92)
    return "warning";
  return "healthy";
}

export function riskFromStatus(asset: Pick<Asset, "status" | "healthScore" | "criticality">): RiskLevel {
  if (asset.status === "offline") return "critical";
  if (asset.status === "critical") return asset.criticality === "A" ? "critical" : "high";
  if (asset.status === "warning") return asset.criticality === "C" ? "medium" : "high";
  if (asset.healthScore < 85) return "medium";
  return "low";
}

/** Scrap contribution of a machine: excess vibration degrades placement / pressing accuracy. */
export function scrapContribution(vibration: number, thresholds: Thresholds) {
  const onset = thresholds.vibrationAlarm * 0.6;
  return Math.max(0, vibration - onset) * 0.012;
}

/** Health score bands: below `warning` a machine needs attention, below `critical` it needs action. */
export const HEALTH_BANDS = { warning: 75, critical: 45 } as const;

export function healthBand(score: number): "healthy" | "warning" | "critical" {
  return score >= HEALTH_BANDS.warning ? "healthy" : score >= HEALTH_BANDS.critical ? "warning" : "critical";
}
