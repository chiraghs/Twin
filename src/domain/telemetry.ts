/**
 * Live telemetry: advances the factory with the plant model, produces measured readings
 * (with deterministic noise), maintains smoothed signals / health / status, rolls up
 * hourly production records and turns plant events into incidents and audit entries.
 */
import { HISTORY_STEP_HOURS, PRODUCTION_HISTORY_HOURS, TELEMETRY_HISTORY_POINTS, TICK_HOURS } from "./constants";
import { classifyStatus, computeHealthScore } from "./health";
import { nextId } from "./ids";
import { clamp, gaussian, linearFit, mean, round, std } from "./math";
import { emptyAcc, machineTemperature, machineVibration, stepWorld, worldFromState, type MachineSim, type SimWorld, type WorldEvent } from "./world";
import { appendAudit } from "./audit";
import type { Asset, FactoryState, LineHourRecord, TelemetryReading } from "./types";

const EMA = 0.35;

export function measuredReading(m: MachineSim, seed: number, tick: number, hour: number, ambient: number): TelemetryReading {
  const key = `${m.id}:${tick}`;
  const v = machineVibration(m);
  const t = machineTemperature(m);
  const pf = m.productiveFraction;
  let vibration: number;
  let temperature: number;
  if (m.mode === "running" && pf > 0) {
    vibration = v * (0.93 + 0.07 * pf) + gaussian(seed, key + "v") * (0.05 + 0.012 * v);
    temperature = ambient + (t - ambient) * (0.85 + 0.15 * pf) + gaussian(seed, key + "t") * 0.35;
  } else if (m.mode === "running") {
    vibration = 0.25 * v + Math.abs(gaussian(seed, key + "v")) * 0.04;
    temperature = ambient + (t - ambient) * 0.6 + gaussian(seed, key + "t") * 0.3;
  } else {
    vibration = 0.05 + Math.abs(gaussian(seed, key + "v")) * 0.02;
    temperature = ambient + (t - ambient) * 0.35 + gaussian(seed, key + "t") * 0.2;
  }
  const powerKw = Math.max(0, m.powerKw * (1 + gaussian(seed, key + "p") * 0.015));
  return {
    t: round(hour, 4),
    vibration: round(Math.max(0, vibration), 3),
    temperature: round(temperature, 2),
    powerKw: round(powerKw, 3),
    speedPct: m.mode === "running" ? m.speedPct : 0,
    throughput: round(m.mode === "running" ? m.throughput : 0, 2),
    running: m.mode === "running" && pf > 0,
  };
}

function resetSignal(asset: Asset) {
  asset.signal.vibration = asset.baseline.vibration;
  asset.signal.temperature = asset.baseline.temperature;
}

/** Update smoothed signal, health score, status and utilization from a reading. */
export function updateDerived(asset: Asset, reading: TelemetryReading, mode: Asset["mode"]) {
  if (reading.running) {
    asset.signal.vibration = round(asset.signal.vibration + EMA * (reading.vibration - asset.signal.vibration), 3);
    asset.signal.temperature = round(asset.signal.temperature + EMA * (reading.temperature - asset.signal.temperature), 2);
  }
  asset.signal.powerKw = round(asset.signal.powerKw + EMA * (reading.powerKw - asset.signal.powerKw), 3);
  asset.signal.throughput = round(asset.signal.throughput + EMA * (reading.throughput - asset.signal.throughput), 2);
  asset.healthScore = computeHealthScore(asset.signal.vibration, asset.signal.temperature, asset.baseline, asset.thresholds);
  asset.status = classifyStatus(mode, asset.signal.vibration, asset.signal.temperature, asset.healthScore, asset.thresholds);
  asset.utilization = round(clamp(asset.signal.throughput / Math.max(1, asset.nominalRate), 0, 1.2), 3);
}

