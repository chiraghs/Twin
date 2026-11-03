import type { Amr } from "@/domain/intralogistics";
import type { Layout } from "../iso/model";

/** A robot's route on the floor (layout units): it runs start → end loaded, then back empty. */
export interface AmrPath {
  amr: Amr;
  color: string;
  points: [number, number][];
  length: number;
  /** Position within its fleet (robots of a fleet share the route, spread out along it). */
  slot: number;
  fleetSize: number;
}

const polyLength = (ps: [number, number][]) => ps.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - ps[i][0], p[1] - ps[i][1]), 0);

/**
 * Routes that keep to the aisles: kitting robots use the corridor between the stores racks and
 * the line bays, then enter their line's bay beside the first machine; transfer robots run from a
 * process line's end, alongside the transfer belts, to the packing infeed; pallet robots leave the
 * outfeed and run along the dock apron to the truck being loaded.
 */
export function amrPaths(layout: Layout, fleet: Amr[], lineOrder: string[]): AmrPath[] {
  const out: AmrPath[] = [];
  const racks = layout.racks;
  const rackEdge = racks.length ? Math.max(...racks.map((r) => r.x)) + 0.45 : -1.4;
  const pickY = racks.length ? racks.reduce((s, r) => s + r.y, 0) / racks.length : 0;
  const packingBays = new Set(layout.bays.filter((b) => b.kind === "packaging").map((b) => b.id));
  const packingMachines = layout.machines.filter((m) => (packingBays.size ? packingBays.has(m.lineId) : m.dir === "y"));
  // Hand-placed layouts (playground) have no fixed lanes: routes go round the corner instead.
  const free = layout.machines.some((m) => m.rot != null);
  const routes = new Map<string, [number, number][] | null>();
  const fleetSize = new Map<string, number>();
  const slotOf = new Map<string, number>();
  for (const a of fleet) {
    slotOf.set(a.id, fleetSize.get(a.fleetId) ?? 0);
    fleetSize.set(a.fleetId, (fleetSize.get(a.fleetId) ?? 0) + 1);
  }
  let k = 0;
  const routeFor = (amr: Amr): [number, number][] | null => {
    const bay = layout.bays.find((b) => b.id === amr.lineId);
    const ms = layout.machines.filter((m) => m.lineId === amr.lineId);
    if (!bay || !ms.length) return null;
    if (amr.mission === "kitting") {
      const corridor = (rackEdge + bay.x0) / 2 - 0.12 * (k % 3);
      const first = ms[0];
      const dropY = first.y - 0.88;
      const pts: [number, number][] = [
        [corridor, pickY + 0.3 * (k % 3)],
        [corridor, dropY],
        [Math.max(bay.x0 + 0.45, first.x - 0.25), dropY],
      ];
      k++;
      return pts;
    }
    const last = ms[ms.length - 1];
    if (amr.mission === "line-transfer") {
      const pk = packingMachines[0];
      if (pk && free) {
        const start: [number, number] = [last.x, last.y + 0.9];
        const end: [number, number] = [pk.x - 0.9, pk.y];
        return [start, [end[0], start[1]], end];
      }
      if (!pk || last.dir !== "x") return null;
      // Along the line's own lane (beside its transfer belt) to the side of the packing line.
      const laneY = last.y - 0.88;
      return [
        [last.x + 0.2, laneY],
        [pk.x - 1.3, laneY],
      ];
    }
    const truck = layout.trucks.find((t) => t.progress < 1) ?? layout.trucks[0];
    if (!truck) return null;
    const outfeed: [number, number] = last.dir === "y" ? [last.x, last.y + 0.95] : [last.x + 0.95, last.y];
    const apronY = truck.y - 0.85;
    return [outfeed, [outfeed[0], apronY], [truck.x, apronY]];
  };
  // Waypoints drawn in the playground replace the middle of the standard route; pick-up and drop-off stay put.
  const withWaypoints = (amr: Amr, pts: [number, number][] | null): [number, number][] | null =>
    pts && amr.route.length ? [pts[0], ...amr.route.map((p): [number, number] => [p.x, p.y]), pts[pts.length - 1]] : pts;
  for (const amr of fleet) {
    if (!routes.has(amr.fleetId)) routes.set(amr.fleetId, withWaypoints(amr, routeFor(amr)));
    const points = routes.get(amr.fleetId);
    if (!points) continue;
    const color = layout.machines.find((m) => m.lineId === amr.lineId)?.color ?? "#4c8dff";
    out.push({ amr, color, points, length: polyLength(points), slot: slotOf.get(amr.id) ?? 0, fleetSize: fleetSize.get(amr.fleetId) ?? 1 });
  }
  // Keep a stable order for rendering (by line order).
  return out.sort((a, b) => lineOrder.indexOf(a.amr.lineId) - lineOrder.indexOf(b.amr.lineId));
}

/**
 * Where a robot is at time `t` (seconds) on a looped mission: load, run to the end, unload, run
 * back. Returns position, heading (radians, layout frame) and whether it is carrying a load.
 */
export function amrPose(path: AmrPath, t: number, speed: number, dwell: number, phase = 0) {
  const travel = path.length / speed;
  const cycle = 2 * travel + 2 * dwell;
  let s = (((t + phase) % cycle) + cycle) % cycle;
  const at = (d: number) => {
    let rem = d;
    for (let i = 1; i < path.points.length; i++) {
      const [x0, y0] = path.points[i - 1];
      const [x1, y1] = path.points[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (rem <= seg || i === path.points.length - 1) {
        const f = seg ? Math.min(1, rem / seg) : 0;
        return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, heading: Math.atan2(y1 - y0, x1 - x0) };
      }
      rem -= seg;
    }
    const [x, y] = path.points[0];
    return { x, y, heading: 0 };
  };
  if (s < dwell) return { ...at(0), loaded: s > dwell / 2, phase: "loading" as const };
  s -= dwell;
  if (s < travel) return { ...at(s * speed), loaded: true, phase: "moving" as const };
  s -= travel;
  if (s < dwell) return { ...at(path.length), loaded: s < dwell / 2, phase: "unloading" as const };
  s -= dwell;
  const back = at(path.length - s * speed);
  return { ...back, heading: back.heading + Math.PI, loaded: false, phase: "returning" as const };
}
