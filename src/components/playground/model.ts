/**
 * Floor-plan helpers for the playground: the layout of a draft spec (the same layout the twin
 * views use), hit testing, where a dropped machine joins the flow, and the ops that pin the
 * automatic layout before the first hand placement.
 */
import { ARCHETYPES } from "@/domain/archetypes";
import type { SpecOp } from "@/domain/builder/ops";
import type { TwinSpec } from "@/domain/builder/spec";
import type { Amr } from "@/domain/intralogistics";
import type { AssetKind } from "@/domain/types";
import { FOOTPRINT, isoModelFromSpec, layoutIso, type Layout, type PlacedMachine } from "@/components/iso/model";
import { amrPaths, type AmrPath } from "@/components/three/amr-paths";

export const SNAP = 0.25;
export const snap = (v: number) => Math.round(v / SNAP) * SNAP;

export interface FloorModel {
  layout: Layout;
  /** Belt id → the machine whose output it carries (for "split here"). */
  beltSource: Map<string, string>;
  paths: AmrPath[];
}

export function floorModel(spec: TwinSpec, fleetLines: Record<string, string | null>): FloorModel {
  const layout = layoutIso(isoModelFromSpec(spec, {}, { dock: true }));
  const beltSource = new Map<string, string>();
  for (const l of spec.lines)
    l.machines.forEach((m, j) => {
      if (j === 0) return;
      for (const suffix of ["", "a", "b"]) beltSource.set(`${l.id}-${j}${suffix}`, l.machines[j - 1].id);
    });
  const fleet: Amr[] = spec.mobileRobots.flatMap((f) =>
    Array.from({ length: f.count }, (_, k) => ({
      id: `${f.id}#${k}`,
      name: f.name,
      robotType: f.robotType,
      fleetId: f.id,
      fleetName: f.name,
      configured: true,
      speedMps: f.speedMps ?? 1,
      mission: f.mission,
      lineId: fleetLines[f.id] ?? f.lineId ?? "",
      lineName: "",
      from: "",
      to: "",
      payload: "",
      unitsPerTrip: f.unitsPerTrip ?? 60,
      lineRate: 0,
      tripsPerHour: 0,
      everyMinutes: f.trigger.everyMinutes,
      route: f.route,
      status: "active" as const,
      reason: null,
    })),
  );
  const paths = amrPaths(layout, fleet, spec.lines.map((l) => l.id));
  return { layout, beltSource, paths };
}

export const rotOf = (pm: PlacedMachine) => pm.rot ?? (pm.dir === "x" ? 0 : 90);

/** Footprint half-extents on the floor for a machine at its rotation. */
export function extents(pm: PlacedMachine) {
  const f = FOOTPRINT[pm.m.kind];
  return rotOf(pm) % 180 === 0 ? { hx: f.L / 2, hy: f.W / 2 } : { hx: f.W / 2, hy: f.L / 2 };
}

export function hitMachine(layout: Layout, x: number, y: number, except?: string): PlacedMachine | null {
  let best: PlacedMachine | null = null;
  let bestD = Infinity;
  for (const pm of layout.machines) {
    if (pm.m.id === except) continue;
    const { hx, hy } = extents(pm);
    if (Math.abs(x - pm.x) <= hx + 0.15 && Math.abs(y - pm.y) <= hy + 0.15) {
      const d = Math.hypot(x - pm.x, y - pm.y);
      if (d < bestD) [best, bestD] = [pm, d];
    }
  }
  return best;
}

/** Ops that fix every machine still on the automatic layout at its current spot. */
export function pinOps(spec: TwinSpec, layout: Layout, except?: string): SpecOp[] {
  const ops: SpecOp[] = [];
  for (const l of spec.lines)
    for (const m of l.machines) {
      if (m.pos || m.id === except) continue;
      const pm = layout.machines.find((p) => p.m.id === m.id);
      if (pm) ops.push({ op: "place_machine", machineId: m.id, x: snap(pm.x), y: snap(pm.y), rot: rotOf(pm) });
    }
  return ops;
}

/**
 * Where a machine dropped at (x, y) joins the flow: the line whose bay it lands in (or whose
 * machine is nearest, within reach), placed before or after the nearest machine along the flow.
 */
