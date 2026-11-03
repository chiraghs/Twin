import type { CostModel, OrderPriority } from "./types";

/** Live telemetry cadence: each tick advances simulated time by TICK_HOURS. */
export const TICK_HOURS = 2 / 60;
export const TICK_INTERVAL_MS = 4000;
/** A telemetry history point is persisted every HISTORY_STEP_HOURS of simulated time. */
export const HISTORY_STEP_HOURS = 10 / 60;
export const TELEMETRY_HISTORY_POINTS = 108; // 18h at 10-minute resolution
export const PRODUCTION_HISTORY_HOURS = 48;

/** Scenario engine resolution. */
export const SCENARIO_DT = 0.25;

/** °C of bearing/gear friction heat per mm/s of excess vibration. */
export const TEMP_PER_VIB_EXCESS = 2.4;
/** Extra power draw (fraction of rated kW) per mm/s of excess vibration (friction losses). */
export const POWER_PER_VIB_EXCESS = 0.035;

export const PRIORITY_RANK: Record<OrderPriority, number> = { critical: 0, high: 1, standard: 2 };
export const PRIORITY_WEIGHT: Record<OrderPriority, number> = { critical: 3, high: 2, standard: 1 };

export const DEFAULT_COST_MODEL: CostModel = {
  energyPricePerKwh: 0.16,
  idlePowerFactor: 1,
  maintenanceLaborPerHour: 380,
  maintenancePartsCost: 2400,
  unplannedRepairCost: 24000,
  unplannedRepairHours: 16,
  changeoverCost: 900,
  ambientTemperature: 24,
};

export const SCORE_WEIGHTS = { delivery: 40, cost: 30, risk: 20, sustainability: 10 } as const;