function mergeProduction(state: FactoryState, world: SimWorld, bucket: number) {
  for (const [lineId, acc] of Object.entries(world.acc)) {
    let rec = state.production.find((r) => r.hour === bucket && r.lineId === lineId);
    if (!rec) {
      rec = { hour: bucket, lineId, ...emptyAcc(), scrapByCause: {} } as LineHourRecord;
      state.production.push(rec);
    }
    for (const k of Object.keys(acc) as (keyof typeof acc)[]) {
      if (k === "scrapByCause") {
        rec.scrapByCause ??= {};
        for (const [cause, v] of Object.entries(acc.scrapByCause)) rec.scrapByCause[cause] = (rec.scrapByCause[cause] ?? 0) + v;
      } else {
        (rec as unknown as Record<string, number>)[k] += acc[k];
      }
    }
  }
}

function trimHistory(state: FactoryState) {
  const minHour = Math.floor(state.clock.hour) - PRODUCTION_HISTORY_HOURS;
  if (state.production.length && state.production[0].hour < minHour) {
    state.production = state.production.filter((r) => r.hour >= minHour);
  }
  for (const id of Object.keys(state.telemetry)) {
    const arr = state.telemetry[id];
    if (arr.length > TELEMETRY_HISTORY_POINTS) state.telemetry[id] = arr.slice(arr.length - TELEMETRY_HISTORY_POINTS);
  }
}

/** Copy structural plant state from the world back into the factory state. */
export function writeWorldToState(state: FactoryState, world: SimWorld) {
  for (const a of state.assets) {
    const m = world.machines[a.id];
    if (!m) continue;
    a.mode = m.mode;
    a.speedPct = m.speedPct;
    a.condition.vibrationExcess = round(m.vibExcess, 4);
    a.condition.vibrationSlope = m.vibSlope;
    a.condition.temperatureExcess = round(m.tempDrift, 4);
    a.condition.temperatureSlope = m.tempSlope;
    a.condition.failureMode = m.failureMode;
    a.downUntil = m.downUntil;
    a.maintenanceUntil = m.maintenanceUntil;
  }
  for (const l of state.lines) {
    const w = world.lines[l.id];
    if (!w) continue;
    l.allocation = { ...w.allocation };
    l.changeoverUntil = w.changeoverUntil;
    l.buffer = Object.fromEntries(Object.entries(w.buffer).map(([k, v]) => [k, round(v, 3)]));
    l.state = w.state;
  }
  for (const i of state.inventory) {
    const w = world.inventory[i.id];
    if (!w) continue;
    i.onHand = round(w.onHand, 2);
    i.inbound = w.inbound.map((s) => ({ ...s }));
  }
  state.finishedGoods = Object.fromEntries(Object.entries(world.finishedGoods).map(([k, v]) => [k, round(v, 3)]));
  for (const o of state.orders) {
    const w = world.orders.find((x) => x.id === o.id);
    if (!w) continue;
    o.fulfilled = round(w.fulfilled, 3);
    o.completedHour = w.completedHour;
  }
  for (const d of state.directives) {
    const w = world.directives.find((x) => x.id === d.id);
    if (w) {
      d.status = w.status;
      if (w.kind !== "maintenance" && d.kind !== "maintenance") d.endHour = w.endHour;
    }
  }
  if (world.ruleRuntime) {
    // Directives created by automation rules; keep the open ones and the 12 most recent finished ones.
    const known = new Set(state.directives.map((d) => d.id));
    for (const w of world.directives) if (w.ruleId && !known.has(w.id)) state.directives.push({ ...w });
    const finished = state.directives.filter((d) => d.ruleId && (d.status === "completed" || d.status === "cancelled"));
    if (finished.length > 12) {
      const drop = new Set(finished.slice(0, finished.length - 12).map((d) => d.id));
      state.directives = state.directives.filter((d) => !drop.has(d.id));
    }
    state.ruleRuntime = structuredClone(world.ruleRuntime);
  }
  state.clock.hour = round(world.hour, 6);
}

function openIncidentFor(state: FactoryState, assetId: string) {
  return state.incidents.find((i) => i.assetId === assetId && i.status !== "resolved");
}

