/**
 * Live operating view of the twin: what the 3D view, the alarm list and the commissioning page show.
 * Pure functions of the factory state, so the browser and the server agree on every value.
 */
import { round } from "./math";
import { MACHINE_STATE_CODE, cycleTime, electrical, machineStates, partCounts, processValues, remainingLife } from "./process-signals";
import type { Asset, FactoryState } from "./types";

const STOPPED = new Set(["down", "maintenance", "changeover", "idle"]);

/**
 * How fast product moves on a line, relative to its nameplate rate (0 = stopped, 1 = nameplate).
 * The slowest running machine sets the pace; a stopped line is 0.
 */
export function lineFlow(state: FactoryState, lineId: string): number {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line || STOPPED.has(line.state)) return 0;
  const ratios = line.assetIds
    .map((id) => state.assets.find((a) => a.id === id))
    .filter((a): a is Asset => !!a && a.mode === "running" && a.nominalRate > 0)
    .map((a) => a.signal.throughput / a.nominalRate);
  if (!ratios.length) return 0;
  return round(Math.min(1.3, Math.max(0.12, Math.min(...ratios))), 3);
}

export const lineFlows = (state: FactoryState) => Object.fromEntries(state.lines.map((l) => [l.id, lineFlow(state, l.id)]));

/** Good units a line produced over the last `hours` of plant time (its end-of-line counter). */
export function lineOutput(state: FactoryState, lineId: string, hours = 8): number {
  const since = state.clock.hour - hours;
  return Math.round(state.production.filter((r) => r.lineId === lineId && r.hour >= since).reduce((s, r) => s + r.goodUnits, 0));
}

/* ─────────────────────────── signals ─────────────────────────── */

export type SignalCommand = "speed" | "trip" | "restore";

export interface LiveSignal {
  id: string;
  assetId: string;
  name: string;
  kind: "bool" | "number";
  value: number | boolean;
  unit: string;
  /** Alarm / trip limits for numeric signals. */
  limits?: { alarm: number; trip: number };
  state: "ok" | "alarm" | "trip";
  /** The command that changes this signal in commissioning mode, if any. */
  command?: SignalCommand;
  /** Enumerated signals (machine state): the value is a code, this is its meaning. */
  text?: string;
  /** Grouping for display: run, measured, electrical, process, quality, prediction. */
  group?: "run" | "measured" | "electrical" | "process" | "quality" | "prediction";
}

/** Signals that are cheap to compute every frame; `full` adds the prediction (trend fit). */
export interface SignalOptions {
  full?: boolean;
}

/** The signals one machine exposes: run state, setpoint and the measured values. */
export function assetSignals(state: FactoryState, asset: Asset, opts: SignalOptions = { full: true }): LiveSignal[] {
  const s = asset.signal;
  const t = asset.thresholds;
  const level = (v: number, alarm: number, trip: number): LiveSignal["state"] => (v >= trip ? "trip" : v >= alarm ? "alarm" : "ok");
  const id = (k: string) => `${asset.id}.${k}`;
  const running = asset.mode === "running";
  const out: LiveSignal[] = [
    { id: id("Running"), assetId: asset.id, name: "Running", kind: "bool", value: running, unit: "", state: running ? "ok" : asset.mode === "down" ? "trip" : "alarm", command: running ? "trip" : "restore" },
    { id: id("Fault"), assetId: asset.id, name: "Fault", kind: "bool", value: asset.mode === "down", unit: "", state: asset.mode === "down" ? "trip" : "ok", command: asset.mode === "down" ? "restore" : "trip" },
    { id: id("SpeedSetpoint"), assetId: asset.id, name: "Speed setpoint", kind: "number", value: asset.speedPct, unit: "%", state: "ok", command: "speed" },
    { id: id("Throughput"), assetId: asset.id, name: "Throughput", kind: "number", value: round(s.throughput, 1), unit: "u/h", state: "ok" },
    { id: id("Vibration"), assetId: asset.id, name: "Vibration", kind: "number", value: round(s.vibration, 2), unit: "mm/s", limits: { alarm: t.vibrationAlarm, trip: t.vibrationTrip }, state: level(s.vibration, t.vibrationAlarm, t.vibrationTrip) },
    { id: id("Temperature"), assetId: asset.id, name: "Temperature", kind: "number", value: round(s.temperature, 1), unit: "°C", limits: { alarm: t.temperatureAlarm, trip: t.temperatureTrip }, state: level(s.temperature, t.temperatureAlarm, t.temperatureTrip) },
    { id: id("Power"), assetId: asset.id, name: "Power", kind: "number", value: round(s.powerKw, 2), unit: "kW", state: "ok" },
    { id: id("Health"), assetId: asset.id, name: "Health score", kind: "number", value: round(asset.healthScore, 1), unit: "/100", state: asset.healthScore < 40 ? "trip" : asset.healthScore < 70 ? "alarm" : "ok" },
  ];
  const line = state.lines.find((l) => l.assetIds[l.assetIds.length - 1] === asset.id);
  if (line) out.push({ id: id("OutputCount"), assetId: asset.id, name: "Line output (8 h)", kind: "number", value: lineOutput(state, line.id), unit: "units", state: "ok" });

  const ms = machineStates(state)[asset.id];
  if (ms) {
    const st: LiveSignal["state"] = ms.state === "fault" ? "trip" : ms.state === "running" || ms.state === "maintenance" || ms.state === "changeover" ? "ok" : "alarm";
    out.push({ id: id("State"), assetId: asset.id, name: "Machine state", kind: "number", value: MACHINE_STATE_CODE[ms.state], unit: "", text: ms.state, state: st, group: "run" });
  }
  const ct = cycleTime(asset);
  out.push({ id: id("CycleTime"), assetId: asset.id, name: "Cycle time", kind: "number", value: ct.actualS ?? 0, unit: "s", state: ct.lossPct !== null && ct.lossPct > 25 && ms?.bottleneck ? "alarm" : "ok", text: ct.actualS === null ? "not producing" : `ideal ${ct.idealS} s`, group: "measured" });
  const e = electrical(state, asset);
  out.push(
    { id: id("Current"), assetId: asset.id, name: "Motor current", kind: "number", value: e.currentA, unit: "A", state: "ok", group: "electrical" },
    { id: id("Voltage"), assetId: asset.id, name: "Supply voltage", kind: "number", value: e.voltageV, unit: "V", limits: { alarm: 420, trip: 440 }, state: level(e.voltageV, 420, 440), group: "electrical" },
    { id: id("PowerFactor"), assetId: asset.id, name: "Power factor", kind: "number", value: e.powerFactor, unit: "", state: e.powerFactor < 0.7 && asset.mode === "running" ? "alarm" : "ok", group: "electrical" },
  );
  for (const p of processValues(state, asset)) {
    out.push({ id: id(p.key), assetId: asset.id, name: p.name, kind: "number", value: p.value, unit: p.unit, ...(p.limits ? { limits: p.limits, state: level(p.value, p.limits.alarm, p.limits.trip) } : { state: "ok" as const }), group: "process" });
  }
  const pc = partCounts(state);
  out.push({ id: id("RejectCount"), assetId: asset.id, name: "Rejects caused (8 h)", kind: "number", value: pc.byMachine[asset.id] ?? 0, unit: "units", state: (pc.byMachine[asset.id] ?? 0) > 20 ? "alarm" : "ok", group: "quality" });
  if (opts.full) {
    const rul = remainingLife(state, asset);
    out.push({ id: id("HoursToTrip"), assetId: asset.id, name: "Remaining useful life", kind: "number", value: rul.hoursToTrip ?? -1, unit: "h", text: rul.summary, state: rul.tone === "bad" ? "trip" : rul.tone === "warn" ? "alarm" : "ok", group: "prediction" });
  }
  return out;
}

