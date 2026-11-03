import { injectFault } from "./commands";
import { advanceFactory } from "./telemetry";
import type { FactoryState } from "./types";

/** The machine the scripted crisis damages: the demo factory's Line A robot, which carries the seeded incident. */
export const CRISIS_ASSET_ID = "A-ROB-03";

/**
 * Scripted, reproducible crisis on the demo factory: inject joint-4 bearing damage on A-ROB-03
 * and let the plant model run for 30 simulated minutes so the step change is visible in
 * telemetry. Identical inputs ⇒ identical state on every run.
 */
export function applyScriptedCrisis(state: FactoryState, nowISO: string): FactoryState {
  injectFault(state, { assetId: CRISIS_ASSET_ID, mode: "bearing-wear", severity: 50 }, nowISO);
  advanceFactory(state, 0.5, { nowISO });
  return state;
}
