/**
 * Serializable model for the isometric factory renderer, plus world-space layout.
 * Used by the Twin Studio (live state) and by the landing-page story (scripted scenario).
 */
import { cameraView } from "./quality";
import type { AssetKind, AssetStatus, CameraKind, FactoryState, LineState } from "./types";

const SERIES = ["var(--color-series-1)", "var(--color-series-2)", "var(--color-series-3)", "var(--color-series-4)"];

export interface IsoMachine {
  id: string;
  name: string;
  kind: AssetKind;
  status: AssetStatus;
  health: number;
  throughput: number;
  sensors: number;
  /** Floor position set in the playground (layout units, rotation in degrees). Absent: automatic layout. */
  pos?: { x: number; y: number; rot: number };
}

export interface IsoLine {
  id: string;
  name: string;
  kind: "assembly" | "packaging";
  color: string;
  state: LineState;
  product: string;
  machines: IsoMachine[];
}

export interface IsoCamera {
  id: string;
  name: string;
  kind: CameraKind;
  site: "line" | "asset" | "dock" | "stores";
  lineId: string | null;
  assetId: string | null;
  covers: string[];
  alert: boolean;
}

export interface IsoModel {
  lines: IsoLine[];
  inventory: { id: string; name: string; fill: number; low: boolean }[];
  orders: { id: string; customer: string; progress: number; atRisk: boolean; priority: string }[];
  cameras?: IsoCamera[];
}

/** Camera models for the twin views; `alert` is true when the camera's own analytics flag something. */
export function isoCameras(state: FactoryState): IsoCamera[] {
  return state.cameras.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    site: c.kind === "inspection" ? "asset" : c.kind === "dock" ? "dock" : c.lineId ? "line" : "stores",
    lineId: c.lineId,
    assetId: c.assetId,
    covers: c.covers,
    alert: cameraView(state, c).detections.some((d) => d.tone === "bad"),
  }));
}

export function isoModelFromState(state: FactoryState, orderRisk: Record<string, boolean> = {}, opts: { cameras?: boolean } = {}): IsoModel {
  return {
    cameras: opts.cameras ? isoCameras(state) : undefined,
    lines: state.lines.map((l, i) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      color: SERIES[i % SERIES.length],
      state: l.state,
      product: Object.entries(l.allocation)
        .filter(([, s]) => s > 0)
        .map(([p]) => p)
        .join(" · "),
      machines: l.assetIds
        .map((id) => state.assets.find((a) => a.id === id))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => ({ id: a.id, name: a.name, kind: a.kind, status: a.status, health: a.healthScore, throughput: a.signal.throughput, sensors: a.sensors.length, ...(state.layout?.[a.id] ? { pos: state.layout[a.id] } : {}) })),
    })),
    inventory: state.inventory.map((i) => ({ id: i.id, name: i.name, fill: Math.max(0.08, Math.min(1, i.onHand / (i.reorderPoint * 3))), low: i.onHand < i.reorderPoint * 1.25 })),
    orders: state.orders.map((o) => ({ id: o.id, customer: o.customer, progress: o.fulfilled / o.quantity, atRisk: !!orderRisk[o.id], priority: o.priority })),
  };
}

/* ───────────────────────────── World layout ───────────────────────────── */

export type Dir = "x" | "y";

export interface PlacedMachine {
  m: IsoMachine;
  lineId: string;
  color: string;
  x: number; // footprint centre
  y: number;
  dir: Dir; // material flow direction
  index: number; // global order (used for staggered build)
  /** Rotation in degrees when placed by hand (0 = flow along +x). */
  rot?: number;
}

export interface Belt {
  id: string;
  lineId: string;
  color: string;
  from: [number, number];
  to: [number, number];
  running: boolean;
}

