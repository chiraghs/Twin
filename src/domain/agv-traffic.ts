/**
 * Mobile-robot traffic on the plant's aisle network, with zone control.
 *
 * The floor is divided into square zones (1 layout unit ≈ 2 m). Each robot drives its route out
 * to the far dock and back, dwelling at both ends to load and unload. Before entering the next
 * zone a robot must reserve it: aisles are two-way (one lane per direction), so a robot is held
 * by a robot ahead in its own lane, or by crossing traffic inside the zone. Robots pace
 * themselves to their required trips per hour and wait at their home dock when ahead.
 * Circular waits (deadlocks) are detected and broken by letting the lowest-id robot through;
 * each one is counted. Deterministic: same inputs, same result.
 */

export const ZONE = 1; // layout units per zone
export const UNIT_M = 2; // metres per layout unit
const DWELL_S = 20; // load / unload at each dock

export interface TrafficRobotInput {
  id: string;
  fleetId: string;
  points: [number, number][];
  speedMps: number;
  tripsPerHour: number;
  active: boolean;
  /** 0..1 offset along the cycle so robots of a fleet start spread out. */
  phase: number;
}

type Heading = "E" | "W" | "N" | "S" | "-";
interface Cell {
  key: string;
  zone: string;
  x: number;
  y: number;
  heading: Heading;
}

interface RobotState {
  input: TrafficRobotInput;
  route: Cell[]; // out and back, as zone cells
  i: number; // current cell index
  progress: number; // 0..1 within the current cell
  dwellUntil: number;
  waitingFor: string | null; // robot id it's held by
  waitS: number;
  trips: number;
  tripStart: number;
  tripTimes: number[];
  nextDeparture: number;
}

export interface ZoneStats {
  zone: string;
  x: number;
  y: number;
  occupiedS: number;
  waitS: number;
  robots: number;
}

export interface TrafficResult {
  seconds: number;
  zones: ZoneStats[];
  robots: { id: string; fleetId: string; trips: number; tripsPerHour: number; requiredPerHour: number; avgTripS: number | null; waitPct: number; active: boolean }[];
  deadlocksBroken: number;
  totalWaitS: number;
  hotspots: ZoneStats[];
  docks: { zone: string; x: number; y: number }[];
}

const zoneOf = (x: number, y: number) => `${Math.floor(x / ZONE)}:${Math.floor(y / ZONE)}`;

function heading(dx: number, dy: number): Heading {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return "-";
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "E" : "W") : dy > 0 ? "S" : "N";
}
const opposite: Record<Heading, Heading> = { E: "W", W: "E", N: "S", S: "N", "-": "-" };
const axis = (h: Heading) => (h === "E" || h === "W" ? "x" : h === "N" || h === "S" ? "y" : "-");

/** The zone cells a polyline passes through, in order, with the travel heading in each. */
export function routeCells(points: [number, number][]): Cell[] {
  const out: Cell[] = [];
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1];
    const [x1, y1] = points[k];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const h = heading(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(len / (ZONE / 4)));
    for (let j = 0; j <= n; j++) {
      const x = x0 + ((x1 - x0) * j) / n;
      const y = y0 + ((y1 - y0) * j) / n;
      const z = zoneOf(x, y);
      if (out.length && out[out.length - 1].zone === z) continue;
      const [zx, zy] = z.split(":").map(Number);
      out.push({ key: `${z}:${h}`, zone: z, x: (zx + 0.5) * ZONE, y: (zy + 0.5) * ZONE, heading: h });
    }
  }
  return out;
}

function makeRobot(input: TrafficRobotInput): RobotState {
  const out = routeCells(input.points);
  const back = routeCells([...input.points].reverse());
  const route = [...out, ...back.slice(1)];
  const cyc = input.tripsPerHour > 0 ? 3600 / input.tripsPerHour : Infinity;
  const startAt = Number.isFinite(cyc) ? input.phase * Math.min(cyc, 600) : 0;
  return { input, route, i: 0, progress: 0, dwellUntil: startAt, waitingFor: null, waitS: 0, trips: 0, tripStart: startAt, tripTimes: [], nextDeparture: startAt };
}

/** Is `cell` free for robot `r` given where every other robot is? Returns the blocking robot id. */
function blocker(r: RobotState, cell: Cell, all: RobotState[], overrides: Set<string>): string | null {
  if (overrides.has(r.input.id)) return null;
  for (const o of all) {
    if (o === r || !o.input.active) continue;
    const c = o.route[o.i];
    if (!c || c.zone !== cell.zone) continue;
    // Same lane (same heading) or crossing traffic blocks; the opposite lane doesn't.
    if (c.heading === cell.heading || (axis(c.heading) !== axis(cell.heading) && c.heading !== "-" && cell.heading !== "-")) return o.input.id;
    if (c.heading === opposite[cell.heading]) continue;
  }
  return null;
}

export interface TrafficSim {
  t: number;
  robots: RobotState[];
  zones: Map<string, ZoneStats>;
  deadlocksBroken: number;
}