/** Translate plant events and status transitions into incidents, work-order updates and audit entries. */
function handleEvents(state: FactoryState, world: SimWorld, events: WorldEvent[], nowISO: string) {
  for (const e of events) {
    const asset = e.assetId ? state.assets.find((a) => a.id === e.assetId) : undefined;
    if (e.kind === "failure" && asset) {
      const existing = openIncidentFor(state, asset.id);
      if (existing) {
        existing.severity = "critical";
        existing.title = `${asset.name} tripped — unplanned stop`;
        existing.summary = e.label;
      } else {
        state.incidents.unshift({
          id: nextId(state, "INC", 2040),
          assetId: asset.id,
          title: `${asset.name} tripped — unplanned stop`,
          severity: "critical",
          status: "open",
          openedHour: e.hour,
          resolvedHour: null,
          source: "telemetry",
          summary: e.label,
        });
      }
      appendAudit(state, nowISO, {
        category: "telemetry-alert",
        actor: "Plant model",
        title: `${asset.id} unplanned stop`,
        detail: `${e.label}. Corrective repair estimated at ${world.params.unplannedRepairHours} h.`,
        severity: "critical",
        refs: { assetIds: [asset.id] },
      });
    } else if ((e.kind === "maintenance-start" || e.kind === "maintenance-end") && asset) {
      const d = e.directiveId ? state.directives.find((x) => x.id === e.directiveId) : undefined;
      const wo = d && d.kind === "maintenance" ? state.workOrders.find((w) => w.id === d.workOrderId) : state.workOrders.find((w) => w.assetId === asset.id && w.status === "in-progress");
      if (e.kind === "maintenance-start") {
        if (wo) wo.status = "in-progress";
        appendAudit(state, nowISO, {
          category: "action",
          actor: "Maintenance crew",
          title: `${wo?.id ?? "Work order"} started on ${asset.id}`,
          detail: `${asset.name} locked out for preventive maintenance.`,
          severity: "info",
          refs: { assetIds: [asset.id], directiveId: e.directiveId, recommendationId: d?.recommendationId },
        });
      } else {
        const active = state.workOrders.find((w) => w.assetId === asset.id && w.status === "in-progress");
        if (active) active.status = "completed";
        resetSignal(asset);
        state.maintenanceHistory.unshift({
          id: nextId(state, "MR", 5000),
          assetId: asset.id,
          type: "preventive",
          hour: e.hour,
          durationHours: active?.durationHours ?? 0,
          technician: "Shift B maintenance crew",
          notes: `${active?.reason ?? "Preventive maintenance"} — condition restored.`,
          cost: active?.cost ?? 0,
        });
        asset.lastMaintenanceHour = e.hour;
        const inc = openIncidentFor(state, asset.id);
        if (inc) {
          inc.status = "resolved";
          inc.resolvedHour = e.hour;
        }
        appendAudit(state, nowISO, {
          category: "state-change",
          actor: "Plant model",
          title: `${asset.id} returned to service`,
          detail: `Maintenance complete. Vibration and temperature back to baseline; incident ${inc?.id ?? ""} resolved.`.trim(),
          severity: "success",
          refs: { assetIds: [asset.id], incidentId: inc?.id, recommendationId: active?.recommendationId },
        });
      }
    } else if (e.kind === "repair-complete" && asset) {
      resetSignal(asset);
      asset.lastMaintenanceHour = e.hour;
      const inc = openIncidentFor(state, asset.id);
      if (inc) {
        inc.status = "resolved";
        inc.resolvedHour = e.hour;
      }
      state.maintenanceHistory.unshift({
        id: nextId(state, "MR", 5000),
        assetId: asset.id,
        type: "corrective",
        hour: e.hour,
        durationHours: world.params.unplannedRepairHours,
        technician: "Emergency response crew",
        notes: "Corrective repair after a protective trip.",
        cost: state.costModel.unplannedRepairCost,
      });
      appendAudit(state, nowISO, {
        category: "state-change",
        actor: "Plant model",
        title: `${asset.id} corrective repair complete`,
        detail: e.label,
        severity: "success",
        refs: { assetIds: [asset.id], incidentId: inc?.id },
      });
    } else if (e.kind === "reroute-start" || e.kind === "reroute-end") {
      const d = e.directiveId ? state.directives.find((x) => x.id === e.directiveId) : undefined;
      appendAudit(state, nowISO, {
        category: "state-change",
        actor: "Plant model",
        title: e.kind === "reroute-start" ? "Production re-allocation started" : "Production re-allocation ended",
        detail: e.label,
        severity: "info",
        refs: { directiveId: e.directiveId, recommendationId: d?.recommendationId },
      });
    } else if (e.kind === "rule") {
      appendAudit(state, nowISO, {
        category: "action",
        actor: "Automation rule",
        title: e.label,
        detail: "A playground rule acted on the simulated plant. No command was sent to real equipment.",
        severity: e.severity,
        refs: { directiveId: e.directiveId, assetIds: e.assetId ? [e.assetId] : undefined },
      });
    } else if (e.kind === "order-complete" || e.kind === "order-late" || e.kind === "stockout" || e.kind === "inbound") {
      appendAudit(state, nowISO, {
        category: e.kind === "inbound" || e.kind === "order-complete" ? "state-change" : "telemetry-alert",
        actor: "Plant model",
        title: e.label,
        detail:
          e.kind === "order-late"
            ? "Order reached its due time without full fulfilment."
            : e.kind === "stockout"
              ? "A material shortage is constraining production."
              : e.kind === "inbound"
                ? "Inbound purchase order received into stores."
                : "Finished goods allocated to customer order.",
        severity: e.severity,
        refs: {},
      });
    }
  }
}

