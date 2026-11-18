import type { FactoryState } from "./types";

/**
 * Per-product transport along one line: a discrete flow model with individual units.
 *
 * A source releases units (product mix from the line's allocation); conveyors carry them at belt
 * speed and they queue nose to tail; each machine takes one unit at a time and holds it for its
 * cycle time (from nameplate rate and commanded speed); a photo-eye before every machine counts
 * units and reports blockage; a sink at the end counts finished units per product.
 * A machine is *starved* when it waits for a unit, *blocked* when its finished unit can't leave,
 * and *down* when it is tripped or in maintenance. Deterministic: same inputs, same run.
 */

export const PITCH = 0.45; // m between unit centres when queued
export const SPACING = 3; // m between machines
const ENTRY = 1.5; // m from the source to the first machine
const EYE = 0.35; // m before a machine where its photo-eye sits
const BELT_MPS = 0.45; // conveyor speed at nameplate

export interface TransportStation {
  assetId: string;
  name: string;
  x: number;
  cycleS: number;
  up: boolean;
  /** Unit being processed (or finished and waiting to leave). */
  unitId: number | null;
  doneAt: number;
  processed: number;
  busyS: number;
  blockedS: number;
  starvedS: number;
}

export interface TransportSensor {
  id: string;
  assetId: string;
  x: number;
  count: number;
  /** Seconds the beam has been continuously interrupted (a unit sitting in front of it). */
  coveredS: number;
}

export interface TransportUnit {
  id: number;
  productId: string;
  x: number;
  /** Index of the next machine this unit must visit (stations.length once all are done). */
  next: number;
  /** Station index while inside a machine, else null. */
  at: number | null;
  createdAt: number;
}

export interface TransportSim {
  lineId: string;
  t: number;
  length: number;
  beltMps: number;
  running: boolean;
  sourceEveryS: number;
  nextReleaseAt: number;
  stations: TransportStation[];
  sensors: TransportSensor[];
  units: TransportUnit[];
  created: number;
  sunk: Record<string, number>;
  /** Total time units spent in the line, for lead time. */
  leadTimeSum: number;
  /** Weighted round-robin product mix. */
  mix: { productId: string; share: number; credit: number }[];
}

export type StationState = "working" | "blocked" | "starved" | "down";

function cycleOf(nominalRate: number, speedPct: number) {
  const rate = Math.max(1, nominalRate * Math.max(0.05, speedPct / 100));
  return 3600 / rate;
}

/** Build the transport model for a line from the twin's current state. */
export function createTransport(state: FactoryState, lineId: string): TransportSim {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) throw new Error(`Unknown line ${lineId}`);
  const machines = line.assetIds.map((id) => state.assets.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);
  const stations: TransportStation[] = machines.map((a, i) => ({
    assetId: a.id,
    name: a.name,
    x: ENTRY + i * SPACING,
    cycleS: cycleOf(a.nominalRate, a.speedPct),
    up: a.mode === "running",
    unitId: null,
    doneAt: 0,
    processed: 0,
    busyS: 0,
    blockedS: 0,
    starvedS: 0,
  }));
  const mixEntries = Object.entries(line.allocation).filter(([, v]) => v > 0);
  const total = mixEntries.reduce((s, [, v]) => s + v, 0) || 1;
  const sim: TransportSim = {
    lineId,
    t: 0,
    length: ENTRY + Math.max(0, stations.length - 1) * SPACING + 1.5,
    beltMps: BELT_MPS,
    running: line.state !== "down",
    sourceEveryS: 0,
    nextReleaseAt: 0,
    stations,
    sensors: stations.map((st) => ({ id: `${st.assetId}.Eye`, assetId: st.assetId, x: st.x - EYE, count: 0, coveredS: 0 })),
    units: [],
    created: 0,
    sunk: {},
    leadTimeSum: 0,
    mix: (mixEntries.length ? mixEntries : [["unit", 1] as [string, number]]).map(([productId, v]) => ({ productId, share: v / total, credit: 0 })),
  };
  // The source feeds slightly faster than the first machine can take, so a queue forms in front of it.
  sim.sourceEveryS = (stations[0]?.cycleS ?? 10) / 1.05;
  return sim;
}

/** Follow changes in the twin (speed setpoints, trips, maintenance, line stops) without resetting counts. */
export function syncTransport(sim: TransportSim, state: FactoryState) {
  const line = state.lines.find((l) => l.id === sim.lineId);
  if (line) sim.running = line.state !== "down";
  for (const st of sim.stations) {
    const a = state.assets.find((x) => x.id === st.assetId);
    if (!a) continue;
    st.up = a.mode === "running";
    st.cycleS = cycleOf(a.nominalRate, a.speedPct);
  }
  sim.sourceEveryS = (sim.stations[0]?.cycleS ?? 10) / 1.05;
}

function pickProduct(sim: TransportSim): string {
  for (const m of sim.mix) m.credit += m.share;
  let best = sim.mix[0];
  for (const m of sim.mix) if (m.credit > best.credit) best = m;
  best.credit -= 1;
  return best.productId;
}

