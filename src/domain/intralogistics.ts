/**
 * Intralogistics: the mobile robots (AMRs, AGVs, automated forklifts, tuggers) that move material.
 *
 * A twin built with the Twin Builder has exactly the robots its reviewed spec asked for
 * (`state.mobileRobots`); a twin without them has none. The demo plant, which predates the
 * builder, gets a fleet derived from its material flow: a kitting robot per process line and a
 * pallet robot per packing line. Either way, trip rates follow the line's measured output and a
 * robot parks (with the reason) when its line stops or a part runs out, so the robots always
 * agree with the plant model. It is a simulated layer: no fleet manager is connected.
 */
import type { FactoryState, LineState, MobileRobot, ProductionLine } from "./types";

/** Units of the line's product kitted into one tote (one trip from stores). */
export const KIT_UNITS_PER_TRIP = 60;
/** Packed units on one pallet (one trip to the dock). */
export const PALLET_UNITS_PER_TRIP = 120;
/** Load or unload time per stop, minutes. */
export const DWELL_MIN = 1.5;
/** Travel speed, metres per second (typical indoor AMR in mixed traffic). */
export const AMR_SPEED_MPS = 1.0;
/** Metres per layout unit (machine pitch 2.7 units ≈ 5.4 m). */
export const METRES_PER_UNIT = 2;

export type AmrMission = MobileRobot["mission"];

export interface Amr {
  id: string;
  name: string;
  robotType: MobileRobot["robotType"];
  /** Robots of one fleet share a route (spread out along it). */
  fleetId: string;
  fleetName: string;
  /** True when it comes from the Twin Builder spec; false for the demo plant's derived fleet. */
  configured: boolean;
  speedMps: number;
  mission: AmrMission;
  lineId: string;
  lineName: string;
  /** Where it loads and unloads (for display). */
  from: string;
  to: string;
  payload: string;
  unitsPerTrip: number;
  /** Line output the trips are sized from, units per hour. */
  lineRate: number;
  tripsPerHour: number;
  /** Set when trips run on a fixed schedule (playground rule) instead of following line output. */
  everyMinutes: number | null;
  /** Waypoints (layout units) set in the playground; empty: the standard aisle route. */
  route: { x: number; y: number }[];
  status: "active" | "parked";
  reason: string | null;
}

const PARKED_REASON: Partial<Record<LineState, string>> = {
  down: "Line stopped (breakdown)",
  maintenance: "Line in maintenance",
  changeover: "Line in changeover",
  idle: "Line idle",
};

/** Recent output of a line, units per hour: the last complete hour, else its planned rate. */
export function lineOutputRate(state: FactoryState, line: ProductionLine): number {
  const hour = Math.floor(state.clock.hour);
  const recs = state.production.filter((r) => r.lineId === line.id && r.hour >= hour - 1 && r.hour < hour);
  const planned = recs.reduce((s, r) => s + r.plannedHours, 0);
  if (planned > 0.25) return recs.reduce((s, r) => s + r.goodUnits + r.scrapUnits, 0) / planned;
  return Object.entries(line.allocation).reduce((s, [pid, share]) => s + (line.capabilities.find((c) => c.productId === pid)?.ratePerHour ?? 0) * share, 0);
}

function lineComponents(state: FactoryState, line: ProductionLine) {
  const ids = new Set<string>();
  for (const pid of Object.keys(line.allocation)) for (const b of line.capabilities.find((c) => c.productId === pid)?.bom ?? []) ids.add(b.itemId);
  return state.inventory.filter((i) => ids.has(i.id));
}

export function amrFleet(state: FactoryState): Amr[] {
  if (state.mobileRobots) return configuredFleet(state, state.mobileRobots);
  return state.profile.isDemo ? derivedFleet(state) : [];
}

function parkedReason(state: FactoryState, line: ProductionLine, mission: AmrMission): string | null {
  if (line.state === "running") return null;
  if (line.state !== "starved") return PARKED_REASON[line.state] ?? "Line not running";
  if (mission === "kitting") {
    const empty = lineComponents(state, line).find((i) => i.category !== "packaging" && i.onHand <= 0);
    return `Nothing to deliver: ${empty?.name ?? "a component"} is out of stock`;
  }
  return mission === "line-transfer" ? "No product: the line is waiting for material" : "No packed goods: the line is waiting for product";
}

