"use client";

import { memo, useMemo, type ReactNode } from "react";
import type { AssetStatus } from "@/domain/types";
import { boxFaces, floorQuad, localExtents, localToWorld, machineParts, project, pts, rotatePoint, UNIT, type Box, type Part, type Tone, type V3 } from "./geometry";
import { FOOTPRINT, layoutIso, type IsoMachine, type IsoModel, type PlacedMachine } from "./model";import { CAMERA_LENS_COLOR, STATUS_COLOR } from "../ui/labels";


export interface IsoHighlight {
  assetIds: string[];
  lineIds: string[];
  targetAssetId: string | null;
  rerouteLineId: string | null;
  targetLabel?: string | null;
}

export interface IsoSceneProps {
  model: IsoModel;
  rotation?: number;
  build?: number;
  statusOverride?: Record<string, AssetStatus>;
  highlight?: IsoHighlight | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  labels?: "all" | "smart" | "none";
  sensors?: boolean;
  camera?: { focusId?: string | null; zoom?: number } | null;
  /** Render CCTV / inspection / thermal cameras (requires `model.cameras`). */
  showCameras?: boolean;
  /** Custom machine label text (e.g. name and planned rate in the Twin Builder preview). */
  labelFor?: (m: IsoMachine) => { title: string; sub: string };
  className?: string;
  title?: string;
}

const CAM_LENS = CAMERA_LENS_COLOR;


const TONES: Record<Exclude<Tone, "accent">, [string, string, string]> = {
  body: ["var(--iso-top)", "var(--iso-right)", "var(--iso-left)"],
  trim: ["var(--iso-trim-top)", "var(--iso-trim-right)", "var(--iso-trim-left)"],
  dark: ["var(--iso-dark)", "var(--iso-dark)", "var(--iso-dark)"],
  belt: ["var(--iso-belt)", "var(--iso-belt-side)", "var(--iso-belt-side)"],
  carton: ["#d6a676", "#b98655", "#9d6f45"],
  white: ["#f4f7fb", "#cfd8e4", "#a7b3c4"],
  glass: ["#7dd3fc", "#38bdf8", "#0ea5e9"],
};

const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

function BoxShape({ b, tone, color, opacity = 1 }: { b: Box; tone: Tone; color?: string; opacity?: number }) {
  if (b.h <= 0.001) return null;
  const f = boxFaces(b);
  if (tone === "accent") {
    const c = color ?? "#4c8dff";
    return (
      <g opacity={opacity}>
        <polygon points={f.left} fill={c} />
        <polygon points={f.left} fill="#000" opacity={0.38} />
        <polygon points={f.right} fill={c} />
        <polygon points={f.right} fill="#000" opacity={0.2} />
        <polygon points={f.top} fill={c} />
        <polygon points={f.top} fill="none" stroke="var(--iso-edge)" strokeWidth={0.6} />
      </g>
    );
  }
  const [t, r, l] = TONES[tone];
  return (
    <g opacity={tone === "glass" ? 0.85 * opacity : opacity}>
      <polygon points={f.left} fill={l} stroke="var(--iso-edge)" strokeWidth={0.6} strokeLinejoin="round" />
      <polygon points={f.right} fill={r} stroke="var(--iso-edge)" strokeWidth={0.6} strokeLinejoin="round" />
      <polygon points={f.top} fill={t} stroke="var(--iso-edge)" strokeWidth={0.6} strokeLinejoin="round" />
    </g>
  );
}

interface Rot {
  k: number;
  cx: number;
  cy: number;
}

function rot(r: Rot, x: number, y: number) {
  return rotatePoint(x, y, r.k, r.cx, r.cy);
}
function rotExt(r: Rot, ex: number, ey: number): [number, number] {
  return r.k % 2 === 0 ? [ex, ey] : [ey, ex];
}