export function createTraffic(inputs: TrafficRobotInput[]): TrafficSim {
  const robots = inputs.filter((r) => r.points.length >= 2).map(makeRobot);
  const zones = new Map<string, ZoneStats>();
  for (const r of robots)
    for (const c of r.route) if (!zones.has(c.zone)) zones.set(c.zone, { zone: c.zone, x: c.x, y: c.y, occupiedS: 0, waitS: 0, robots: 0 });
  for (const z of zones.values()) z.robots = new Set(robots.filter((r) => r.route.some((c) => c.zone === z.zone)).map((r) => r.input.id)).size;
  return { t: 0, robots, zones, deadlocksBroken: 0 };
}

/** Advance the traffic by `dt` seconds (internally in 0.1 s steps). */
export function stepTraffic(sim: TrafficSim, dt: number) {
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(0.1, left);
    tick(sim, h);
    left -= h;
  }
}

function findCycle(robots: RobotState[]): string | null {
  const by = new Map(robots.map((r) => [r.input.id, r]));
  for (const r of robots) {
    const seen = new Set<string>();
    let cur: RobotState | undefined = r;
    while (cur?.waitingFor) {
      if (seen.has(cur.input.id)) {
        // Break the cycle: the lowest id in it goes.
        return [...seen].sort()[0];
      }
      seen.add(cur.input.id);
      cur = by.get(cur.waitingFor);
    }
  }
  return null;
}

function tick(sim: TrafficSim, h: number) {
  sim.t += h;
  const overrides = new Set<string>();
  const cyc = findCycle(sim.robots);
  if (cyc) {
    overrides.add(cyc);
    sim.deadlocksBroken++;
  }
  for (const r of sim.robots) {
    if (!r.input.active) continue;
    const cell = r.route[r.i];
    if (cell) sim.zones.get(cell.zone)!.occupiedS += h;
    if (sim.t < r.dwellUntil) continue;
    const zonesPerS = r.input.speedMps / (ZONE * UNIT_M);
    r.progress += zonesPerS * h;
    if (r.progress < 1) continue;
    const nextIdx = r.i + 1;
    if (nextIdx >= r.route.length) {
      // Back home: trip done; wait for the next scheduled departure, then load.
      r.trips++;
      r.tripTimes.push(sim.t - r.tripStart);
      const period = r.input.tripsPerHour > 0 ? 3600 / r.input.tripsPerHour : Infinity;
      r.nextDeparture = Number.isFinite(period) ? Math.max(sim.t, r.nextDeparture + period) : Infinity;
      r.i = 0;
      r.progress = 0;
      r.dwellUntil = Math.max(sim.t + DWELL_S, r.nextDeparture);
      r.tripStart = r.dwellUntil - DWELL_S;
      continue;
    }
    const next = r.route[nextIdx];
    const b = blocker(r, next, sim.robots, overrides);
    if (b) {
      r.progress = 1;
      r.waitingFor = b;
      r.waitS += h;
      sim.zones.get(next.zone)!.waitS += h;
      continue;
    }
    r.waitingFor = null;
    r.i = nextIdx;
    r.progress -= 1;
    // Far dock: unload.
    if (r.i === Math.floor(r.route.length / 2)) r.dwellUntil = sim.t + DWELL_S;
  }
}

export function trafficStats(sim: TrafficSim): TrafficResult {
  const zones = [...sim.zones.values()];
  const docks = new Map<string, { zone: string; x: number; y: number }>();
  for (const r of sim.robots) {
    for (const c of [r.route[0], r.route[Math.floor(r.route.length / 2)]]) if (c) docks.set(c.zone, { zone: c.zone, x: c.x, y: c.y });
  }
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    seconds: round(sim.t),
    zones: zones.map((z) => ({ ...z, occupiedS: round(z.occupiedS), waitS: round(z.waitS) })),
    robots: sim.robots.map((r) => ({
      id: r.input.id,
      fleetId: r.input.fleetId,
      trips: r.trips,
      tripsPerHour: sim.t > 0 ? round((r.trips / sim.t) * 3600) : 0,
      requiredPerHour: r.input.tripsPerHour,
      avgTripS: r.tripTimes.length ? round(r.tripTimes.reduce((s, x) => s + x, 0) / r.tripTimes.length) : null,
      waitPct: sim.t > 0 ? round((r.waitS / sim.t) * 100) : 0,
      active: r.input.active,
    })),
    deadlocksBroken: sim.deadlocksBroken,
    totalWaitS: round(sim.robots.reduce((s, r) => s + r.waitS, 0)),
    hotspots: zones.filter((z) => z.waitS > 0).sort((a, b) => b.waitS - a.waitS).slice(0, 8).map((z) => ({ ...z, waitS: round(z.waitS), occupiedS: round(z.occupiedS) })),
    docks: [...docks.values()],
  };
}

/** Where a robot is now (layout units), interpolated within its zone, for drawing. */
export function robotPosition(sim: TrafficSim, id: string): { x: number; y: number; waiting: boolean } | null {
  const r = sim.robots.find((x) => x.input.id === id);
  if (!r) return null;
  const a = r.route[r.i];
  const b = r.route[Math.min(r.i + 1, r.route.length - 1)];
  if (!a) return null;
  const p = Math.min(1, r.progress);
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, waiting: !!r.waitingFor };
}