/* ─────────────────────────── alarms ─────────────────────────── */

export interface LiveAlarm {
  id: string;
  assetId: string;
  severity: "warning" | "critical";
  title: string;
  /** Plant hour the alarm started (open incident) or now (live limit breach). */
  sinceHour: number;
  source: "incident" | "limit";
  /** Incident alarms: someone has acknowledged it (status past "open"). */
  acknowledged?: boolean;
}

/** Open incidents first, then machines currently above an alarm limit without an incident. */
export function activeAlarms(state: FactoryState): LiveAlarm[] {
  const out: LiveAlarm[] = [];
  const covered = new Set<string>();
  for (const i of state.incidents) {
    if (i.status === "resolved") continue;
    covered.add(i.assetId);
    out.push({ id: i.id, assetId: i.assetId, severity: i.severity, title: i.title, sinceHour: i.openedHour, source: "incident", acknowledged: i.status !== "open" });
  }
  for (const a of state.assets) {
    if (covered.has(a.id)) continue;
    for (const sig of assetSignals(state, a, { full: false })) {
      // Alarms come from the measured condition limits; derived process values inform, they don't alarm.
      if (sig.state === "ok" || !sig.limits || sig.group) continue;
      out.push({ id: `${sig.id}:${sig.state}`, assetId: a.id, severity: sig.state === "trip" ? "critical" : "warning", title: `${a.name}: ${sig.name.toLowerCase()} ${sig.value} ${sig.unit} (${sig.state} limit ${sig.state === "trip" ? sig.limits.trip : sig.limits.alarm})`, sinceHour: state.clock.hour, source: "limit" });
    }
    if (a.mode === "down") out.push({ id: `${a.id}:down`, assetId: a.id, severity: "critical", title: `${a.name} is down`, sinceHour: state.clock.hour, source: "limit" });
  }
  const rank = { critical: 0, warning: 1 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity] || x.sinceHour - y.sinceHour);
}

/** What the twin knows for certain, so the answer about the picture stays grounded in real state. */
export function viewContext(s: FactoryState): string {
  const lines = s.lines.map((l) => `- ${l.id} ${l.name}: ${l.state}, pace ${Math.round(lineFlow(s, l.id) * 100)}% of nominal; machines ${l.assetIds.join(", ")}`);
  const st = machineStates(s);
  const machines = s.assets.map((a) => {
    const m = st[a.id];
    const rul = remainingLife(s, a);
    return `- ${a.id} ${a.name} (${a.kind}, ${a.lineId}): ${a.status}, ${m ? `${m.state} (${m.reason})` : a.mode}, health ${a.healthScore.toFixed(0)}, vibration ${a.signal.vibration.toFixed(1)} mm/s, ${a.signal.temperature.toFixed(0)} °C, ${a.signal.powerKw.toFixed(1)} kW; ${rul.summary}`;
  });
  const alarms = activeAlarms(s).map((x) => `- ${x.severity} ${x.assetId}: ${x.title}`);
  return [`Plant: ${s.profile.name}`, "Lines:", ...lines, "Machines:", ...machines, alarms.length ? "Active alarms:" : "No active alarms.", ...alarms].join("\n");
}