export function dropTarget(spec: TwinSpec, layout: Layout, x: number, y: number): { lineId: string; position: number } | null {
  const bay = layout.bays.find((b) => x >= b.x0 - 0.4 && x <= b.x1 + 0.4 && y >= b.y0 - 0.4 && y <= b.y1 + 0.4);
  let lineId = bay?.id ?? null;
  if (!lineId) {
    let d = Infinity;
    for (const pm of layout.machines) {
      const dd = Math.hypot(pm.x - x, pm.y - y);
      if (dd < d && dd < 2.4) [d, lineId] = [dd, pm.lineId];
    }
  }
  const line = spec.lines.find((l) => l.id === lineId);
  if (!line) return null;
  const placed = line.machines.map((m) => layout.machines.find((p) => p.m.id === m.id)).filter((p): p is PlacedMachine => !!p);
  if (!placed.length) return { lineId: line.id, position: line.machines.length };
  const first = placed[0];
  const last = placed[placed.length - 1];
  const fx = placed.length > 1 ? last.x - first.x : 1;
  const fy = placed.length > 1 ? last.y - first.y : 0;
  let nearest = 0;
  let d = Infinity;
  placed.forEach((p, i) => {
    const dd = Math.hypot(p.x - x, p.y - y);
    if (dd < d) [d, nearest] = [dd, i];
  });
  const ahead = (x - placed[nearest].x) * fx + (y - placed[nearest].y) * fy > 0;
  return { lineId: line.id, position: nearest + (ahead ? 1 : 0) };
}

export const machineLabel = (kind: AssetKind) => ARCHETYPES[kind].name;

/** Short names for the palette and the floor. */
export const KIND_SHORT: Record<AssetKind, string> = {
  conveyor: "Conveyor",
  press: "Press",
  robot: "Robot cell",
  camera: "Vision QA",
  packager: "Packer",
  labeler: "Labeler",
  cnc: "CNC",
  mixer: "Mixer",
  oven: "Oven",
  filler: "Filler",
  molder: "Molder",
  welder: "Welder",
  palletizer: "Palletizer",
  pump: "Pump",
  workstation: "Workstation",
  extruder: "Extruder",
};

/** How close (floor units) a dragged machine must be to a line's axis or spacing to snap to it. */
export const ALIGN_RANGE = 0.5;

/**
 * Snap-to-line: when a machine is dragged near the axis of its line (the row or column its
 * neighbours sit on), it locks onto that axis; near a neighbour's standard spacing it locks onto
 * that too. Returns the snapped point and the guide to draw, or the point unchanged.
 */
export function alignToLine(layout: Layout, id: string, x: number, y: number): { x: number; y: number; guide: { x1: number; y1: number; x2: number; y2: number } | null } {
  const self = layout.machines.find((m) => m.m.id === id);
  if (!self) return { x, y, guide: null };
  const mates = layout.machines.filter((m) => m.lineId === self.lineId && m.m.id !== id);
  if (!mates.length) return { x, y, guide: null };
  let sx = x;
  let sy = y;
  let guide: { x1: number; y1: number; x2: number; y2: number } | null = null;
  const nearestY = mates.reduce((b, m) => (Math.abs(m.y - y) < Math.abs(b.y - y) ? m : b));
  const nearestX = mates.reduce((b, m) => (Math.abs(m.x - x) < Math.abs(b.x - x) ? m : b));
  if (Math.abs(nearestY.y - y) <= ALIGN_RANGE) {
    sy = nearestY.y;
    const xs = [...mates.filter((m) => m.y === nearestY.y).map((m) => m.x), sx];
    guide = { x1: Math.min(...xs) - 0.8, y1: sy, x2: Math.max(...xs) + 0.8, y2: sy };
    // Standard spacing: lock onto one pitch beside the nearest machine on that row.
    const pitch = Math.min(...mates.filter((m) => m.y === sy).map((m) => Math.abs(m.x - sx)).filter((d) => d > 0.4), Infinity);
    const ref = mates.filter((m) => m.y === sy).sort((a, b) => Math.abs(a.x - sx) - Math.abs(b.x - sx))[0];
    const spacing = ROW_PITCH;
    if (ref && Number.isFinite(pitch) && Math.abs(Math.abs(ref.x - sx) - spacing) <= ALIGN_RANGE) sx = ref.x + Math.sign(sx - ref.x || 1) * spacing;
  } else if (Math.abs(nearestX.x - x) <= ALIGN_RANGE) {
    sx = nearestX.x;
    const ys = [...mates.filter((m) => m.x === nearestX.x).map((m) => m.y), sy];
    guide = { x1: sx, y1: Math.min(...ys) - 0.8, x2: sx, y2: Math.max(...ys) + 0.8 };
  }
  return { x: sx, y: sy, guide };
}

/** Standard centre-to-centre spacing of machines along a line (matches the automatic layout). */
export const ROW_PITCH = 2.7;
