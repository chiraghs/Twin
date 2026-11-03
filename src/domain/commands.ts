/** State-changing commands invoked by the API layer. Pure functions over FactoryState. */
import { machineTemplate } from "./archetypes";
import { appendAudit } from "./audit";
import { TICK_HOURS, TICK_INTERVAL_MS } from "./constants";
import { DomainError } from "./errors";
import { nextId } from "./ids";
import { round } from "./math";
import { runMaintenanceRules } from "./rules";
import { advanceFactory } from "./telemetry";
import type { Asset, AssetKind, FactoryState } from "./types";

export const FAULT_MODES = ["bearing-wear", "overheating", "failure", "restore"] as const;
export type FaultMode = (typeof FAULT_MODES)[number];

export interface FaultInput {
  assetId: string;
  mode: FaultMode;
  severity: number; // 0-100
}

/**
 * Fault injection (simulation control). Modifies the asset's physical condition; the effect
 * appears in telemetry and propagates through status, incidents and agents like any real event.
 */
export function injectFault(state: FactoryState, input: FaultInput, nowISO: string) {
  const asset = state.assets.find((a) => a.id === input.assetId);
  if (!asset) throw new DomainError(`Asset ${input.assetId} not found`, 404);
  const sev = Math.max(0, Math.min(100, input.severity)) / 100;
  const c = asset.condition;
  let detail = "";
  if (input.mode === "bearing-wear") {
    if (asset.mode !== "running") throw new DomainError(`${asset.id} is not running`, 409);
    const step = round(0.6 + 2.0 * sev, 2);
    c.vibrationExcess += step;
    c.vibrationSlope = round(Math.max(c.vibrationSlope, 0.08 + 0.3 * sev), 3);
    c.temperatureExcess += round(1 + 4 * sev, 2);
    c.temperatureSlope = round(Math.max(c.temperatureSlope, 0.15 + 0.5 * sev), 3);
    c.failureMode = machineTemplate(asset.kind).failureMode;
    detail = `Bearing damage injected: +${step} mm/s step, wear rate ≥ ${c.vibrationSlope} mm/s/h.`;
  } else if (input.mode === "overheating") {
    if (asset.mode !== "running") throw new DomainError(`${asset.id} is not running`, 409);
    const step = round(4 + 10 * sev, 1);
    c.temperatureExcess += step;
    c.temperatureSlope = round(Math.max(c.temperatureSlope, 0.6 + 2.2 * sev), 2);
    c.failureMode = "Cooling degradation / overheating";
    detail = `Overheating injected: +${step} °C, drift ${c.temperatureSlope} °C/h.`;
  } else if (input.mode === "failure") {
    if (asset.mode === "down") throw new DomainError(`${asset.id} is already down`, 409);
    asset.mode = "down";
    asset.maintenanceUntil = null;
    asset.downUntil = round(state.clock.hour + state.costModel.unplannedRepairHours, 4);
    c.failureMode = c.failureMode ?? "Forced trip (fault injection)";
    detail = `Forced trip: unplanned stop, repair estimated ${state.costModel.unplannedRepairHours} h.`;
  } else {
    c.vibrationExcess = 0;
    c.vibrationSlope = 0;
    c.temperatureExcess = 0;
    c.temperatureSlope = 0;
    c.failureMode = null;
    if (asset.mode === "down") {
      asset.mode = "running";
      asset.downUntil = null;
    }
    asset.signal.vibration = asset.baseline.vibration;
    asset.signal.temperature = asset.baseline.temperature;
    detail = "Condition reset to baseline (not a maintenance action).";
  }
  appendAudit(state, nowISO, {
    category: "system",
    actor: "Operator · demo controls",
    title: `Fault injection on ${asset.id}: ${input.mode}`,
    detail,
    severity: input.mode === "restore" ? "info" : "warning",
    refs: { assetIds: [asset.id] },
  });
  // Advance one tick so the change is reflected in measured telemetry and status.
  advanceFactory(state, TICK_HOURS, { nowISO });
  runMaintenanceRules(state, nowISO);
  if (input.mode === "restore") {
    for (const inc of state.incidents) {
      if (inc.assetId === asset.id && inc.status !== "resolved") {
        inc.status = "resolved";
        inc.resolvedHour = state.clock.hour;
      }
    }
  }
  return asset;
}

