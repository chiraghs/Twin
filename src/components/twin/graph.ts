import type { Edge, Node } from "@xyflow/react";
import { cameraView } from "@/domain/quality";
import type { Asset, Camera, CustomerOrder, FactoryState, InventoryItem, ProductionLine, SensorSpec } from "@/domain/types";
import type { Highlight } from "@/client/store";import { SERIES } from "../charts/kit";


/** Role of a node within a highlighted scenario. */
export type HighlightRole = "target" | "reroute" | "impacted" | "supply" | "order" | null;

export interface MachineData extends Record<string, unknown> {
  asset: Asset;
  lineColor: string;
  role: HighlightRole;
  roleLabel: string | null;
  dimmed: boolean;
  vertical: boolean;
  workOrder: string | null;
}
export interface LineData extends Record<string, unknown> {
  line: ProductionLine;
  vertical?: boolean;
  color: string;
  throughput: number;
  role: HighlightRole;
  dimmed: boolean;
  roleLabel: string | null;
}
export interface InventoryData extends Record<string, unknown> {
  item: InventoryItem;
  coverageHours: number;
  role: HighlightRole;
  dimmed: boolean;
}
export interface OrderData extends Record<string, unknown> {
  order: CustomerOrder;
  productName: string;
  hoursToDue: number;
  role: HighlightRole;
  dimmed: boolean;
  atRisk: boolean;
}
export interface CameraData extends Record<string, unknown> {
  camera: Camera;
  alert: boolean;
  headline: string;
  dimmed: boolean;
}
export interface SensorData extends Record<string, unknown> {
  sensor: SensorSpec;
  assetId: string;
  value: string;
  dimmed: boolean;
}

export const MACHINE_W = 188;
export const MACHINE_H = 96;
const H_GAP = 36;
const LINE_PAD_X = 18;
const LINE_HEADER = 40;
const LINE_PAD_B = 18;
const SENSOR_BAND = 46;
const V_GAP = 22;


export interface GraphOptions {
  layers: { sensors: boolean; inventory: boolean; orders: boolean; cameras?: boolean };
  highlight: Highlight | null;
  positions: Record<string, { x: number; y: number }>;
  interactive: boolean;
  orderRisk: Record<string, boolean>;
  coverage: Record<string, number>;
}

function roleLabelFor(h: Highlight, role: HighlightRole): string | null {
  if (!role) return null;
  if (role === "target") {
    if (h.kind === "continue") return "Runs to predicted trip";
    if (h.kind === "baseline") return "Assumed healthy";
    return "Maintenance window";
  }
  if (role === "reroute") return "Rerouted production";
  if (role === "impacted") return "On affected path";
  return null;
}

const CAM_W = 132;