/** Floor-aligned text (painted on the floor along world x after rotation). */
function FloorText({ x, y, text, color, size = 12, r, axis = "x" }: { x: number; y: number; text: string; color: string; size?: number; r: Rot; axis?: "x" | "y" }) {
  let [dx, dy] = axis === "x" ? rotatePoint(1, 0, r.k, 0, 0) : rotatePoint(0, 1, r.k, 0, 0);
  let p0 = project([0, 0, 0]);
  let pd = project([dx, dy, 0]);
  if (pd[0] - p0[0] < 0) {
    dx = -dx;
    dy = -dy;
    pd = project([dx, dy, 0]);
  }
  let pn = project([-dy, dx, 0]);
  p0 = project([0, 0, 0]);
  const a = (pd[0] - p0[0]) / UNIT;
  const b = (pd[1] - p0[1]) / UNIT;
  let c = (pn[0] - p0[0]) / UNIT;
  let d = (pn[1] - p0[1]) / UNIT;
  if (a * d - b * c < 0) {
    pn = project([dy, -dx, 0]);
    c = (pn[0] - p0[0]) / UNIT;
    d = (pn[1] - p0[1]) / UNIT;
  }
  const [e, f] = project([x, y, 0]);
  return (
    <text transform={`matrix(${a} ${b} ${c} ${d} ${e} ${f})`} fontSize={size} fontWeight={700} fill={color} opacity={0.75} letterSpacing={1.5} style={{ textTransform: "uppercase" }}>
      {text}
    </text>
  );
}