/** Throttled live tick: advances one step only if enough wall-clock time has passed. */
export function liveTick(state: FactoryState, nowMs: number, nowISO: string) {
  if (!state.clock.liveTelemetry) return false;
  if (nowMs - state.clock.lastTickAt < TICK_INTERVAL_MS * 0.8) return false;
  state.clock.lastTickAt = nowMs;
  advanceFactory(state, TICK_HOURS, { nowISO });
  runMaintenanceRules(state, nowISO);
  return true;
}

export function fastForward(state: FactoryState, hours: number, nowISO: string) {
  if (!(hours > 0 && hours <= 24)) throw new DomainError("hours must be between 0 and 24");
  advanceFactory(state, hours, { nowISO });
  runMaintenanceRules(state, nowISO);
  appendAudit(state, nowISO, {
    category: "system",
    actor: "Operator · demo controls",
    title: `Simulation fast-forwarded ${hours} h`,
    detail: `Plant model advanced to h+${state.clock.hour.toFixed(1)}.`,
    severity: "info",
    refs: {},
  });
}

export interface NewAssetInput {
  lineId: string;
  kind: AssetKind;
  name?: string;
  position?: number; // insert index in line flow
}

export function addAsset(state: FactoryState, input: NewAssetInput, nowISO: string): Asset {
  const line = state.lines.find((l) => l.id === input.lineId);
  if (!line) throw new DomainError(`Line ${input.lineId} not found`, 404);
  const t = machineTemplate(input.kind);
  if (!t) throw new DomainError(`Unknown asset kind ${input.kind}`);
  let id = `${line.code}-${t.code}-${String(line.assetIds.length + 1).padStart(2, "0")}`;
  while (state.assets.some((a) => a.id === id)) id = `${id}X`;
  const asset: Asset = {
    id,
    name: input.name?.trim() || `${t.label} ${line.code}${line.assetIds.length + 1}`,
    kind: input.kind,
    lineId: line.id,
    manufacturer: t.manufacturer,
    model: t.model,
    criticality: t.criticality,
    mode: "running",
    speedPct: 100,
    nominalRate: Math.max(t.nominalRate, ...line.capabilities.map((c) => c.ratePerHour)),
    ratedPowerKw: t.ratedPowerKw,
    idlePowerKw: t.idlePowerKw,
    baseline: { ...t.baseline },
    thresholds: { ...t.thresholds },
    condition: { vibrationExcess: 0, vibrationSlope: 0, temperatureExcess: 0, temperatureSlope: 0, failureMode: null },
    sensors: t.sensors.map((s, i) => ({ ...s, id: `${id}-S${i + 1}` })),
    installedYear: 2026,
    lastMaintenanceHour: Math.floor(state.clock.hour),
    maintenanceIntervalHours: t.maintenanceIntervalHours,
    downUntil: null,
    maintenanceUntil: null,
    signal: { vibration: t.baseline.vibration, temperature: t.baseline.temperature, powerKw: t.idlePowerKw, throughput: 0 },
    status: "healthy",
    healthScore: 100,
    utilization: 0,
    documentIds: [],
    custom: true,
  };
  state.assets.push(asset);
  const idx = input.position === undefined ? line.assetIds.length : Math.max(0, Math.min(line.assetIds.length, input.position));
  line.assetIds.splice(idx, 0, asset.id);
  state.telemetry[asset.id] = [];
  appendAudit(state, nowISO, {
    category: "asset",
    actor: "Operator",
    title: `Asset ${asset.id} added to ${line.name}`,
    detail: `${asset.name} (${t.model}) inserted at position ${idx + 1} of the line flow. Nameplate ${asset.nominalRate} u/h.`,
    severity: "info",
    refs: { assetIds: [asset.id] },
  });
  return asset;
}

export interface AssetPatch {
  name?: string;
  speedPct?: number;
  nominalRate?: number;
  criticality?: Asset["criticality"];
  vibrationAlarm?: number;
  temperatureAlarm?: number;
}