/** Advance the model by `dt` seconds (internally in steps of at most 0.05 s). */
export function stepTransport(sim: TransportSim, dt: number) {
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(0.05, left);
    tick(sim, h);
    left -= h;
  }
}

function tick(sim: TransportSim, h: number) {
  sim.t += h;
  const v = sim.running ? sim.beltMps : 0;
  // Units are kept oldest (furthest along) first; nobody overtakes.
  for (let i = 0; i < sim.units.length; i++) {
    const u = sim.units[i];
    const ahead = i > 0 ? sim.units[i - 1] : null;
    if (u.at !== null) {
      const st = sim.stations[u.at];
      // A machine that is down holds its unit; the cycle resumes where it stopped.
      if (!st.up) {
        st.doneAt += h;
        continue;
      }
      if (sim.t < st.doneAt) continue;
      // Finished: leave onto the belt if there is room downstream.
      if (!ahead || ahead.x - st.x >= PITCH) {
        st.unitId = null;
        st.processed++;
        u.at = null;
        u.next++;
      }
      continue;
    }
    const nextSt = u.next < sim.stations.length ? sim.stations[u.next] : null;
    let limit = nextSt ? nextSt.x : sim.length + 1;
    if (ahead) limit = Math.min(limit, ahead.x - PITCH);
    const before = u.x;
    u.x = Math.max(u.x, Math.min(limit, u.x + v * h));
    // Photo-eyes count each unit once as its front crosses the beam.
    for (const s of sim.sensors) if (before < s.x && u.x >= s.x) s.count++;
    if (nextSt && u.x >= nextSt.x - 1e-6 && nextSt.up && nextSt.unitId === null) {
      u.x = nextSt.x;
      u.at = u.next;
      nextSt.unitId = u.id;
      nextSt.doneAt = sim.t + nextSt.cycleS;
    }
  }
  // Sink.
  while (sim.units.length && sim.units[0].at === null && sim.units[0].x >= sim.length) {
    const u = sim.units.shift()!;
    sim.sunk[u.productId] = (sim.sunk[u.productId] ?? 0) + 1;
    sim.leadTimeSum += sim.t - u.createdAt;
  }
  // Source: release when due and the entry is clear.
  const last = sim.units[sim.units.length - 1];
  if (sim.running && sim.t >= sim.nextReleaseAt && (!last || last.x >= PITCH)) {
    sim.units.push({ id: ++sim.created, productId: pickProduct(sim), x: 0, next: 0, at: null, createdAt: sim.t });
    sim.nextReleaseAt = sim.t + sim.sourceEveryS;
  }
  // Station and sensor statistics.
  for (const st of sim.stations) {
    const s = stationState(sim, st);
    if (s === "working") st.busyS += h;
    else if (s === "blocked") st.blockedS += h;
    else if (s === "starved") st.starvedS += h;
  }
  for (const s of sim.sensors) {
    const covered = sim.units.some((u) => u.at === null && Math.abs(u.x - s.x) <= PITCH / 2);
    s.coveredS = covered ? s.coveredS + h : 0;
  }
}

export function stationState(sim: TransportSim, st: TransportStation): StationState {
  if (!st.up) return "down";
  if (st.unitId === null) return "starved";
  return sim.t >= st.doneAt ? "blocked" : "working";
}

export interface TransportStats {
  seconds: number;
  created: number;
  wip: number;
  finished: number;
  finishedByProduct: Record<string, number>;
  ratePerHour: number;
  avgLeadTimeS: number | null;
  stations: { assetId: string; name: string; state: StationState; processed: number; utilisationPct: number; blockedPct: number; starvedPct: number }[];
  sensors: { id: string; count: number; blocked: boolean }[];
  bottleneck: string | null;
}

export function transportStats(sim: TransportSim): TransportStats {
  const finished = Object.values(sim.sunk).reduce((s, n) => s + n, 0);
  const pct = (x: number) => (sim.t > 0 ? Math.round((x / sim.t) * 1000) / 10 : 0);
  const stations = sim.stations.map((st) => ({ assetId: st.assetId, name: st.name, state: stationState(sim, st), processed: st.processed, utilisationPct: pct(st.busyS), blockedPct: pct(st.blockedS), starvedPct: pct(st.starvedS) }));
  const busiest = [...stations].sort((a, b) => b.utilisationPct - a.utilisationPct)[0];
  return {
    seconds: Math.round(sim.t * 10) / 10,
    created: sim.created,
    wip: sim.units.length,
    finished,
    finishedByProduct: { ...sim.sunk },
    ratePerHour: sim.t > 0 ? Math.round((finished / sim.t) * 3600) : 0,
    avgLeadTimeS: finished ? Math.round((sim.leadTimeSum / finished) * 10) / 10 : null,
    stations,
    sensors: sim.sensors.map((s) => ({ id: s.id, count: s.count, blocked: s.coveredS > 2 })),
    bottleneck: busiest && busiest.utilisationPct > 0 ? busiest.assetId : null,
  };
}