function handleStatusTransitions(state: FactoryState, before: Map<string, Asset["status"]>, nowISO: string) {
  for (const a of state.assets) {
    const prev = before.get(a.id);
    if (prev === a.status) continue;
    if (a.status === "offline" && !openIncidentFor(state, a.id)) {
      const inc = {
        id: nextId(state, "INC", 2040),
        assetId: a.id,
        title: `${a.name} — unplanned stop`,
        severity: "critical" as const,
        status: "open" as const,
        openedHour: state.clock.hour,
        resolvedHour: null,
        source: "telemetry" as const,
        summary: `${a.name} is offline${a.condition.failureMode ? ` (${a.condition.failureMode})` : ""}. ${state.lines.find((l) => l.id === a.lineId)?.name ?? "Its line"} is stopped.`,
      };
      state.incidents.unshift(inc);
      appendAudit(state, nowISO, {
        category: "telemetry-alert",
        actor: "Telemetry monitor",
        title: `${a.id} went OFFLINE`,
        detail: inc.summary,
        severity: "critical",
        refs: { assetIds: [a.id], incidentId: inc.id },
      });
    } else if (a.status === "critical" && prev !== "offline") {
      let inc = openIncidentFor(state, a.id);
      if (!inc) {
        inc = {
          id: nextId(state, "INC", 2040),
          assetId: a.id,
          title: `${a.name} — abnormal ${a.signal.vibration >= a.thresholds.vibrationAlarm ? "vibration" : "temperature"}`,
          severity: "critical",
          status: "open",
          openedHour: state.clock.hour,
          resolvedHour: null,
          source: "telemetry",
          summary: `Vibration ${a.signal.vibration.toFixed(1)} mm/s, temperature ${a.signal.temperature.toFixed(0)} °C, health ${a.healthScore.toFixed(0)}.`,
        };
        state.incidents.unshift(inc);
      } else if (inc.severity !== "critical") {
        inc.severity = "critical";
        inc.summary = `Escalated: vibration ${a.signal.vibration.toFixed(1)} mm/s, temperature ${a.signal.temperature.toFixed(0)} °C, health ${a.healthScore.toFixed(0)}.`;
      }
      appendAudit(state, nowISO, {
        category: "telemetry-alert",
        actor: "Telemetry monitor",
        title: `${a.id} entered CRITICAL state`,
        detail: `Health ${a.healthScore.toFixed(0)} · vibration ${a.signal.vibration.toFixed(2)} mm/s (alarm ${a.thresholds.vibrationAlarm}) · temperature ${a.signal.temperature.toFixed(1)} °C.`,
        severity: "critical",
        refs: { assetIds: [a.id], incidentId: inc.id },
      });
    } else if (a.status === "warning" && prev === "healthy") {
      appendAudit(state, nowISO, {
        category: "telemetry-alert",
        actor: "Telemetry monitor",
        title: `${a.id} entered WARNING state`,
        detail: `Health ${a.healthScore.toFixed(0)} · vibration ${a.signal.vibration.toFixed(2)} mm/s · temperature ${a.signal.temperature.toFixed(1)} °C.`,
        severity: "warning",
        refs: { assetIds: [a.id] },
      });
    }
  }
}