export function buildGraph(state: FactoryState, opts: GraphOptions): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const h = opts.highlight;
  const showCams = !!opts.layers.cameras;
  const camNode = (cam: Camera, position: { x: number; y: number }, parentId?: string, links: string[] = [], handles: [string, string] = ["b", "t-in"]) => {
    const v = cameraView(state, cam);
    const nid = `cam:${cam.id}`;
    nodes.push({
      id: nid,
      type: "camera",
      ...(parentId ? { parentId } : {}),
      position,
      data: { camera: cam, alert: v.detections.some((d) => d.tone === "bad"), headline: v.headline, dimmed: !!h } satisfies CameraData,
      draggable: false,
      zIndex: 3,
    });
    for (const target of links) {
      edges.push({ id: `cam:${cam.id}:${target}`, source: nid, target, sourceHandle: handles[0], targetHandle: handles[1], type: "straight", style: { stroke: "var(--color-line-strong)", strokeWidth: 1, strokeDasharray: "3 3" }, zIndex: 1 });
    }
  };
  const assembly = state.lines.filter((l) => l.kind === "assembly");
  const packaging = state.lines.filter((l) => l.kind === "packaging");
  const colorOf = (lineId: string) => SERIES[Math.max(0, state.lines.findIndex((l) => l.id === lineId)) % SERIES.length];
  const sensorBand = opts.layers.sensors ? SENSOR_BAND : 0;
  const invX = 0;
  const lineX = opts.layers.inventory ? 260 : 0;

  const assetRole = (a: Asset): HighlightRole => {
    if (!h) return null;
    if (a.id === h.targetAssetId) return "target";
    if (h.rerouteLineId && a.lineId === h.rerouteLineId) return "reroute";
    if (h.assetIds.includes(a.id) || h.lineIds.includes(a.lineId)) return "impacted";
    return null;
  };
  const activeWO = (assetId: string) => state.workOrders.find((w) => w.assetId === assetId && (w.status === "scheduled" || w.status === "in-progress"))?.id ?? null;

  // Assembly lines: horizontal rows
  let y = 20;
  let maxRowRight = lineX;
  for (const line of assembly) {
    const assets = line.assetIds.map((id) => state.assets.find((a) => a.id === id)).filter(Boolean) as Asset[];
    const width = LINE_PAD_X * 2 + assets.length * MACHINE_W + Math.max(0, assets.length - 1) * H_GAP;
    const height = LINE_HEADER + MACHINE_H + LINE_PAD_B + sensorBand;
    const gid = `line:${line.id}`;
    const pos = opts.positions[gid] ?? { x: lineX, y };
    const lineRole: HighlightRole = h ? (h.rerouteLineId === line.id ? "reroute" : h.lineIds.includes(line.id) ? "impacted" : null) : null;
    nodes.push({
      id: gid,
      type: "line",
      position: pos,
      data: {
        line,
        color: colorOf(line.id),
        throughput: assets.length ? Math.min(...assets.map((a) => a.signal.throughput)) : 0,
        role: lineRole,
        dimmed: !!h && !lineRole,
        roleLabel: lineRole === "reroute" ? "Rerouted" : lineRole === "impacted" ? "Affected" : null,
      } satisfies LineData,
      style: { width, height },
      draggable: opts.interactive,
      selectable: false,
      zIndex: 0,
    });
    assets.forEach((a, i) => {
      const role = assetRole(a);
      nodes.push({
        id: a.id,
        type: "machine",
        parentId: gid,
        extent: "parent",
        position: opts.positions[a.id] ?? { x: LINE_PAD_X + i * (MACHINE_W + H_GAP), y: LINE_HEADER },
        data: {
          asset: a,
          lineColor: colorOf(line.id),
          role,
          roleLabel: h ? roleLabelFor(h, role) : null,
          dimmed: !!h && !role,
          vertical: false,
          workOrder: activeWO(a.id),
        } satisfies MachineData,
        draggable: opts.interactive,
        zIndex: 2,
      });
      if (opts.layers.sensors) {
        a.sensors.forEach((s, k) => {
          const sid = `sen:${s.id}`;
          nodes.push({
            id: sid,
            type: "sensor",
            parentId: gid,
            extent: "parent",
            position: { x: LINE_PAD_X + i * (MACHINE_W + H_GAP) + k * 46, y: LINE_HEADER + MACHINE_H + 14 },
            data: { sensor: s, assetId: a.id, value: sensorValue(a, s), dimmed: !!h && !role } satisfies SensorData,
            draggable: false,
            selectable: false,
            zIndex: 1,
          });
          edges.push({ id: `e:${sid}`, source: sid, target: a.id, type: "straight", sourceHandle: "t", targetHandle: "b-in", style: { stroke: "var(--color-line-strong)", strokeWidth: 1 } });
        });
      }
      if (i > 0) {
        const prev = assets[i - 1];
        const hot = !!h && !!assetRole(prev) && !!role;
        edges.push(flowEdge(prev.id, a.id, line.state === "running" || line.state === "starved", hot, colorOf(line.id), "r", "l"));
      }
    });
    if (showCams) {
      const slot = (i: number) => LINE_PAD_X + i * (MACHINE_W + H_GAP);
      for (const cam of state.cameras.filter((c) => c.lineId === line.id)) {
        const idx = assets.map((a, i) => (cam.covers.includes(a.id) ? i : -1)).filter((i) => i >= 0);
        if (cam.kind === "area") camNode(cam, { x: LINE_PAD_X, y: -30 }, gid);
        else if (idx.length) {
          const mid = (slot(idx[0]) + slot(idx[idx.length - 1]) + MACHINE_W) / 2;
          camNode(cam, { x: mid - CAM_W / 2, y: -30 }, gid, cam.covers);
        }
      }
    }
    maxRowRight = Math.max(maxRowRight, pos.x + width);
    y += height + 36;
  }
  const assemblyBottom = y;

  // Packaging line: vertical column to the right
  let pkgRight = maxRowRight;
  for (const line of packaging) {
    const assets = line.assetIds.map((id) => state.assets.find((a) => a.id === id)).filter(Boolean) as Asset[];
    const width = LINE_PAD_X * 2 + MACHINE_W + (opts.layers.sensors ? 120 : 0);
    const height = LINE_HEADER + assets.length * MACHINE_H + Math.max(0, assets.length - 1) * V_GAP + LINE_PAD_B;
    const gid = `line:${line.id}`;
    const pos = opts.positions[gid] ?? { x: maxRowRight + 90, y: 6 };
    const lineRole: HighlightRole = h && h.lineIds.includes(line.id) ? "impacted" : null;
    nodes.push({
      id: gid,
      type: "line",
      position: pos,
      data: {
        line,
        color: colorOf(line.id),
        throughput: assets.length ? Math.min(...assets.map((a) => a.signal.throughput)) : 0,
        role: lineRole,
        dimmed: !!h && !lineRole,
        roleLabel: lineRole ? "Downstream" : null,
        vertical: true,
      } satisfies LineData,
      style: { width, height },
      draggable: opts.interactive,
      selectable: false,
      zIndex: 0,
    });
    assets.forEach((a, i) => {
      const role = assetRole(a);
      nodes.push({
        id: a.id,
        type: "machine",
        parentId: gid,
        extent: "parent",
        position: opts.positions[a.id] ?? { x: LINE_PAD_X, y: LINE_HEADER + i * (MACHINE_H + V_GAP) },
        data: {
          asset: a,
          lineColor: colorOf(line.id),
          role,
          roleLabel: h ? roleLabelFor(h, role) : null,
          dimmed: !!h && !role,
          vertical: true,
          workOrder: activeWO(a.id),
        } satisfies MachineData,
        draggable: opts.interactive,
        zIndex: 2,
      });
      if (opts.layers.sensors) {
        a.sensors.forEach((s, k) => {
          const sid = `sen:${s.id}`;
          nodes.push({
            id: sid,
            type: "sensor",
            parentId: gid,
            extent: "parent",
            position: { x: LINE_PAD_X + MACHINE_W + 16 + (k % 2) * 50, y: LINE_HEADER + i * (MACHINE_H + V_GAP) + 10 + Math.floor(k / 2) * 34 },
            data: { sensor: s, assetId: a.id, value: sensorValue(a, s), dimmed: !!h && !role } satisfies SensorData,
            draggable: false,
            selectable: false,
            zIndex: 1,
          });
          edges.push({ id: `e:${sid}`, source: sid, target: a.id, type: "straight", sourceHandle: "l", targetHandle: "r-in", style: { stroke: "var(--color-line-strong)", strokeWidth: 1 } });
        });
      }
      if (i > 0) {
        const prev = assets[i - 1];
        const hot = !!h && !!assetRole(prev) && !!role;
        edges.push(flowEdge(prev.id, a.id, line.state === "running" || line.state === "starved", hot, colorOf(line.id), "b", "t"));
      }
    });
    if (showCams) {
      for (const cam of state.cameras.filter((c) => c.lineId === line.id)) {
        if (cam.kind === "area") camNode(cam, { x: width + 12, y: 6 }, gid);
        else {
          const i = assets.findIndex((a) => cam.covers.includes(a.id));
          if (i >= 0) camNode(cam, { x: width + 12, y: LINE_HEADER + i * (MACHINE_H + V_GAP) + 34 }, gid, cam.covers, ["l", "r-in"]);
        }
      }
    }
    // Assembly outputs merge into packaging infeed
    const infeed = assets[0];
    if (infeed) {
      for (const al of assembly) {
        const last = al.assetIds[al.assetIds.length - 1];
        if (!last) continue;
        const hot = !!h && (h.lineIds.includes(al.id) || h.rerouteLineId === al.id) && h.lineIds.includes(line.id);
        edges.push(flowEdge(last, infeed.id, al.state === "running" || al.state === "starved", hot, colorOf(al.id), "r", "l"));
      }
    }
    pkgRight = pos.x + width;
  }

  // Inventory column (left)
  if (opts.layers.inventory) {
    state.inventory.forEach((item, k) => {
      const nid = `inv:${item.id}`;
      const role: HighlightRole = h?.itemIds.includes(item.id) ? "supply" : null;
      nodes.push({
        id: nid,
        type: "inventory",
        position: opts.positions[nid] ?? { x: invX, y: 10 + k * 76 },
        data: { item, coverageHours: opts.coverage[item.id] ?? Infinity, role, dimmed: !!h && !role } satisfies InventoryData,
        draggable: opts.interactive,
        zIndex: 1,
      });
      // Supply edges: item → consuming machine on each line whose allocated (or alternate) product uses it
      for (const line of state.lines) {
        const uses = line.capabilities.filter((c) => c.bom.some((b) => b.itemId === item.id));
        if (!uses.length) continue;
        const active = uses.some((c) => (line.allocation[c.productId] ?? 0) > 0);
        const consumer = consumerFor(state, line, item.id);
        if (!consumer) continue;
        const hot = !!h && !!role && (h.lineIds.includes(line.id) || h.rerouteLineId === line.id);
        edges.push({
          id: `sup:${item.id}:${consumer}`,
          source: nid,
          target: consumer,
          sourceHandle: "r",
          targetHandle: line.kind === "packaging" ? "l-in" : "t-in",
          type: "default",
          animated: false,
          style: {
            stroke: hot ? "var(--color-accent-ink)" : active ? "var(--color-line-strong)" : "var(--color-line)",
            strokeWidth: hot ? 1.8 : 1,
            strokeDasharray: active ? undefined : "4 4",
            opacity: h && !hot ? 0.35 : 1,
          },
          zIndex: 0,
        });
      }
    });
  }

  if (showCams && opts.layers.inventory) {
    for (const cam of state.cameras.filter((x) => !x.lineId && x.kind !== "dock")) camNode(cam, { x: invX, y: -30 });
  }

  // Orders row (below the assembly lines), fed from the end of the packaging line
  if (opts.layers.orders && packaging[0]) {
    const lastPkg = packaging[0].assetIds[packaging[0].assetIds.length - 1];
    state.orders.forEach((o, k) => {
      const nid = `ord:${o.id}`;
      const role: HighlightRole = h?.orderIds.includes(o.id) ? "order" : null;
      nodes.push({
        id: nid,
        type: "order",
        position: opts.positions[nid] ?? { x: lineX + k * 216, y: assemblyBottom + 8 },
        data: {
          order: o,
          productName: state.products.find((p) => p.id === o.productId)?.name ?? o.productId,
          hoursToDue: o.dueHour - state.clock.hour,
          role,
          dimmed: !!h && !role,
          atRisk: !!opts.orderRisk[o.id],
        } satisfies OrderData,
        draggable: opts.interactive,
        zIndex: 1,
      });
      if (lastPkg) {
        edges.push({
          id: `ful:${o.id}`,
          source: lastPkg,
          target: nid,
          sourceHandle: "l",
          targetHandle: "t-in",
          type: "default",
          style: { stroke: role ? "var(--color-accent-ink)" : "var(--color-line-strong)", strokeWidth: role ? 1.8 : 1, opacity: h && !role ? 0.35 : 1 },
          zIndex: 0,
        });
      }
    });
  }

  if (showCams && opts.layers.orders && packaging[0]) {
    for (const cam of state.cameras.filter((x) => x.kind === "dock")) camNode(cam, { x: lineX + state.orders.length * 216, y: assemblyBottom + 30 });
  }

  // User-defined dependencies
  const ids = new Set(nodes.map((n) => n.id));
  for (const c of state.connections) {
    if (!ids.has(c.source) || !ids.has(c.target)) continue;
    edges.push({
      id: `usr:${c.id}`,
      source: c.source,
      target: c.target,
      sourceHandle: "r",
      targetHandle: "l-in",
      type: "default",
      label: "dependency",
      labelStyle: { fill: "var(--color-muted)", fontSize: 10 },
      labelBgStyle: { fill: "var(--color-shell)" },
      style: { stroke: "#9085e9", strokeWidth: 1.4 },
      zIndex: 1,
    });
  }

  void pkgRight;
  return { nodes, edges };
}