export function updateAsset(state: FactoryState, id: string, patch: AssetPatch, nowISO: string): Asset {
  const asset = state.assets.find((a) => a.id === id);
  if (!asset) throw new DomainError(`Asset ${id} not found`, 404);
  const changes: string[] = [];
  if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== asset.name) {
    changes.push(`name "${asset.name}" → "${patch.name.trim()}"`);
    asset.name = patch.name.trim();
  }
  if (patch.speedPct !== undefined && patch.speedPct !== asset.speedPct) {
    if (patch.speedPct < 30 || patch.speedPct > 110) throw new DomainError("speedPct must be between 30 and 110");
    changes.push(`speed ${asset.speedPct}% → ${patch.speedPct}%`);
    asset.speedPct = patch.speedPct;
  }
  if (patch.nominalRate !== undefined && patch.nominalRate !== asset.nominalRate) {
    if (patch.nominalRate < 10 || patch.nominalRate > 1000) throw new DomainError("nominalRate must be between 10 and 1000");
    changes.push(`nameplate ${asset.nominalRate} → ${patch.nominalRate} u/h`);
    asset.nominalRate = patch.nominalRate;
  }
  if (patch.criticality && patch.criticality !== asset.criticality) {
    changes.push(`criticality ${asset.criticality} → ${patch.criticality}`);
    asset.criticality = patch.criticality;
  }
  if (patch.vibrationAlarm !== undefined && patch.vibrationAlarm !== asset.thresholds.vibrationAlarm) {
    if (patch.vibrationAlarm <= asset.baseline.vibration || patch.vibrationAlarm >= asset.thresholds.vibrationTrip)
      throw new DomainError("vibrationAlarm must be between baseline and trip");
    changes.push(`vibration alarm ${asset.thresholds.vibrationAlarm} → ${patch.vibrationAlarm} mm/s`);
    asset.thresholds.vibrationAlarm = patch.vibrationAlarm;
  }
  if (patch.temperatureAlarm !== undefined && patch.temperatureAlarm !== asset.thresholds.temperatureAlarm) {
    if (patch.temperatureAlarm <= asset.baseline.temperature || patch.temperatureAlarm >= asset.thresholds.temperatureTrip)
      throw new DomainError("temperatureAlarm must be between baseline and trip");
    changes.push(`temperature alarm ${asset.thresholds.temperatureAlarm} → ${patch.temperatureAlarm} °C`);
    asset.thresholds.temperatureAlarm = patch.temperatureAlarm;
  }
  if (changes.length) {
    appendAudit(state, nowISO, {
      category: "asset",
      actor: "Operator",
      title: `Asset ${asset.id} updated`,
      detail: changes.join("; "),
      severity: "info",
      refs: { assetIds: [asset.id] },
    });
  }
  return asset;
}

export function connectNodes(state: FactoryState, source: string, target: string, nowISO: string) {
  if (source === target) throw new DomainError("Cannot connect a node to itself");
  const known = new Set<string>([
    ...state.assets.map((a) => a.id),
    ...state.inventory.map((i) => `inv:${i.id}`),
    ...state.orders.map((o) => `ord:${o.id}`),
  ]);
  if (!known.has(source) || !known.has(target)) throw new DomainError("Unknown node in connection", 404);
  if (state.connections.some((c) => c.source === source && c.target === target)) throw new DomainError("Connection already exists", 409);
  const conn = { id: nextId(state, "CON", 100), source, target, kind: source.startsWith("inv:") ? ("supply" as const) : ("flow" as const) };
  state.connections.push(conn);
  appendAudit(state, nowISO, {
    category: "asset",
    actor: "Operator",
    title: `Dependency added: ${source} → ${target}`,
    detail: "User-defined dependency recorded in the twin topology.",
    severity: "info",
    refs: { assetIds: [source, target].filter((x) => !x.includes(":")) },
  });
  return conn;
}

export function setLiveTelemetry(state: FactoryState, enabled: boolean, nowISO: string) {
  if (state.clock.liveTelemetry === enabled) return;
  state.clock.liveTelemetry = enabled;
  appendAudit(state, nowISO, {
    category: "system",
    actor: "Operator",
    title: enabled ? "Live telemetry simulation started" : "Live telemetry simulation paused",
    detail: enabled ? "Live telemetry resumed: 2 min of plant time every 4 s." : "Plant clock paused; nothing changes until it resumes.",
    severity: "info",
    refs: {},
  });
}