export interface AdvanceOptions {
  nowISO: string;
  /** Record incidents/audit for events (disabled while seeding pre-history). */
  recordEvents?: boolean;
  /** Called before each step (used by the seeder to inject the degradation onset). */
  beforeStep?: (world: SimWorld) => void;
}

/** Advance the live factory by `hours` of simulated time in TICK_HOURS steps. */
export function advanceFactory(state: FactoryState, hours: number, opts: AdvanceOptions) {
  const steps = Math.max(1, Math.round(hours / TICK_HOURS));
  const world = worldFromState(state);
  const recordEvents = opts.recordEvents ?? true;
  for (let i = 0; i < steps; i++) {
    opts.beforeStep?.(world);
    const bucket = Math.floor(world.hour + 1e-9);
    for (const id of Object.keys(world.acc)) world.acc[id] = emptyAcc();
    world.events = [];
    stepWorld(world, TICK_HOURS);
    state.clock.tick += 1;
    mergeProduction(state, world, bucket);

    const before = new Map(state.assets.map((a) => [a.id, a.status] as const));
    const recordHistory = world.hour >= state.clock.lastHistoryHour + HISTORY_STEP_HOURS - 1e-6;
    for (const a of state.assets) {
      const m = world.machines[a.id];
      if (!m) continue;
      const reading = measuredReading(m, state.seed, state.clock.tick, world.hour, world.params.ambient);
      state.latest[a.id] = reading;
      updateDerived(a, reading, m.mode);
      if (recordHistory) (state.telemetry[a.id] ??= []).push(reading);
    }
    if (recordHistory) state.clock.lastHistoryHour = round(world.hour, 6);
    // Line state for derived views
    for (const l of state.lines) l.state = world.lines[l.id]?.state ?? l.state;

    if (recordEvents) {
      state.clock.hour = world.hour;
      handleEvents(state, world, world.events, opts.nowISO);
      handleStatusTransitions(state, before, opts.nowISO);
    }
  }
  writeWorldToState(state, world);
  trimHistory(state);
}

/* ──────────────────────── Trend estimation ──────────────────────── */

export interface TrendEstimate {
  metric: "vibration" | "temperature";
  current: number;
  slopePerHour: number;
  slopeStdErr: number;
  r2: number;
  n: number;
  tStat: number;
  significant: boolean;
  baselineMean: number;
  baselineStd: number;
  zScore: number;
  windowHours: number;
  stepChange: { detected: boolean; size: number; atHour: number | null };
}

/**
 * Estimate the current level and trend of a metric from operating (running) readings.
 * Level = OLS fitted value at the latest timestamp; trend = OLS slope over the window.
 * zScore compares the current level to the asset's baseline (commissioning) value.
 */