function consumerFor(state: FactoryState, line: ProductionLine, itemId: string) {
  const kindPref: Record<string, string[]> = {
    "MCU-7": ["robot"],
    "SNS-40": ["robot"],
    "LTE-M2": ["robot"],
    "CON-24": ["press", "robot"],
    "PCB-E2": ["conveyor"],
    "PCB-S4": ["conveyor"],
    "CTN-S": ["packager"],
  };
  const assets = line.assetIds.map((id) => state.assets.find((a) => a.id === id)).filter(Boolean) as Asset[];
  for (const k of kindPref[itemId] ?? []) {
    const a = assets.find((x) => x.kind === k);
    if (a) return a.id;
  }
  return assets[0]?.id ?? null;
}

function flowEdge(source: string, target: string, running: boolean, hot: boolean, color: string, sh: string, th: string): Edge {
  return {
    id: `flow:${source}:${target}`,
    source,
    target,
    sourceHandle: sh,
    targetHandle: `${th}-in`,
    type: "smoothstep",
    animated: running,
    style: { stroke: hot ? "var(--color-accent-ink)" : running ? color : "var(--color-line-strong)", strokeWidth: hot ? 2.4 : 1.6, opacity: running || hot ? 0.95 : 0.6 },
    zIndex: 1,
  };
}

function sensorValue(a: Asset, s: SensorSpec) {
  switch (s.kind) {
    case "vibration":
      return `${a.signal.vibration.toFixed(1)}`;
    case "temperature":
      return `${a.signal.temperature.toFixed(0)}°`;
    case "power":
      return `${a.signal.powerKw.toFixed(1)}kW`;
    case "counter":
      return `${Math.round(a.signal.throughput)}`;
    default:
      return "ok";
  }
}