export interface Bay {
  id: string;
  name: string;
  kind?: "assembly" | "packaging";
  color: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PlacedCamera {
  cam: IsoCamera;
  x: number; // mount point
  y: number;
  z: number; // mount height
  aim: [number, number] | null; // floor point the camera looks at (null: looks straight down)
  spread: number; // half-width of the field of view at the aim point
}

export interface Layout {
  cameras: PlacedCamera[];
  machines: PlacedMachine[];
  belts: Belt[];
  bays: Bay[];
  racks: { id: string; name: string; x: number; y: number; fill: number; low: boolean }[];
  trucks: { id: string; customer: string; x: number; y: number; progress: number; atRisk: boolean; priority: string }[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
}

/** Footprint along flow (L), across flow (W) and body height (H), in world units. */
export const FOOTPRINT: Record<AssetKind, { L: number; W: number; H: number }> = {
  conveyor: { L: 1.9, W: 0.8, H: 0.42 },
  press: { L: 1.25, W: 1.15, H: 0.7 },
  robot: { L: 1.0, W: 1.0, H: 0.32 },
  camera: { L: 1.3, W: 1.05, H: 0.62 },
  packager: { L: 1.6, W: 1.35, H: 1.05 },
  labeler: { L: 1.1, W: 0.95, H: 0.78 },
  cnc: { L: 1.5, W: 1.3, H: 1.0 },
  mixer: { L: 1.2, W: 1.2, H: 0.6 },
  oven: { L: 2.4, W: 1.2, H: 0.8 },
  filler: { L: 1.4, W: 1.4, H: 0.6 },
  molder: { L: 2.2, W: 0.9, H: 0.6 },
  welder: { L: 1.4, W: 1.4, H: 0.2 },
  palletizer: { L: 1.5, W: 1.5, H: 0.2 },
  pump: { L: 0.9, W: 0.7, H: 0.4 },
  workstation: { L: 1.2, W: 0.8, H: 0.75 },
  extruder: { L: 2.4, W: 0.8, H: 0.5 },
};

const PITCH = 2.7; // machine spacing along flow
const LINE_GAP = 3.4; // spacing between assembly lines

export function layoutIso(model: IsoModel): Layout {
  const machines: PlacedMachine[] = [];
  const belts: Belt[] = [];
  const bays: Bay[] = [];
  const assembly = model.lines.filter((l) => l.kind === "assembly");
  const packaging = model.lines.filter((l) => l.kind === "packaging");
  const running = (s: LineState) => s === "running" || s === "starved";
  let idx = 0;
  let maxX = 0;

  assembly.forEach((line, li) => {
    const y = li * LINE_GAP;
    line.machines.forEach((m, j) => {
      const x = 1.2 + j * PITCH;
      machines.push({ m, lineId: line.id, color: line.color, x, y, dir: "x", index: idx++ });
      if (j > 0) {
        const prevX = 1.2 + (j - 1) * PITCH;
        belts.push({ id: `${line.id}-${j}`, lineId: line.id, color: line.color, from: [prevX + 0.55, y], to: [x - 0.55, y], running: running(line.state) });
      }
      maxX = Math.max(maxX, x);
    });
    const endX = 1.2 + (line.machines.length - 1) * PITCH;
    bays.push({ id: line.id, name: line.name, kind: "assembly", color: line.color, x0: 0, y0: y - 1.15, x1: endX + 1.1, y1: y + 1.15 });
  });

  const asmWidth = assembly.length ? maxX : 0;
  const pkgX = asmWidth + 2.9;
  const asmSpanY = Math.max(0, (assembly.length - 1) * LINE_GAP);
  let dockY = asmSpanY + 3;

  packaging.forEach((line) => {
    // Packaging runs along +y from the merge point at the top of the assembly area.
    const startY = 0;
    line.machines.forEach((m, j) => {
      const y = startY + j * PITCH;
      machines.push({ m, lineId: line.id, color: line.color, x: pkgX, y, dir: "y", index: idx++ });
      if (j > 0) {
        belts.push({ id: `${line.id}-${j}`, lineId: line.id, color: line.color, from: [pkgX, startY + (j - 1) * PITCH + 0.55], to: [pkgX, y - 0.55], running: running(line.state) });
      }
    });
    const endY = startY + Math.max(0, line.machines.length - 1) * PITCH;
    bays.push({ id: line.id, name: line.name, kind: "packaging", color: line.color, x0: pkgX - 1.15, y0: startY - 1.15, x1: pkgX + 1.15, y1: endY + 1.15 });
    // Transfer belts from each assembly line end into the packaging infeed
    assembly.forEach((al, li) => {
      const y = li * LINE_GAP;
      const endX = 1.2 + (al.machines.length - 1) * PITCH;
      const targetY = Math.min(y, endY);
      belts.push({ id: `xfer-${al.id}`, lineId: al.id, color: al.color, from: [endX + 0.6, y], to: [pkgX - 0.75, targetY], running: running(al.state) });
    });
    dockY = endY + 2.4;
  });

  // Hand-placed machines (playground): belts, bays, stores and dock follow the machines.
  const free = machines.some((pm) => pm.m.pos);
  let rackX = -1.9;
  let rackY = -0.6;
  let truckX = pkgX - 1.4;
  if (free) {
    for (const pm of machines) {
      if (!pm.m.pos) continue;
      pm.x = pm.m.pos.x;
      pm.y = pm.m.pos.y;
      pm.rot = pm.m.pos.rot;
      pm.dir = pm.m.pos.rot % 180 === 0 ? "x" : "y";
    }
    belts.length = 0;
    bays.length = 0;
    for (const line of model.lines) {
      const ms = machines.filter((pm) => pm.lineId === line.id);
      if (!ms.length) continue;
      for (let j = 1; j < ms.length; j++) belts.push(...conveyorPath(`${line.id}-${j}`, line.id, line.color, ms[j - 1], ms[j], running(line.state)));
      bays.push({
        id: line.id,
        name: line.name,
        kind: line.kind,
        color: line.color,
        x0: Math.min(...ms.map((m) => m.x)) - 1.15,
        y0: Math.min(...ms.map((m) => m.y)) - 1.15,
        x1: Math.max(...ms.map((m) => m.x)) + 1.15,
        y1: Math.max(...ms.map((m) => m.y)) + 1.15,
      });
    }
    // Each process line merges into the side of the packing line, level with its end where it can.
    const pkm = packaging[0] ? machines.filter((pm) => pm.lineId === packaging[0].id) : [];
    if (pkm.length)
      for (const al of assembly) {
        const ms = machines.filter((pm) => pm.lineId === al.id);
        if (!ms.length) continue;
        const end = ms[ms.length - 1];
        const alongY = (pkm[0].rot ?? (pkm[0].dir === "x" ? 0 : 90)) % 180 !== 0;
        const clampTo = (v: number, vs: number[]) => Math.min(Math.max(v, Math.min(...vs)), Math.max(...vs));
        const target = alongY
          ? { x: pkm[0].x - Math.sign(pkm[0].x - end.x || 1) * 0.75, y: clampTo(end.y, pkm.map((m) => m.y)) }
          : { x: clampTo(end.x, pkm.map((m) => m.x)), y: pkm[0].y - Math.sign(pkm[0].y - end.y || 1) * 0.75 };
        belts.push(...conveyorPath(`xfer-${al.id}`, al.id, al.color, end, target, running(al.state), 0));
      }
    rackX = Math.min(...bays.map((b) => b.x0)) - 1.9;
    rackY = Math.min(...bays.map((b) => b.y0)) + 0.55;
    dockY = Math.max(...bays.map((b) => b.y1)) + 1.8;
    const pk = packaging[0] ? bays.find((b) => b.id === packaging[0].id) : undefined;
    truckX = pk ? (pk.x0 + pk.x1) / 2 - 1.4 : Math.max(...bays.map((b) => b.x1)) - 1.4;
  }

  // Warehouse racks (inventory) on the infeed side
  const racks = model.inventory.map((it, k) => ({ id: it.id, name: it.name, x: rackX - (k % 2) * 1.25, y: rackY + Math.floor(k / 2) * 1.35, fill: it.fill, low: it.low }));

  // Shipping dock trucks (orders) at the end of packaging
  const trucks = model.orders.map((o, k) => ({ id: o.id, customer: o.customer, x: truckX - k * 2.25, y: dockY, progress: o.progress, atRisk: o.atRisk, priority: o.priority }));

  // Cameras: pole-mounted at bay corners looking across their area; inspection cameras sit on their station.
  const cameras: PlacedCamera[] = [];
  const centroid = (ps: { x: number; y: number }[]): [number, number] => [ps.reduce((a, p) => a + p.x, 0) / ps.length, ps.reduce((a, p) => a + p.y, 0) / ps.length];
  for (const cam of model.cameras ?? []) {
    if (cam.site === "asset") {
      const pm = machines.find((m) => m.m.id === cam.assetId);
      if (pm) cameras.push({ cam, x: pm.x, y: pm.y, z: FOOTPRINT[pm.m.kind].H + 1.25, aim: null, spread: 0 });
    } else if (cam.kind === "thermal") {
      const ms = machines.filter((m) => cam.covers.includes(m.m.id));
      if (!ms.length) continue;
      const [ax, ay] = centroid(ms);
      cameras.push({ cam, x: ax, y: ay - 1.55, z: 2.1, aim: [ax, ay], spread: Math.max(1.1, (Math.max(...ms.map((m) => m.x)) - Math.min(...ms.map((m) => m.x))) / 2 + 0.7) });
    } else if (cam.site === "line") {
      const bay = bays.find((b) => b.id === cam.lineId);
      if (!bay) continue;
      const aim: [number, number] = [(bay.x0 + bay.x1) / 2, (bay.y0 + bay.y1) / 2];
      cameras.push({ cam, x: bay.x1 + 0.3, y: bay.y0 - 0.3, z: 2.6, aim, spread: Math.max(bay.x1 - bay.x0, bay.y1 - bay.y0) * 0.32 });
    } else if (cam.site === "dock" && trucks.length) {
      const [ax, ay] = centroid(trucks);
      cameras.push({ cam, x: Math.max(...trucks.map((t) => t.x)) + 1.8, y: ay + 1.2, z: 2.4, aim: [ax, ay], spread: (Math.max(...trucks.map((t) => t.x)) - Math.min(...trucks.map((t) => t.x))) / 2 + 1.2 });
    } else if (cam.site === "stores" && racks.length) {
      const [ax, ay] = centroid(racks);
      cameras.push({ cam, x: Math.max(...racks.map((r) => r.x)) + 0.75, y: Math.min(...racks.map((r) => r.y)) - 1.1, z: 2.4, aim: [ax, ay], spread: 1.3 });
    }
  }

  const xs = [...machines.map((m) => m.x), ...racks.map((r) => r.x), ...trucks.map((t) => t.x), ...(free ? [] : [pkgX + 1.5])];
  const ys = [...machines.map((m) => m.y), ...racks.map((r) => r.y), ...trucks.map((t) => t.y), ...(free ? [] : [-1.5])];
  return {
    cameras,
    machines,
    belts,
    bays,
    racks,
    trucks,
    bounds: { x0: Math.min(...xs) - 1.6, y0: Math.min(...ys) - 1.2, x1: Math.max(...xs) + 1.6, y1: Math.max(...ys) + 1.6 },
  };
}

/**
 * Conveyor between two placed machines: straight when they line up, else an L along x then y.
 * Each end stops short of the machine body.
 */
function conveyorPath(id: string, lineId: string, color: string, a: { x: number; y: number }, b: { x: number; y: number }, isRunning: boolean, endGap = 0.6): Belt[] {
  const gap = 0.6;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  if (Math.hypot(dx, dy) < gap + endGap + 0.1) return [];
  const belt = (suffix: string, from: [number, number], to: [number, number]): Belt => ({ id: `${id}${suffix}`, lineId, color, from, to, running: isRunning });
  if (Math.abs(dx) <= gap + 0.05) return [belt("", [a.x, a.y + sy * gap], [a.x, b.y - sy * endGap])];
  if (Math.abs(dy) <= gap + 0.05) return [belt("", [a.x + sx * gap, a.y], [b.x - sx * endGap, a.y])];
  return [belt("a", [a.x + sx * gap, a.y], [b.x, a.y]), belt("b", [b.x, a.y], [b.x, b.y - sy * endGap])];
}

/** Preview model for a TwinSpec under review (before it is built): every machine shown healthy. */
export function isoModelFromSpec(spec: import("./builder/spec").TwinSpec, rates: Record<string, number> = {}, opts: { dock?: boolean } = {}): IsoModel {
  const ordered = [...spec.lines.filter((l) => l.role === "process"), ...spec.lines.filter((l) => l.role === "packing")];
  return {
    lines: ordered.map((l, i) => ({
      id: l.id,
      name: l.name,
      kind: l.role === "packing" ? "packaging" : "assembly",
      color: SERIES[i % SERIES.length],
      state: "running",
      product: l.productIds.map((p) => spec.products.find((x) => x.id === p)?.name ?? p).join(" · "),
      machines: l.machines.map((m) => ({ id: m.id, name: m.name, kind: m.archetype, status: "healthy", health: 100, throughput: rates[m.id] ?? m.ratePerHour ?? 0, sensors: 0, ...(m.pos ? { pos: { ...m.pos } } : {}) })),
    })),
    inventory: spec.materials.slice(0, 8).map((m) => ({ id: m.id, name: m.name, fill: 0.65, low: false })),
    // A dock bay, so finished-goods routes have somewhere to go before any order exists.
    orders: opts.dock ? [{ id: "dock", customer: "Shipping dock", progress: 0, atRisk: false, priority: "standard" }] : [],
  };
}