function MachineShape({
  pm,
  r,
  rise,
  status,
  dim,
  selected,
  target,
  reroute,
  sensors,
  onSelect,
}: {
  pm: PlacedMachine;
  r: Rot;
  rise: number;
  status: AssetStatus;
  dim: boolean;
  selected: boolean;
  target: boolean;
  reroute: boolean;
  sensors: boolean;
  onSelect?: (id: string) => void;
}) {
  const { parts, height } = machineParts(pm.m.kind);
  const f = FOOTPRINT[pm.m.kind];
  const [wx, wy] = rot(r, pm.x, pm.y);
  const [fex, fey] = rotExt(r, ...localExtents(pm.dir, f.L, f.W));
  const running = status !== "offline" && status !== "maintenance";
  const color = STATUS_COLOR[status];

  // Resolve parts into world-space drawables, sorted back-to-front.
  const drawables: { key: number; z: number; node: ReactNode }[] = [];
  parts.forEach((p: Part, i) => {
    if (p.t === "box") {
      const [px, py] = localToWorld(pm.x, pm.y, pm.dir, p.u, p.v);
      const [rx, ry] = rot(r, px, py);
      const [ex, ey] = rotExt(r, ...localExtents(pm.dir, p.L, p.W));
      const b: Box = { cx: rx, cy: ry, ex, ey, z0: p.z0 * rise, h: p.H * rise };
      drawables.push({ key: rx + ry, z: p.z0, node: <BoxShape key={i} b={b} tone={p.tone} color={pm.color} /> });
    } else if (p.t === "arm") {
      const world = p.points.map(([u, v, z]) => {
        const [px, py] = localToWorld(pm.x, pm.y, pm.dir, u, v);
        const [rx, ry] = rot(r, px, py);
        return project([rx, ry, z * rise] as V3);
      });
      const d = world.map(([x, y], j) => `${j ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      drawables.push({
        key: wx + wy + 0.5,
        z: 9,
        node: (
          <g key={i} className={running && rise >= 1 ? "iso-arm" : undefined}>
            <path d={d} fill="none" stroke="var(--iso-arm-shadow)" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke="var(--iso-arm)" strokeWidth={6.5} strokeLinecap="round" strokeLinejoin="round" />
            {world.slice(0, -1).map(([x, y], j) => (
              <circle key={j} cx={x} cy={y} r={4.2} fill="var(--iso-trim-top)" stroke="var(--iso-edge)" strokeWidth={0.6} />
            ))}
            <circle cx={world[world.length - 1][0]} cy={world[world.length - 1][1]} r={3.6} fill={pm.color} />
          </g>
        ),
      });
    }
  });
  drawables.sort((a, b) => a.key - b.key || a.z - b.z);

  // Stack light at the back corner
  const [lu, lv] = [-f.L / 2 + 0.16, -f.W / 2 + 0.16];
  const [lx, ly] = localToWorld(pm.x, pm.y, pm.dir, lu, lv);
  const [rlx, rly] = rot(r, lx, ly);
  const poleBase = project([rlx, rly, height * 0.55 * rise]);
  const lampP = project([rlx, rly, (height + 0.45) * rise]);

  const padExpand = 0.32;
  const pad = floorQuad(wx - fex - padExpand, wy - fey - padExpand, wx + fex + padExpand, wy + fey + padExpand, 0.01);

  return (
    <g
      className="iso-machine"
      opacity={dim ? 0.28 : 1}
      style={{ transition: "opacity 400ms", cursor: onSelect ? "pointer" : undefined, filter: status === "offline" ? "grayscale(0.7)" : undefined }}
      onClick={onSelect ? (e) => (e.stopPropagation(), onSelect(pm.m.id)) : undefined}
      data-asset={pm.m.id}
    >
      <title>{`${pm.m.id} · ${pm.m.name} · ${status} · health ${pm.m.health.toFixed(0)}`}</title>
      {/* status pad */}
      <polygon
        points={pad}
        fill={status === "maintenance" ? "url(#iso-hazard)" : color}
        fillOpacity={status === "healthy" ? 0.1 : status === "maintenance" ? 0.9 : 0.24}
        stroke={selected ? "var(--color-accent)" : color}
        strokeOpacity={selected ? 1 : 0.55}
        strokeWidth={selected ? 2.2 : 1}
        className={status === "critical" ? "iso-blink" : undefined}
      />
      {(target || reroute) && (
        <polygon
          points={floorQuad(wx - fex - 0.6, wy - fey - 0.6, wx + fex + 0.6, wy + fey + 0.6, 0.01)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={target ? 2.4 : 1.4}
          strokeDasharray={target ? undefined : "5 4"}
          className={target ? "iso-blink" : undefined}
        />
      )}
      {drawables.map((d) => d.node)}
      {/* stack light */}
      {rise > 0.6 && (
        <g>
          <line x1={poleBase[0]} y1={poleBase[1]} x2={lampP[0]} y2={lampP[1]} stroke="var(--iso-trim-left)" strokeWidth={1.6} />
          <circle cx={lampP[0]} cy={lampP[1] - 2} r={9} fill={color} opacity={status === "healthy" ? 0.18 : 0.38} className={status === "critical" || status === "offline" ? "iso-blink" : undefined} />
          <rect x={lampP[0] - 3} y={lampP[1] - 7} width={6} height={8} rx={2} fill={color} stroke="var(--iso-edge)" strokeWidth={0.5} />
        </g>
      )}
      {sensors &&
        rise >= 1 &&
        Array.from({ length: Math.min(4, pm.m.sensors) }).map((_, k) => {
          const [su, sv] = [f.L / 2 - 0.15 - (k % 2) * 0.3, f.W / 2 - 0.15 - Math.floor(k / 2) * 0.3];
          const [sx, sy] = localToWorld(pm.x, pm.y, pm.dir, su, sv);
          const [rsx, rsy] = rot(r, sx, sy);
          const [px, py] = project([rsx, rsy, height * 0.62]);
          return (
            <g key={k}>
              <circle cx={px} cy={py} r={5} fill="#22d3ee" opacity={0.35} className="iso-ping" style={{ animationDelay: `${k * 0.35}s` }} />
              <circle cx={px} cy={py} r={2.2} fill="#22d3ee" />
            </g>
          );
        })}
    </g>
  );
}

function Label({ x, y, z, title, sub, color, emphasis }: { x: number; y: number; z: number; title: string; sub?: string; color: string; emphasis?: boolean }) {
  const [ax, ay] = project([x, y, z]);
  const [bx, by] = project([x, y, z + 0.9]);
  const w = Math.max(title.length, sub?.length ?? 0) * 6.1 + 18;
  const h = sub ? 30 : 18;
  return (
    <g pointerEvents="none">
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color} strokeWidth={1} opacity={0.6} />
      <rect x={bx - w / 2} y={by - h} width={w} height={h} rx={6} fill="var(--iso-label-bg)" stroke={emphasis ? color : "var(--iso-label-border)"} strokeWidth={emphasis ? 1.4 : 0.8} />
      <circle cx={bx - w / 2 + 8} cy={by - h + 9} r={3} fill={color} />
      <text x={bx - w / 2 + 15} y={by - h + 12.5} fontSize={10.5} fontWeight={600} fill="var(--iso-label-ink)" fontFamily="var(--font-mono)">
        {title}
      </text>
      {sub && (
        <text x={bx - w / 2 + 8} y={by - h + 25} fontSize={9.5} fill="var(--iso-label-muted)">
          {sub}
        </text>
      )}
    </g>
  );
}

export const IsoScene = memo(function IsoScene({
  model,
  rotation = 0,
  build = 1,
  statusOverride,
  highlight,
  selectedId,
  onSelect,
  labels = "smart",
  sensors = false,
  camera,
  showCameras = false,
  labelFor,
  className,
  title = "Isometric view of the factory digital twin",
}: IsoSceneProps) {
  const layout = useMemo(() => layoutIso(model), [model]);
  const b = layout.bounds;
  const r: Rot = { k: ((rotation % 4) + 4) % 4, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 };

  // Floor rectangle (rotated) — drawn generously; the view box fits the content.
  const corners = [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ].map(([x, y]) => rot(r, x, y));
  const content: [number, number][] = [];
  for (const pm of layout.machines) {
    const f = FOOTPRINT[pm.m.kind];
    const [wx, wy] = rot(r, pm.x, pm.y);
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      content.push(project([wx + dx * (f.L / 2 + 0.5), wy + dy * (f.L / 2 + 0.5), 0]));
      content.push(project([wx + dx * 0.5, wy + dy * 0.5, machineParts(pm.m.kind).height + 1.6]));
    }
  }
  for (const it of [...layout.racks, ...layout.trucks]) {
    const [wx, wy] = rot(r, it.x, it.y);
    content.push(project([wx - 1.4, wy - 1, 0]), project([wx + 1.4, wy + 1, 0]), project([wx, wy, 1.6]));
  }
  if (showCameras) {
    for (const pc of layout.cameras) {
      const [wx, wy] = rot(r, pc.x, pc.y);
      content.push(project([wx, wy, 0]), project([wx, wy, pc.z + 0.6]));
    }
  }
  for (const bay of layout.bays) {
    for (const [x, y] of [
      [bay.x0 - 0.6, bay.y0 - 0.6],
      [bay.x1 + 0.6, bay.y1 + 0.6],
      [bay.x0 - 0.6, bay.y1 + 0.6],
      [bay.x1 + 0.6, bay.y0 - 0.6],
    ]) {
      const [wx, wy] = rot(r, x, y);
      content.push(project([wx, wy, 0]));
    }
  }
  const minX = Math.min(...content.map((p) => p[0])) - 12;
  const maxX = Math.max(...content.map((p) => p[0])) + 12;
  const minY = Math.min(...content.map((p) => p[1])) - 12;
  const maxY = Math.max(...content.map((p) => p[1])) + 12;
  const vbW = maxX - minX;
  const vbH = maxY - minY;

  // Camera focus (landing story)
  let camTransform = "translate(0px, 0px) scale(1)";
  if (camera?.focusId) {
    const fid = camera.focusId;
    const pm =
      layout.machines.find((m) => m.m.id === fid) ??
      layout.trucks.map((t) => ({ x: t.x, y: t.y, id: `ord:${t.id}` })).find((t) => t.id === fid) ??
      layout.racks.map((k) => ({ x: k.x, y: k.y, id: `inv:${k.id}` })).find((k) => k.id === fid) ??
      (fid === "zone:dock" && layout.trucks.length ? { x: layout.trucks.reduce((a, t) => a + t.x, 0) / layout.trucks.length, y: layout.trucks[0].y } : null) ??
      (fid === "zone:stores" && layout.racks.length ? { x: layout.racks.reduce((a, k) => a + k.x, 0) / layout.racks.length, y: layout.racks.reduce((a, k) => a + k.y, 0) / layout.racks.length } : null) ??
      (fid.startsWith("line:") ? (() => {
        const ms = layout.machines.filter((m) => m.lineId === fid.slice(5));
        return ms.length ? { x: ms.reduce((a, m) => a + m.x, 0) / ms.length, y: ms.reduce((a, m) => a + m.y, 0) / ms.length } : null;
      })() : null);
    if (pm) {
      const [fx, fy] = rot(r, pm.x, pm.y);
      const [sx, sy] = project([fx, fy, 0.8]);
      const z = camera.zoom ?? 1.8;
      const cx = minX + vbW / 2;
      const cy = minY + vbH / 2;
      camTransform = `translate(${cx - sx * z}px, ${cy - sy * z}px) scale(${z})`;
    }
  } else if (camera?.zoom && camera.zoom !== 1) {
    const z = camera.zoom;
    const cx = minX + vbW / 2;
    const cy = minY + vbH / 2;
    camTransform = `translate(${cx * (1 - z)}px, ${cy * (1 - z)}px) scale(${z})`;
  }

  const n = layout.machines.length;
  const riseOf = (i: number) => ease((build - (i / Math.max(1, n)) * 0.55) / 0.45);
  const floorOpacity = ease(build / 0.2);
  const beltsOn = build > 0.82;
  const statusOf = (id: string, s: AssetStatus) => statusOverride?.[id] ?? s;
  const affected = (pm: PlacedMachine) =>
    !highlight || highlight.assetIds.includes(pm.m.id) || highlight.lineIds.includes(pm.lineId) || highlight.targetAssetId === pm.m.id;

  // Floor grid
  const grid: ReactNode[] = [];
  for (let gx = Math.ceil(b.x0); gx <= b.x1; gx += 2) {
    const [ax, ay] = rot(r, gx, b.y0);
    const [bx2, by2] = rot(r, gx, b.y1);
    const p1 = project([ax, ay, 0]);
    const p2 = project([bx2, by2, 0]);
    grid.push(<line key={`gx${gx}`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="var(--iso-grid)" strokeWidth={0.7} />);
  }
  for (let gy = Math.ceil(b.y0); gy <= b.y1; gy += 2) {
    const [ax, ay] = rot(r, b.x0, gy);
    const [bx2, by2] = rot(r, b.x1, gy);
    const p1 = project([ax, ay, 0]);
    const p2 = project([bx2, by2, 0]);
    grid.push(<line key={`gy${gy}`} x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="var(--iso-grid)" strokeWidth={0.7} />);
  }

  const floorPoly = pts(corners.map(([x, y]) => project([x, y, 0])));

  // Depth-sorted solids: machines, racks, trucks
  type Solid = { key: number; node: ReactNode };
  const solids: Solid[] = [];
  layout.machines.forEach((pm) => {
    const [wx, wy] = rot(r, pm.x, pm.y);
    const st = statusOf(pm.m.id, pm.m.status);
    const rise = riseOf(pm.index);
    if (rise <= 0) return;
    solids.push({
      key: wx + wy,
      node: (
        <MachineShape
          key={pm.m.id}
          pm={pm}
          r={r}
          rise={rise}
          status={st}
          dim={!affected(pm)}
          selected={selectedId === pm.m.id}
          target={highlight?.targetAssetId === pm.m.id}
          reroute={!!highlight?.rerouteLineId && highlight.rerouteLineId === pm.lineId}
          sensors={sensors}
          onSelect={onSelect}
        />
      ),
    });
  });
  layout.racks.forEach((rk, i) => {
    const [wx, wy] = rot(r, rk.x, rk.y);
    const rise = ease((build - (i / Math.max(1, layout.racks.length)) * 0.3) / 0.5);
    if (rise <= 0) return;
    const sel = selectedId === `inv:${rk.id}`;
    solids.push({
      key: wx + wy,
      node: (
        <g key={rk.id} style={{ cursor: onSelect ? "pointer" : undefined }} onClick={onSelect ? (e) => (e.stopPropagation(), onSelect(`inv:${rk.id}`)) : undefined} opacity={highlight ? 0.45 : 1}>
          <title>{`${rk.id} · ${rk.name}`}</title>
          <polygon points={floorQuad(wx - 0.55, wy - 0.55, wx + 0.55, wy + 0.55, 0.01)} fill={rk.low ? "#f59e0b" : "var(--iso-grid)"} fillOpacity={rk.low ? 0.22 : 0.6} stroke={sel ? "var(--color-accent)" : "none"} strokeWidth={2} />
          <BoxShape b={{ cx: wx, cy: wy, ex: 0.45, ey: 0.45, z0: 0, h: 0.06 * rise }} tone="trim" />
          <BoxShape b={{ cx: wx, cy: wy, ex: 0.4, ey: 0.4, z0: 0.06 * rise, h: 1.05 * rk.fill * rise }} tone="carton" />
          <BoxShape b={{ cx: wx, cy: wy, ex: 0.45, ey: 0.45, z0: 1.15 * rise, h: 0.05 * rise }} tone="trim" />
        </g>
      ),
    });
  });
  layout.trucks.forEach((t, i) => {
    const rise = ease((build - 0.5 - i * 0.05) / 0.4);
    if (rise <= 0) return;
    const [wx, wy] = rot(r, t.x, t.y);
    const [cabX, cabY] = rot(r, t.x - 1.15, t.y);
    const [tex, tey] = rotExt(r, 0.85, 0.42);
    const [cex, cey] = rotExt(r, 0.3, 0.42);
    const fillH = 0.75 * Math.max(0.04, Math.min(1, t.progress)) * rise;
    const sel = selectedId === `ord:${t.id}`;
    solids.push({
      key: wx + wy,
      node: (
        <g key={t.id} style={{ cursor: onSelect ? "pointer" : undefined }} onClick={onSelect ? (e) => (e.stopPropagation(), onSelect(`ord:${t.id}`)) : undefined}>
          <title>{`${t.id} · ${t.customer} · ${Math.round(t.progress * 100)}% loaded`}</title>
          <polygon
            points={floorQuad(Math.min(wx, cabX) - 1.1, Math.min(wy, cabY) - 0.75, Math.max(wx, cabX) + 1.1, Math.max(wy, cabY) + 0.75, 0.01)}
            fill={t.atRisk ? "#ef4444" : "var(--iso-grid)"}
            fillOpacity={t.atRisk ? 0.2 : 0.5}
            stroke={sel ? "var(--color-accent)" : t.atRisk ? "#ef4444" : "none"}
            strokeWidth={sel ? 2 : 1}
            className={t.atRisk ? "iso-blink" : undefined}
          />
          <BoxShape b={{ cx: wx, cy: wy, ex: tex, ey: tey, z0: 0.12, h: fillH }} tone="carton" />
          <BoxShape b={{ cx: wx, cy: wy, ex: tex, ey: tey, z0: 0.12 + fillH, h: Math.max(0, 0.78 * rise - fillH) }} tone="white" opacity={0.92} />
          <BoxShape b={{ cx: cabX, cy: cabY, ex: cex, ey: cey, z0: 0.08, h: 0.62 * rise }} tone="accent" color={t.priority === "critical" ? "#ef4444" : "#4c8dff"} />
        </g>
      ),
    });
  });
  solids.sort((a, b2) => a.key - b2.key);

  // Labels
  const labelItems: { key: number; node: ReactNode }[] = [];
  if (labels !== "none" && build >= 0.98) {
    for (const pm of layout.machines) {
      const st = statusOf(pm.m.id, pm.m.status);
      const isTarget = highlight?.targetAssetId === pm.m.id;
      const show = labels === "all" || st !== "healthy" || selectedId === pm.m.id || isTarget;
      if (!show) continue;
      const [wx, wy] = rot(r, pm.x, pm.y);
      const { height } = machineParts(pm.m.kind);
      const custom = labelFor?.(pm.m);
      const sub = custom?.sub ?? (isTarget && highlight?.targetLabel ? highlight.targetLabel : st === "healthy" ? `health ${pm.m.health.toFixed(0)}` : `${st} · health ${pm.m.health.toFixed(0)}`);
      labelItems.push({ key: wx + wy, node: <Label key={pm.m.id} x={wx} y={wy} z={height + 0.4} title={custom?.title ?? pm.m.id} sub={sub} color={isTarget ? "var(--color-accent)" : STATUS_COLOR[st]} emphasis={st !== "healthy" || isTarget || selectedId === pm.m.id} /> });
    }
    for (const t of layout.trucks) {
      if (!t.atRisk && selectedId !== `ord:${t.id}`) continue;
      const [wx, wy] = rot(r, t.x, t.y);
      labelItems.push({ key: wx + wy, node: <Label key={t.id} x={wx} y={wy} z={1} title={t.id} sub={`${Math.round(t.progress * 100)}% loaded${t.atRisk ? " · at risk" : ""}`} color={t.atRisk ? "#ef4444" : "#4c8dff"} emphasis /> });
    }
  }
  const sortedLabels = labelItems.sort((a, b2) => a.key - b2.key).map((l) => l.node);

  // Cameras: floor field-of-view wedges (under everything) and pole-mounted heads (over everything).
  const camWedges: ReactNode[] = [];
  const camHeads: ReactNode[] = [];
  const camA11y = (camId: string) =>
    onSelect
      ? {
          role: "button",
          tabIndex: 0,
          "aria-label": `Camera ${camId}`,
          className: "outline-none",
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") (e.preventDefault(), onSelect(`cam:${camId}`));
          },
        }
      : {};
  if (showCameras && build >= 0.98) {
    for (const pc of layout.cameras) {
      const id = `cam:${pc.cam.id}`;
      const sel = selectedId === id;
      const lens = pc.cam.alert ? "#ef4444" : (CAM_LENS[pc.cam.kind] ?? "#38bdf8");
      const [mx, my] = rot(r, pc.x, pc.y);
      const base = project([mx, my, 0]);
      const head = project([mx, my, pc.z]);
      const pick = onSelect ? (e: React.MouseEvent) => (e.stopPropagation(), onSelect(id)) : undefined;
      if (pc.aim) {
        const [ax, ay] = rot(r, pc.aim[0], pc.aim[1]);
        const dx = ax - mx;
        const dy = ay - my;
        const len = Math.hypot(dx, dy) || 1;
        const px = (-dy / len) * pc.spread;
        const py = (dx / len) * pc.spread;
        const far = 1.18;
        const p1 = project([mx + dx * far + px, my + dy * far + py, 0.02]);
        const p2 = project([mx + dx * far - px, my + dy * far - py, 0.02]);
        camWedges.push(
          <polygon
            key={`w-${pc.cam.id}`}
            points={pts([base, p1, p2])}
            fill={pc.cam.kind === "thermal" ? "#fb923c" : "var(--color-accent)"}
            fillOpacity={sel ? 0.2 : 0.055}
            stroke={sel ? (pc.cam.kind === "thermal" ? "#fb923c" : "var(--color-accent)") : "none"}
            strokeOpacity={0.7}
            strokeDasharray="5 4"
            strokeWidth={1.2}
            pointerEvents="none"
          />,
        );
        // lens offset toward the aim point in screen space
        const aimS = project([ax, ay, 0]);
        const ux = aimS[0] - head[0];
        const uy = aimS[1] - head[1];
        const ul = Math.hypot(ux, uy) || 1;
        const lx = head[0] + (ux / ul) * 7;
        const ly = head[1] + (uy / ul) * 4;
        camHeads.push(
          <g key={`c-${pc.cam.id}`} style={{ cursor: pick ? "pointer" : undefined }} onClick={pick} {...camA11y(pc.cam.id)}>
            <title>{`${pc.cam.id} · ${pc.cam.name}`}</title>
            <line x1={base[0]} y1={base[1]} x2={head[0]} y2={head[1] + 3} stroke="var(--iso-trim-left)" strokeWidth={2} />
            <ellipse cx={base[0]} cy={base[1]} rx={4} ry={2} fill="var(--iso-trim-left)" />
            <circle cx={head[0]} cy={head[1]} r={12} fill="transparent" />
            {sel && <circle cx={head[0]} cy={head[1]} r={11} fill="none" stroke="var(--color-accent)" strokeWidth={2} />}
            <rect x={head[0] - 7} y={head[1] - 5} width={14} height={10} rx={3} fill="var(--iso-label-bg)" stroke="var(--iso-label-border)" strokeWidth={1} />
            <circle cx={lx} cy={ly} r={3.2} fill={lens} stroke="var(--iso-label-bg)" strokeWidth={1} />
            <circle cx={head[0] - 4} cy={head[1] - 2.4} r={1.4} fill="#ef4444" className="iso-blink" />
            {pc.cam.alert && <circle cx={head[0]} cy={head[1]} r={9} fill="none" stroke="#ef4444" strokeWidth={1.5} className="iso-ping" />}
          </g>,
        );
      } else {
        // Inspection camera sitting on its station: lens pointing down with a scan cone.
        const top = project([mx, my, pc.z - 0.9]);
        camHeads.push(
          <g key={`c-${pc.cam.id}`} style={{ cursor: pick ? "pointer" : undefined }} onClick={pick} {...camA11y(pc.cam.id)}>
            <title>{`${pc.cam.id} · ${pc.cam.name}`}</title>
            <polygon points={pts([[head[0] - 3, head[1] + 4], [head[0] + 3, head[1] + 4], [top[0] + 9, top[1]], [top[0] - 9, top[1]]])} fill={lens} opacity={sel ? 0.35 : 0.16} />
            <circle cx={head[0]} cy={head[1]} r={12} fill="transparent" />
            {sel && <circle cx={head[0]} cy={head[1]} r={11} fill="none" stroke="var(--color-accent)" strokeWidth={2} />}
            <rect x={head[0] - 8} y={head[1] - 6} width={16} height={11} rx={3} fill="var(--iso-label-bg)" stroke={pc.cam.alert ? "#ef4444" : "var(--iso-label-border)"} strokeWidth={1.2} />
            <circle cx={head[0]} cy={head[1] + 0.5} r={3.2} fill={lens} />
            {pc.cam.alert && <circle cx={head[0]} cy={head[1]} r={9} fill="none" stroke="#ef4444" strokeWidth={1.5} className="iso-ping" />}
          </g>,
        );
      }
      if (sel && labels !== "none") {
        const [lx2, ly2] = [mx, my];
        camHeads.push(<Label key={`l-${pc.cam.id}`} x={lx2} y={ly2} z={pc.z + 0.55} title={pc.cam.id} sub={pc.cam.name} color={lens} emphasis />);
      }
    }
  }

  return (
    <svg viewBox={`${minX} ${minY} ${vbW} ${vbH}`} className={className} role="img" aria-label={title} style={{ overflow: "visible" }}>
      <defs>
        <pattern id="iso-hazard" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="#818cf8" opacity="0.25" />
          <rect width="4" height="8" fill="#818cf8" opacity="0.55" />
        </pattern>
      </defs>
      <g style={{ transform: camTransform, transition: "transform 900ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
        <g opacity={floorOpacity}>
          <polygon points={floorPoly} fill="var(--iso-floor)" stroke="var(--iso-floor-edge)" strokeWidth={1} />
          {grid}
          {layout.bays.map((bay) => {
            const c = [
              [bay.x0, bay.y0],
              [bay.x1, bay.y0],
              [bay.x1, bay.y1],
              [bay.x0, bay.y1],
            ].map(([x, y]) => rot(r, x, y));
            const xs = c.map((p) => p[0]);
            const ys = c.map((p) => p[1]);
            const hl = highlight && (highlight.lineIds.includes(bay.id) || highlight.rerouteLineId === bay.id);
            const vertical = bay.y1 - bay.y0 > bay.x1 - bay.x0;
            const [lx, ly] = vertical ? rot(r, bay.x1 + 0.3, bay.y0 + 0.2) : rot(r, bay.x0 + 0.1, bay.y1 + 0.62);
            return (
              <g key={bay.id}>
                <polygon
                  points={floorQuad(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 0.005)}
                  fill="var(--iso-bay)"
                  stroke={hl ? "var(--color-accent)" : bay.color}
                  strokeOpacity={hl ? 0.9 : 0.55}
                  strokeWidth={hl ? 2 : 1.2}
                  strokeDasharray={hl ? undefined : "6 5"}
                  opacity={highlight && !hl ? 0.5 : 1}
                />
                <FloorText x={lx} y={ly} text={bay.name} color={bay.color} size={11} r={r} axis={vertical ? "y" : "x"} />
              </g>
            );
          })}
        </g>
        {camWedges}
        {beltsOn &&
          layout.belts.map((bt) => {
            const [ax, ay] = rot(r, ...bt.from);
            const [bx2, by2] = rot(r, ...bt.to);
            const horiz = Math.abs(bx2 - ax) > Math.abs(by2 - ay);
            const box: Box = horiz
              ? { cx: (ax + bx2) / 2, cy: (ay + by2) / 2, ex: Math.abs(bx2 - ax) / 2, ey: 0.24, z0: 0, h: 0.26 }
              : { cx: (ax + bx2) / 2, cy: (ay + by2) / 2, ex: 0.24, ey: Math.abs(by2 - ay) / 2, z0: 0, h: 0.26 };
            const p1 = project([ax, ay, 0.27]);
            const p2 = project([bx2, by2, 0.27]);
            const hot = !!highlight && (highlight.rerouteLineId === bt.lineId || highlight.lineIds.includes(bt.lineId));
            const dim = !!highlight && !hot;
            return (
              <g key={bt.id} opacity={dim ? 0.3 : 1}>
                <BoxShape b={box} tone="belt" />
                {bt.running && (
                  <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke={hot ? "var(--color-accent)" : bt.color} strokeWidth={hot ? 3 : 2.2} strokeLinecap="round" className="iso-flow" />
                )}
              </g>
            );
          })}
        {solids.map((s) => s.node)}
        {camHeads}
        {sortedLabels}
      </g>
    </svg>
  );
});
