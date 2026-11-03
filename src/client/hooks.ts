"use client";

import { useEffect, useMemo } from "react";
import { TICK_INTERVAL_MS } from "@/domain/constants";
import { computeKpis, hourlySeries } from "@/domain/kpis";
import { presetScenarios, pickFocusAsset } from "@/domain/scenarios";
import { simulateScenarios } from "@/domain/simulation";
import type { FactoryState } from "@/domain/types";
import { useFactory } from "./store";

/** Load factory state once per session. */
export function useEnsureLoaded() {
  const state = useFactory((s) => s.state);
  const load = useFactory((s) => s.load);
  useEffect(() => {
    if (!state) void load();
  }, [state, load]);
}

/** Drives the simulated live telemetry while the app shell is mounted and the tab is visible. */
export function useLiveClock() {
  const live = useFactory((s) => s.state?.clock.liveTelemetry ?? false);
  const tick = useFactory((s) => s.tick);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void tick();
    }, TICK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [live, tick]);
}

export function useKpis(state: FactoryState | null) {
  const tick = state?.clock.tick;
  return useMemo(() => (state ? { kpis: computeKpis(state), hourly: hourlySeries(state, 24) } : null), [state, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * "Current plan" forecast: the no-intervention scenario for the focus asset, simulated on the
 * client with the same engine as the server. Recomputed when the plant clock advances
 * (throttled to every 5 ticks to keep the UI responsive).
 */
export function useForecast(state: FactoryState | null) {
  const bucket = state ? Math.floor(state.clock.tick / 5) : -1;
  const directivesKey = state?.directives.map((d) => `${d.id}:${d.status}`).join("|");
  return useMemo(() => {
    if (!state) return null;
    const focus = pickFocusAsset(state);
    const def = presetScenarios(state, focus.id).find((d) => d.id === "continue")!;
    return { focus, result: simulateScenarios(state, [{ ...def, name: "Current plan" }])[0] };
  }, [bucket, directivesKey, state?.profile.id]); // eslint-disable-line react-hooks/exhaustive-deps
}
