import { injectFault } from "@/domain/commands";
import { buildDemoFactory } from "@/domain/seed";
import { advanceFactory } from "@/domain/telemetry";

export const ANCHOR = "2026-10-13T06:00:00.000Z";
export const NOW = "2026-10-13T06:05:00.000Z";

/** Fresh demo factory (seeded warning-level incident on A-ROB-03). */
export const demo = () => buildDemoFactory(ANCHOR);

/** The scripted crisis used by "Run Factory Crisis Demo": bearing damage + 30 min of plant time. */
export function crisis() {
  const s = demo();
  injectFault(s, { assetId: "A-ROB-03", mode: "bearing-wear", severity: 50 }, NOW);
  advanceFactory(s, 0.5, { nowISO: NOW });
  return s;
}