function configuredFleet(state: FactoryState, robots: MobileRobot[]): Amr[] {
  const packing = state.lines.find((l) => l.kind === "packaging") ?? null;
  const fleetSize = new Map<string, number>();
  for (const r of robots) fleetSize.set(r.fleetId, (fleetSize.get(r.fleetId) ?? 0) + 1);
  const open = state.orders.find((o) => o.completedHour === null);
  return robots.flatMap((r): Amr[] => {
    const line = state.lines.find((l) => l.id === r.lineId);
    if (!line) return [];
    const reason = parkedReason(state, line, r.mission);
    const rate = reason ? 0 : lineOutputRate(state, line);
    const n = fleetSize.get(r.fleetId) ?? 1;
    const comps = lineComponents(state, line).filter((i) => i.category !== "packaging");
    const route =
      r.mission === "kitting"
        ? { from: "Component stores", to: `${line.name} infeed`, payload: comps.length ? comps.slice(0, 3).map((i) => i.name).join(", ") + (comps.length > 3 ? ` +${comps.length - 3}` : "") : "Components" }
        : r.mission === "line-transfer"
          ? { from: `${line.name} outfeed`, to: `${packing?.name ?? "Packing"} infeed`, payload: "Tote of finished units" }
          : { from: `${line.name} outfeed`, to: open ? `Shipping dock (${open.id})` : "Shipping dock", payload: "Pallet of packed goods" };
    return [
      {
        id: r.id,
        name: r.name,
        robotType: r.robotType,
        fleetId: r.fleetId,
        fleetName: r.fleetName,
        configured: true,
        speedMps: r.speedMps,
        mission: r.mission,
        lineId: line.id,
        lineName: line.name,
        ...route,
        unitsPerTrip: r.unitsPerTrip,
        lineRate: Math.round(rate),
        // The fleet shares the line's trips: one every N minutes on a schedule, else sized from output.
        tripsPerHour: reason ? 0 : r.trigger ? Math.round((60 / r.trigger.everyMinutes / n) * 10) / 10 : Math.round((rate / r.unitsPerTrip / n) * 10) / 10,
        everyMinutes: r.trigger?.everyMinutes ?? null,
        route: r.route?.map((p) => ({ ...p })) ?? [],
        status: reason ? "parked" : "active",
        reason,
      },
    ];
  });
}

function derivedFleet(state: FactoryState): Amr[] {
  const fleet: Amr[] = [];
  const process = state.lines.filter((l) => l.kind === "assembly");
  const packing = state.lines.filter((l) => l.kind === "packaging");
  process.forEach((line) => {
    const comps = lineComponents(state, line).filter((i) => i.category !== "packaging");
    const empty = comps.find((i) => i.onHand <= 0);
    const rate = line.state === "running" ? lineOutputRate(state, line) : 0;
    const parked = line.state !== "running" && line.state !== "starved" ? (PARKED_REASON[line.state] ?? "Line not running") : line.state === "starved" ? `Nothing to deliver: ${empty?.name ?? "a component"} is out of stock` : null;
    fleet.push({
      id: `AMR-${line.code}1`,
      name: `Kitting AMR ${line.code}1`,
      robotType: "amr",
      fleetId: `kitting-${line.id}`,
      fleetName: "Kitting AMRs",
      configured: false,
      speedMps: AMR_SPEED_MPS,
      mission: "kitting",
      lineId: line.id,
      lineName: line.name,
      from: "Component stores",
      to: `${line.name} infeed`,
      payload: comps.length ? comps.slice(0, 3).map((i) => i.name).join(", ") + (comps.length > 3 ? ` +${comps.length - 3}` : "") : "Components",
      unitsPerTrip: KIT_UNITS_PER_TRIP,
      lineRate: Math.round(rate),
      tripsPerHour: Math.round((rate / KIT_UNITS_PER_TRIP) * 10) / 10,
      everyMinutes: null,
      route: [],
      status: parked ? "parked" : "active",
      reason: parked,
    });
  });
  packing.forEach((line) => {
    const rate = line.state === "running" ? lineOutputRate(state, line) : 0;
    const parked = line.state === "running" ? null : line.state === "starved" ? "No packed goods: the packing line is waiting for product" : (PARKED_REASON[line.state] ?? "Line not running");
    const open = state.orders.filter((o) => o.completedHour === null);
    fleet.push({
      id: `AMR-${line.code}1`,
      name: `Pallet AMR ${line.code}1`,
      robotType: "amr",
      fleetId: `pallets-${line.id}`,
      fleetName: "Pallet AMRs",
      configured: false,
      speedMps: AMR_SPEED_MPS,
      mission: "finished-goods",
      lineId: line.id,
      lineName: line.name,
      from: `${line.name} outfeed`,
      to: open.length ? `Shipping dock (${open[0].id})` : "Shipping dock",
      payload: "Pallet of packed cartons",
      unitsPerTrip: PALLET_UNITS_PER_TRIP,
      lineRate: Math.round(rate),
      tripsPerHour: Math.round((rate / PALLET_UNITS_PER_TRIP) * 10) / 10,
      everyMinutes: null,
      route: [],
      status: parked ? "parked" : "active",
      reason: parked,
    });
  });
  return fleet;
}

/** Share of the hour a robot is busy, given its round-trip path length in layout units. */
export function amrUtilisation(amr: Amr, roundTripUnits: number): number {
  const travelMin = (roundTripUnits * METRES_PER_UNIT) / (amr.speedMps || AMR_SPEED_MPS) / 60;
  const cycleMin = travelMin + 2 * DWELL_MIN;
  return Math.min(1, (amr.tripsPerHour * cycleMin) / 60);
}