export function estimateTrend(
  readings: TelemetryReading[],
  metric: "vibration" | "temperature",
  baselineValue: number,
  windowHours = 6,
): TrendEstimate {
  const running = readings.filter((r) => r.running);
  if (!running.length) {
    return {
      metric,
      current: baselineValue,
      slopePerHour: 0,
      slopeStdErr: Infinity,
      r2: 0,
      n: 0,
      tStat: 0,
      significant: false,
      baselineMean: baselineValue,
      baselineStd: 0,
      zScore: 0,
      windowHours,
      stepChange: { detected: false, size: 0, atHour: null },
    };
  }
  const tEnd = running[running.length - 1].t;
  const win = running.filter((r) => r.t >= tEnd - windowHours);
  const xs = win.map((r) => r.t);
  const ys = win.map((r) => r[metric]);
  const floor = metric === "vibration" ? 0.08 : 0.4;

  // Change-point check: do the most recent readings sit far above the trend fitted on earlier data?
  let fit = linearFit(xs, ys);
  let current: number;
  let stepChange: TrendEstimate["stepChange"] = { detected: false, size: 0, atHour: null };
  const k = Math.min(8, win.length - 8);
  let stepFound = false;
  for (let tail = 1; tail <= k && !stepFound; tail++) {
    const pre = linearFit(xs.slice(0, xs.length - tail), ys.slice(0, ys.length - tail));
    const sigma = Math.max(pre.residualStd, floor);
    const residuals = xs.slice(-tail).map((x, i) => ys[ys.length - tail + i] - (pre.intercept + pre.slope * x));
    const allHigh = residuals.every((r) => r > 4 * sigma);
    const nextIsNormal = tail === k || ys.length - tail - 1 < 0 ? true : ys[ys.length - tail - 1] - (pre.intercept + pre.slope * xs[xs.length - tail - 1]) < 4 * sigma;
    if (allHigh && nextIsNormal) {
      // Step change: keep the pre-change wear rate, shift the level by the mean residual.
      const size = mean(residuals);
      fit = { ...pre, n: xs.length };
      current = pre.intercept + pre.slope * tEnd + size;
      stepChange = { detected: true, size: round(size, 3), atHour: round(xs[xs.length - tail], 3) };
      stepFound = true;
    }
  }
  if (!stepFound) {
    const recent = ys.slice(-3);
    current = fit.n >= 3 ? Math.max(fit.intercept + fit.slope * tEnd, mean(recent) - 2 * fit.residualStd) : mean(recent);
  }
  // Baseline noise level from the earliest readings (or nominal fraction when none).
  const early = running.slice(0, Math.min(18, running.length)).map((r) => r[metric]);
  const noise = Math.max(fit.residualStd, std(early) * 0.5, floor);
  const tStat = Number.isFinite(fit.slopeStdErr) && fit.slopeStdErr > 0 ? fit.slope / fit.slopeStdErr : 0;
  return {
    metric,
    current: round(current!, 3),
    slopePerHour: round(fit.slope, 4),
    slopeStdErr: round(fit.slopeStdErr, 4),
    r2: round(fit.r2, 3),
    n: xs.length,
    tStat: round(tStat, 2),
    significant: tStat > 3 && fit.slope > 0 && fit.r2 > 0.3,
    baselineMean: baselineValue,
    baselineStd: round(noise, 3),
    zScore: round((current! - baselineValue) / noise, 2),
    windowHours,
    stepChange,
  };
}

/** Hours until `trip` is reached at the given slope (Infinity when not trending up). */
export function hoursToThreshold(current: number, slopePerHour: number, threshold: number) {
  if (current >= threshold) return 0;
  if (slopePerHour <= 1e-6) return Infinity;
  return (threshold - current) / slopePerHour;
}

/** Readings for an asset including the latest live reading. */
export function readingsFor(state: FactoryState, assetId: string) {
  const hist = state.telemetry[assetId] ?? [];
  const latest = state.latest[assetId];
  if (latest && (!hist.length || latest.t > hist[hist.length - 1].t + 1e-6)) return [...hist, latest];
  return hist;
}

/**
 * Apply externally ingested measurements (e.g. Pub/Sub). They replace the simulated
 * measurement for the asset; the plant model continues to drive production flows.
 */
export function applyExternalReadings(
  state: FactoryState,
  readings: { assetId: string; vibration?: number; temperature?: number; powerKw?: number; throughput?: number }[],
) {
  let applied = 0;
  for (const r of readings) {
    const asset = state.assets.find((a) => a.id === r.assetId);
    if (!asset) continue;
    const prev = state.latest[asset.id];
    const reading: TelemetryReading = {
      t: round(state.clock.hour, 4),
      vibration: Number.isFinite(r.vibration) ? Number(r.vibration) : (prev?.vibration ?? asset.signal.vibration),
      temperature: Number.isFinite(r.temperature) ? Number(r.temperature) : (prev?.temperature ?? asset.signal.temperature),
      powerKw: Number.isFinite(r.powerKw) ? Number(r.powerKw) : (prev?.powerKw ?? asset.signal.powerKw),
      speedPct: asset.mode === "running" ? asset.speedPct : 0,
      throughput: Number.isFinite(r.throughput) ? Number(r.throughput) : (prev?.throughput ?? asset.signal.throughput),
      running: asset.mode === "running",
    };
    state.latest[asset.id] = reading;
    updateDerived(asset, reading, asset.mode);
    (state.telemetry[asset.id] ??= []).push(reading);
    applied++;
  }
  trimHistory(state);
  return applied;
}
