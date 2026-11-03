"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Line, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { AssetKind, AssetStatus } from "@/domain/types";
import { machineParts, type Part, type Tone } from "../iso/geometry";
import { FOOTPRINT, type Belt, type Bay, type Layout, type PlacedCamera, type PlacedMachine } from "../iso/model";
import { amrPose, type AmrPath } from "./amr-paths";
import type { MaterialName, Materials, Quality } from "./materials";
import type { Palette } from "./palette";import { CAMERA_LENS_COLOR, STATUS_COLOR } from "../ui/labels";


/** Layout (x, y on the floor, z up) → three.js (x, y up, z). */
export const P = (x: number, y: number, z = 0) => [x, z, y] as [number, number, number];

export { STATUS_COLOR };
const CAM_LENS = CAMERA_LENS_COLOR;
const WALL_H = 3.2;

const TONE_MATERIAL: Record<Exclude<Tone, "accent">, MaterialName> = {
  body: "enclosure",
  trim: "steel",
  dark: "darkPlastic",
  belt: "rubber",
  carton: "carton",
  white: "white",
  glass: "glass",
};
/** Machines with an operator panel (HMI) on a pedestal. */
const HMI_KINDS = new Set<AssetKind>(["press", "cnc", "packager", "labeler", "oven", "filler", "molder", "mixer", "extruder", "welder", "camera", "palletizer"]);

const pick = (fn?: () => void) =>
  fn
    ? {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          fn();
        },
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        },
        onPointerOut: () => {
          document.body.style.cursor = "";
        },
      }
    : {};

/** A box with softly rounded edges on High quality (plain box on Standard). */
function Solid({ size, position, material, quality, cast = true }: { size: [number, number, number]; position: [number, number, number]; material: THREE.Material; quality: Quality; cast?: boolean }) {
  const [x, y, z] = size;
  const r = Math.min(0.035, Math.min(x, y, z) / 4);
  if (quality === "high" && r > 0.006)
    return <RoundedBox args={size} radius={r} smoothness={2} position={position} material={material} castShadow={cast} receiveShadow />;
  return (
    <mesh position={position} material={material} castShadow={cast} receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

/* ─────────────────────────────── building ─────────────────────────────── */

/**
 * Floor, walls and columns. The walls face inward, so the wall between the camera and the plant
 * is culled automatically: orbiting never hides the twin behind a wall.
 */
export function Shell({ layout, mats, quality, onMiss }: { layout: Layout; mats: Materials; quality: Quality; onMiss: () => void }) {
  const b = layout.bounds;
  const x0 = b.x0 - 1.4;
  const x1 = b.x1 + 1.4;
  const y0 = b.y0 - 1.4;
  const y1 = b.y1 + 1.4;
  const w = x1 - x0;
  const d = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  useMemo(() => {
    mats.floor.map?.repeat.set(w / 4, d / 4);
    mats.wall.map?.repeat.set(Math.max(w, d) / 6, 1);
  }, [mats, w, d]);
  const walls: { pos: [number, number, number]; rot: number; len: number }[] = [
    { pos: P(cx, y0, WALL_H / 2), rot: 0, len: w },
    { pos: P(cx, y1, WALL_H / 2), rot: Math.PI, len: w },
    { pos: P(x0, cy, WALL_H / 2), rot: Math.PI / 2, len: d },
    { pos: P(x1, cy, WALL_H / 2), rot: -Math.PI / 2, len: d },
  ];
  // Columns along each wall, tagged with the walls they stand on (corners belong to two).
  const columns: { x: number; y: number; sides: ("x0" | "x1" | "y0" | "y1")[] }[] = [];
  const nx = Math.max(1, Math.round(w / 6));
  const ny = Math.max(1, Math.round(d / 6));
  for (let i = 0; i <= nx; i++) {
    const x = x0 + (i * w) / nx;
    const edge = i === 0 ? ["x0" as const] : i === nx ? ["x1" as const] : [];
    columns.push({ x, y: y0, sides: ["y0", ...edge] }, { x, y: y1, sides: ["y1", ...edge] });
  }
  for (let j = 1; j < ny; j++) {
    const y = y0 + (j * d) / ny;
    columns.push({ x: x0, y, sides: ["x0"] }, { x: x1, y, sides: ["x1"] });
  }
  // Like the walls, columns on the side facing the camera are hidden so they never block the view.
  const colRefs = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ camera }) => {
    const hidden = { x0: camera.position.x < x0, x1: camera.position.x > x1, y0: camera.position.z < y0, y1: camera.position.z > y1 };
    columns.forEach((c, i) => {
      const g = colRefs.current[i];
      if (g) g.visible = !c.sides.some((sd) => hidden[sd]);
    });
  });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={P(cx, cy, 0)} receiveShadow onClick={onMiss} material={mats.floor}>
        <planeGeometry args={[w, d]} />
      </mesh>
      {walls.map((wl, i) => (
        <group key={i} position={wl.pos} rotation={[0, wl.rot, 0]}>
          <mesh material={mats.wall} receiveShadow>
            <planeGeometry args={[wl.len, WALL_H]} />
          </mesh>
          {quality === "high" && (
            <mesh position={[0, WALL_H / 2 - 0.35, 0.01]} material={mats.get("windowBand")}>
              <planeGeometry args={[wl.len * 0.92, 0.28]} />
            </mesh>
          )}
        </group>
      ))}
      {columns.map(({ x, y }, i) => (
        <group key={i} position={P(x, y)} ref={(g) => void (colRefs.current[i] = g)}>
          <mesh position={[0, WALL_H / 2, 0]} material={mats.get("column")} castShadow>
            <boxGeometry args={[0.2, WALL_H, 0.2]} />
          </mesh>
          <mesh position={[0, 0.2, 0]} material={mats.get("safetyYellow")}>
            <boxGeometry args={[0.28, 0.4, 0.28]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A production bay: a painted work zone with yellow safety-tape edges. */
export function BayZone({ bay, mats, accent, color, hot, dim }: { bay: Bay; mats: Materials; accent: string; color: string; hot: boolean; dim: boolean }) {
  const w = bay.x1 - bay.x0;
  const d = bay.y1 - bay.y0;
  const t = 0.07;
  const edge = hot ? mats.paint(accent) : mats.get("safetyYellow", dim);
  const tapes: { pos: [number, number, number]; size: [number, number] }[] = [
    { pos: P((bay.x0 + bay.x1) / 2, bay.y0, 0.006), size: [w, t] },
    { pos: P((bay.x0 + bay.x1) / 2, bay.y1, 0.006), size: [w, t] },
    { pos: P(bay.x0, (bay.y0 + bay.y1) / 2, 0.006), size: [t, d] },
    { pos: P(bay.x1, (bay.y0 + bay.y1) / 2, 0.006), size: [t, d] },
  ];
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={P((bay.x0 + bay.x1) / 2, (bay.y0 + bay.y1) / 2, 0.003)} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={color} roughness={0.75} transparent opacity={dim ? 0.05 : hot ? 0.22 : 0.12} depthWrite={false} />
      </mesh>
      {tapes.map((tp, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={tp.pos} material={edge}>
          <planeGeometry args={tp.size} />
        </mesh>
      ))}
    </group>
  );
}

/* ─────────────────────────────── machines ─────────────────────────────── */

/**
 * An industrial robot arm with forward kinematics: links between the joints of the machine's pose,
 * animated through a pick-and-place motion while the machine runs, with a two-finger gripper.
 */
function RobotArm({ points, mats, quality, dim, moving, phase }: { points: [number, number, number][]; mats: Materials; quality: Quality; dim: boolean; moving: boolean; phase: number }) {
  const rig = useMemo(() => {
    const [bu, bv, bz] = points[0];
    const end = points[points.length - 1];
    const heading = Math.atan2(end[1] - bv, end[0] - bu) || 0;
    const planar = points.map(([u, v, z]) => [(u - bu) * Math.cos(heading) + (v - bv) * Math.sin(heading), z - bz] as [number, number]);
    const lens: number[] = [];
    const abs: number[] = [];
    for (let i = 1; i < planar.length; i++) {
      const dx = planar[i][0] - planar[i - 1][0];
      const dz = planar[i][1] - planar[i - 1][1];
      lens.push(Math.hypot(dx, dz));
      abs.push(Math.atan2(dz, dx));
    }
    const rel = abs.map((a, i) => (i === 0 ? a : a - abs[i - 1]));
    return { base: [bu, bz, bv] as [number, number, number], heading, lens, rel };
  }, [points]);
  const yaw = useRef<THREE.Group>(null);
  const links = useRef<(THREE.Mesh | null)[]>([]);
  const joints = useRef<(THREE.Mesh | null)[]>([]);
  const tool = useRef<THREE.Group>(null);
  const fingers = useRef<(THREE.Mesh | null)[]>([]);
  const wave = [0.12, -0.22, 0.3];
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 1.1 + phase;
    const k = moving ? 1 : 0;
    if (yaw.current) yaw.current.rotation.y = -rig.heading + k * Math.sin(t * 0.8) * 0.65;
    let x = 0;
    let y = 0;
    let a = 0;
    for (let i = 0; i < rig.lens.length; i++) {
      a += rig.rel[i] + k * (wave[i] ?? 0.2) * Math.sin(t + i * 0.7);
      const nx = x + rig.lens[i] * Math.cos(a);
      const ny = y + rig.lens[i] * Math.sin(a);
      const link = links.current[i];
      if (link) {
        link.position.set((x + nx) / 2, (y + ny) / 2, 0);
        link.rotation.set(0, 0, a - Math.PI / 2);
      }
      const j = joints.current[i];
      if (j) j.position.set(x, y, 0);
      x = nx;
      y = ny;
    }
    if (tool.current) {
      tool.current.position.set(x, y, 0);
      tool.current.rotation.set(0, 0, a - Math.PI / 2);
    }
    const open = 0.035 + k * 0.03 * (Math.sin(t * 2) + 1);
    fingers.current.forEach((f, i) => f && (f.position.z = (i ? 1 : -1) * open));
  });
  const linkMat = mats.get("robot", dim);
  const jointMat = mats.get("joint", dim);
  const radius = (i: number) => Math.max(0.045, 0.085 - i * 0.017);
  return (
    <group position={rig.base}>
      <group ref={yaw}>
        {rig.lens.map((len, i) => (
          <group key={i}>
            <mesh ref={(m) => void (links.current[i] = m)} material={linkMat} castShadow>
              {quality === "high" ? <capsuleGeometry args={[radius(i), Math.max(0.01, len - radius(i) * 2), 6, 14]} /> : <cylinderGeometry args={[radius(i), radius(i), len, 12]} />}
            </mesh>
            <mesh ref={(m) => void (joints.current[i] = m)} material={jointMat} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[radius(i) * 1.25, radius(i) * 1.25, radius(i) * 2.6, 16]} />
            </mesh>
          </group>
        ))}
        <group ref={tool}>
          <mesh position={[0, 0.03, 0]} material={jointMat}>
            <cylinderGeometry args={[0.05, 0.05, 0.06, 14]} />
          </mesh>
          {[0, 1].map((i) => (
            <mesh key={i} ref={(m) => void (fingers.current[i] = m)} position={[0, 0.1, 0]} material={mats.get("steel", dim)}>
              <boxGeometry args={[0.03, 0.1, 0.02]} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

function StackLight({ position, height, status, mats }: { position: [number, number]; height: number; status: AssetStatus; mats: Materials }) {
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  const color = STATUS_COLOR[status];
  const blink = status === "critical" || status === "offline";
  useFrame(({ clock }) => {
    if (lamp.current) lamp.current.emissiveIntensity = blink ? (Math.sin(clock.elapsedTime * 6) > 0 ? 2.4 : 0.2) : 1.4;
  });
  return (
    <group position={[position[0], 0, position[1]]}>
      <mesh position={[0, height * 0.55 + (height * 0.45 + 0.45) / 2, 0]} material={mats.get("steel")}>
        <cylinderGeometry args={[0.02, 0.02, height * 0.45 + 0.45, 8]} />
      </mesh>
      <mesh position={[0, height + 0.5, 0]}>
        <cylinderGeometry args={[0.065, 0.065, 0.16, 16]} />
        <meshStandardMaterial ref={lamp} color={color} emissive={color} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <mesh position={[0, height + 0.6, 0]} material={mats.get("darkPlastic")}>
        <cylinderGeometry args={[0.05, 0.065, 0.04, 16]} />
      </mesh>
    </group>
  );
}

/** Operator panel on a pedestal beside the machine. */
function Hmi({ u, v, mats, dim }: { u: number; v: number; mats: Materials; dim: boolean }) {
  return (
    <group position={[u, 0, v]}>
      <mesh position={[0, 0.42, 0]} material={mats.get("steel", dim)} castShadow>
        <boxGeometry args={[0.05, 0.84, 0.05]} />
      </mesh>
      <group position={[0, 0.9, 0]} rotation={[-0.45, 0, 0]}>
        <mesh material={mats.get("bezel", dim)} castShadow>
          <boxGeometry args={[0.34, 0.24, 0.05]} />
        </mesh>
        <mesh position={[0, 0, 0.027]} material={mats.get("screen", dim)}>
          <planeGeometry args={[0.28, 0.18]} />
        </mesh>
      </group>
    </group>
  );
}

/** Safety fencing around a robot cell, with openings where the conveyor passes through. */
function Fence({ L, W, mats, dim }: { L: number; W: number; mats: Materials; dim: boolean }) {
  const hu = L / 2 + 0.35;
  const hv = W / 2 + 0.25;
  const h = 0.95;
  const gap = 0.32;
  // Panels: [centre u, centre v, length, along u?]
  const panels: [number, number, number, boolean][] = [
    [0, -hv, hu * 2, true],
    [0, hv, hu * 2, true],
    [-hu, -(hv + gap) / 2, hv - gap, false],
    [-hu, (hv + gap) / 2, hv - gap, false],
    [hu, -(hv + gap) / 2, hv - gap, false],
    [hu, (hv + gap) / 2, hv - gap, false],
  ];
  const posts: [number, number][] = [
    [-hu, -hv],
    [hu, -hv],
    [-hu, hv],
    [hu, hv],
    [-hu, -gap],
    [-hu, gap],
    [hu, -gap],
    [hu, gap],
  ];
  return (
    <group>
      {panels.map(([u, v, len, alongU], i) => (
        <mesh key={i} position={[u, h / 2 + 0.05, v]} rotation={[0, alongU ? 0 : Math.PI / 2, 0]} material={mats.get("fenceMesh", dim)}>
          <planeGeometry args={[len, h]} />
        </mesh>
      ))}
      {posts.map(([u, v], i) => (
        <mesh key={i} position={[u, (h + 0.1) / 2, v]} material={mats.get("safetyYellow", dim)} castShadow>
          <boxGeometry args={[0.04, h + 0.1, 0.04]} />
        </mesh>
      ))}
      {/* top rails */}
      {panels.map(([u, v, len, alongU], i) => (
        <mesh key={`r${i}`} position={[u, h + 0.06, v]} rotation={[0, alongU ? 0 : Math.PI / 2, 0]} material={mats.get("safetyYellow", dim)}>
          <boxGeometry args={[len, 0.035, 0.035]} />
        </mesh>
      ))}
    </group>
  );
}

function Pulse({ w, d, color, dashed }: { w: number; d: number; color: string; dashed?: boolean }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + (dashed ? 0 : 0.04 * Math.sin(clock.elapsedTime * 4));
      ref.current.scale.set(s, 1, s);
    }
  });
  const c: [number, number, number][] = [
    [-w / 2, 0.02, -d / 2],
    [w / 2, 0.02, -d / 2],
    [w / 2, 0.02, d / 2],
    [-w / 2, 0.02, d / 2],
    [-w / 2, 0.02, -d / 2],
  ];
  return (
    <group ref={ref}>
      <Line points={c} color={color} lineWidth={dashed ? 1.6 : 2.6} dashed={dashed} dashSize={0.25} gapSize={0.18} />
    </group>
  );
}

export function Machine3D({
  pm,
  pal,
  mats,
  quality,
  status,
  dim,
  selected,
  target,
  reroute,
  onSelect,
}: {
  pm: PlacedMachine;
  pal: Palette;
  mats: Materials;
  quality: Quality;
  status: AssetStatus;
  dim: boolean;
  selected: boolean;
  target: boolean;
  reroute: boolean;
  onSelect?: () => void;
}) {
  const { parts, height } = useMemo(() => machineParts(pm.m.kind), [pm.m.kind]);
  const f = FOOTPRINT[pm.m.kind];
  const line = pal.resolve(pm.color);
  const running = status !== "offline" && status !== "maintenance";
  const phase = useMemo(() => (pm.index * 1.7) % 6, [pm.index]);
  const isRobot = pm.m.kind === "robot";
  const materialFor = (tone: Tone): THREE.Material => {
    if (tone === "accent") return mats.paint(line, dim);
    if (isRobot && tone === "body") return mats.get("robot", dim);
    return mats.get(TONE_MATERIAL[tone], dim);
  };
  return (
    <group position={P(pm.x, pm.y)} {...pick(onSelect)}>
      <group rotation={[0, -(((pm.rot ?? (pm.dir === "x" ? 0 : 90)) * Math.PI) / 180), 0]}>
        {/* status pad: only when something needs attention */}
        {status !== "healthy" && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <planeGeometry args={[f.L + 0.6, f.W + 0.6]} />
            <meshBasicMaterial color={STATUS_COLOR[status]} transparent opacity={(status === "maintenance" ? 0.4 : 0.3) * (dim ? 0.4 : 1)} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
        {(selected || target || reroute) && <Pulse w={f.L + (selected ? 0.8 : 1.2)} d={f.W + (selected ? 0.8 : 1.2)} color={pal.accent} dashed={reroute && !target && !selected} />}
        {parts.map((p: Part, i) =>
          p.t === "box" ? (
            <Solid key={i} size={[p.L, Math.max(0.01, p.H), p.W]} position={[p.u, p.z0 + p.H / 2, p.v]} material={materialFor(p.tone)} quality={quality} />
          ) : p.t === "arm" ? (
            <RobotArm key={i} points={p.points} mats={mats} quality={quality} dim={dim} moving={running && !dim} phase={phase} />
          ) : null,
        )}
        {HMI_KINDS.has(pm.m.kind) && <Hmi u={-f.L / 2 + 0.18} v={f.W / 2 + 0.22} mats={mats} dim={dim} />}
        {isRobot && <Fence L={f.L} W={f.W} mats={mats} dim={dim} />}
        <StackLight position={[-f.L / 2 + 0.16, -f.W / 2 + 0.16]} height={height} status={status} mats={mats} />
      </group>
    </group>
  );
}

/* ─────────────────────────────── conveyors ─────────────────────────────── */

export function Belt3D({ bt, pal, mats, quality, hot, dim }: { bt: Belt; pal: Palette; mats: Materials; quality: Quality; hot: boolean; dim: boolean }) {
  const [ax, ay] = bt.from;
  const [bx, by] = bt.to;
  const len = Math.hypot(bx - ax, by - ay);
  const angle = Math.atan2(by - ay, bx - ax);
  const cartons = useRef<THREE.Group>(null);
  const n = Math.max(1, Math.floor(len / 0.75));
  useFrame(({ clock }) => {
    if (!cartons.current || !bt.running) return;
    cartons.current.children.forEach((c, i) => {
      c.position.x = (((clock.elapsedTime * 0.55 + (i * len) / n) % len) + len) % len - len / 2;
    });
  });
  const line = pal.resolve(bt.color);
  const legs = Math.max(2, Math.round(len / 0.9) + 1);
  const nRollers = quality === "high" ? Math.max(2, Math.floor(len / 0.3)) : 2;
  const rollers = Array.from({ length: nRollers }, (_, i) => -len / 2 + 0.05 + (i * (len - 0.1)) / (nRollers - 1));
  const steel = mats.get("steel", dim);
  return (
    <group position={P((ax + bx) / 2, (ay + by) / 2)} rotation={[0, -angle, 0]}>
      {/* belt and side rails */}
      <mesh position={[0, 0.24, 0]} material={mats.get("rubber", dim)} receiveShadow castShadow>
        <boxGeometry args={[len, 0.03, 0.4]} />
      </mesh>
      {[-0.23, 0.23].map((z) => (
        <mesh key={z} position={[0, 0.25, z]} material={steel} castShadow>
          <boxGeometry args={[len, 0.07, 0.035]} />
        </mesh>
      ))}
      {/* flow stripe in the line's colour on the rail */}
      <mesh position={[0, 0.25, 0.25]} material={hot ? mats.paint(pal.accent) : mats.paint(line, dim)}>
        <boxGeometry args={[len * 0.98, 0.02, 0.004]} />
      </mesh>
      {/* legs */}
      {Array.from({ length: legs }).map((_, i) => {
        const x = -len / 2 + 0.08 + (i * (len - 0.16)) / (legs - 1);
        return [-0.2, 0.2].map((z) => (
          <mesh key={`${i}${z}`} position={[x, 0.11, z]} material={steel}>
            <boxGeometry args={[0.035, 0.22, 0.035]} />
          </mesh>
        ));
      })}
      {/* end rollers (and intermediate rollers on High quality) */}
      {rollers.map((x, i) => (
        <mesh key={i} position={[x, 0.22, 0]} rotation={[Math.PI / 2, 0, 0]} material={steel}>
          <cylinderGeometry args={[0.03, 0.03, 0.42, 10]} />
        </mesh>
      ))}
      {bt.running && !dim && (
        <group ref={cartons}>
          {Array.from({ length: n }).map((_, i) => (
            <mesh key={i} position={[0, 0.33, 0]} material={mats.get("carton")} castShadow>
              <boxGeometry args={[0.22, 0.14, 0.26]} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

/* ─────────────────────────────── stores & dock ─────────────────────────────── */

/** Pallet racking: blue uprights, orange beams, pallets of cartons filling the levels by stock. */
export function Rack3D({ rk, pal, mats, selected, dim, onSelect }: { rk: Layout["racks"][number]; pal: Palette; mats: Materials; selected: boolean; dim: boolean; onSelect?: () => void }) {
  const h = 1.5;
  const levels = [0.05, 0.55, 1.05];
  const filled = rk.fill * levels.length;
  const posts: [number, number][] = [
    [-0.44, -0.42],
    [0.44, -0.42],
    [0.44, 0.42],
    [-0.44, 0.42],
  ];
  return (
    <group position={P(rk.x, rk.y)} {...pick(onSelect)}>
      {rk.low && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <planeGeometry args={[1.15, 1.15]} />
          <meshBasicMaterial color="#f59e0b" transparent opacity={0.3} depthWrite={false} />
        </mesh>
      )}
      {selected && <Pulse w={1.3} d={1.3} color={pal.accent} />}
      {posts.map(([x, z], i) => (
        <mesh key={i} position={[x, h / 2, z]} material={mats.get("rackUpright", dim)} castShadow>
          <boxGeometry args={[0.05, h, 0.05]} />
        </mesh>
      ))}
      {levels.slice(1).map((y) =>
        [-0.42, 0.42].map((z) => (
          <mesh key={`${y}${z}`} position={[0, y - 0.02, z]} material={mats.get("rackBeam", dim)} castShadow>
            <boxGeometry args={[0.92, 0.06, 0.035]} />
          </mesh>
        )),
      )}
      {levels.map((y, i) => {
        const share = Math.max(0, Math.min(1, filled - i));
        if (share <= 0.02) return null;
        return (
          <group key={y} position={[0, y, 0]}>
            <mesh position={[0, 0.04, 0]} material={mats.get("pallet", dim)} castShadow>
              <boxGeometry args={[0.8, 0.08, 0.76]} />
            </mesh>
            <mesh position={[0, 0.08 + (0.34 * share) / 2, 0]} material={mats.get("carton", dim)} castShadow>
              <boxGeometry args={[0.74, 0.34 * share, 0.7]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function Truck3D({ t, pal, mats, selected, onSelect }: { t: Layout["trucks"][number]; pal: Palette; mats: Materials; selected: boolean; onSelect?: () => void }) {
  const pad = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (pad.current && t.atRisk) pad.current.opacity = 0.18 + 0.14 * (Math.sin(clock.elapsedTime * 3) + 1);
  });
  const fill = Math.max(0.04, Math.min(1, t.progress));
  const wheels: [number, number][] = [
    [-0.6, -0.44],
    [0.6, -0.44],
    [-0.6, 0.44],
    [0.6, 0.44],
    [-1.25, -0.44],
    [-1.25, 0.44],
  ];
  return (
    <group position={P(t.x, t.y)} {...pick(onSelect)}>
      {t.atRisk && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.3, 0.01, 0]}>
          <planeGeometry args={[3.1, 1.5]} />
          <meshBasicMaterial ref={pad} color="#ef4444" transparent opacity={0.25} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {selected && <Pulse w={3.3} d={1.7} color={pal.accent} />}
      {/* trailer bed, load and curtain sides (see-through, so loading progress shows) */}
      <mesh position={[0, 0.2, 0]} material={mats.get("enclosureDark")} castShadow>
        <boxGeometry args={[1.74, 0.06, 0.86]} />
      </mesh>
      <mesh position={[0.85 - (1.7 * fill) / 2, 0.23 + 0.34, 0]} material={mats.get("carton")} castShadow>
        <boxGeometry args={[1.7 * fill - 0.04, 0.68, 0.76]} />
      </mesh>
      <mesh position={[0, 0.23 + 0.42, 0]} material={mats.get("trailer")}>
        <boxGeometry args={[1.72, 0.84, 0.86]} />
      </mesh>
      {/* cab with windscreen */}
      <Solid size={[0.55, 0.62, 0.84]} position={[-1.18, 0.42, 0]} material={mats.paint(t.priority === "critical" ? "#d63a3a" : "#2f6fd6")} quality="high" />
      <mesh position={[-1.46, 0.56, 0]} rotation={[0, 0, 0.12]} material={mats.get("cabGlass")}>
        <boxGeometry args={[0.02, 0.26, 0.74]} />
      </mesh>
      {wheels.map(([x, z], i) => (
        <group key={i} position={[x, 0.13, z]} rotation={[Math.PI / 2, 0, 0]}>
          <mesh material={mats.get("tyre")}>
            <cylinderGeometry args={[0.13, 0.13, 0.09, 18]} />
          </mesh>
          <mesh material={mats.get("steel")}>
            <cylinderGeometry args={[0.06, 0.06, 0.1, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ─────────────────────────────── cameras ─────────────────────────────── */

export function Camera3D({ pc, pal, mats, selected, onSelect }: { pc: PlacedCamera; pal: Palette; mats: Materials; selected: boolean; onSelect?: () => void }) {
  const lens = pc.cam.alert ? "#ef4444" : (CAM_LENS[pc.cam.kind] ?? "#38bdf8");
  const fov = useMemo(() => {
    const head = new THREE.Vector3(...P(pc.x, pc.y, pc.z));
    let corners: THREE.Vector3[];
    if (pc.aim) {
      const [ax, ay] = pc.aim;
      const dx = ax - pc.x;
      const dy = ay - pc.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = (-dy / len) * pc.spread;
      const py = (dx / len) * pc.spread;
      const far = 1.18;
      const near = 0.45;
      corners = [
        new THREE.Vector3(...P(pc.x + dx * near + px * 0.4, pc.y + dy * near + py * 0.4, 0.02)),
        new THREE.Vector3(...P(pc.x + dx * far + px, pc.y + dy * far + py, 0.02)),
        new THREE.Vector3(...P(pc.x + dx * far - px, pc.y + dy * far - py, 0.02)),
        new THREE.Vector3(...P(pc.x + dx * near - px * 0.4, pc.y + dy * near - py * 0.4, 0.02)),
      ];
    } else {
      const r = 0.45;
      corners = [
        new THREE.Vector3(...P(pc.x - r, pc.y - r, pc.z - 1.0)),
        new THREE.Vector3(...P(pc.x + r, pc.y - r, pc.z - 1.0)),
        new THREE.Vector3(...P(pc.x + r, pc.y + r, pc.z - 1.0)),
        new THREE.Vector3(...P(pc.x - r, pc.y + r, pc.z - 1.0)),
      ];
    }
    const g = new THREE.BufferGeometry();
    const v: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      v.push(head.x, head.y, head.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    v.push(corners[0].x, corners[0].y, corners[0].z, corners[1].x, corners[1].y, corners[1].z, corners[2].x, corners[2].y, corners[2].z);
    v.push(corners[0].x, corners[0].y, corners[0].z, corners[2].x, corners[2].y, corners[2].z, corners[3].x, corners[3].y, corners[3].z);
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }, [pc]);
  const fovColor = pc.cam.kind === "thermal" ? "#fb923c" : pal.accent;
  // Point the housing toward what the camera watches.
  const aimYaw = pc.aim ? -Math.atan2(pc.aim[1] - pc.y, pc.aim[0] - pc.x) : 0;
  return (
    <group>
      {/* Field of view: only for the selected camera, so the floor stays readable. */}
      {selected && (
        <mesh geometry={fov}>
          <meshBasicMaterial color={fovColor} transparent opacity={0.14} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <group position={P(pc.x, pc.y)} {...pick(onSelect)}>
        {pc.aim && (
          <mesh position={[0, pc.z / 2, 0]} material={mats.get("steel")} castShadow>
            <cylinderGeometry args={[0.03, 0.045, pc.z, 10]} />
          </mesh>
        )}
        <group position={[0, pc.z, 0]} rotation={[0, aimYaw, pc.aim ? -0.35 : 0]}>
          <mesh material={mats.get(pc.cam.kind === "thermal" ? "enclosureDark" : "white")} castShadow>
            <boxGeometry args={[0.34, 0.16, 0.18]} />
          </mesh>
          <mesh position={[0.02, 0.1, 0]} material={mats.get("enclosureDark")}>
            <boxGeometry args={[0.4, 0.02, 0.22]} />
          </mesh>
          <mesh position={[0.18, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.055, 0.055, 0.03, 16]} />
            <meshStandardMaterial color={lens} emissive={lens} emissiveIntensity={1.4} toneMapped={false} />
          </mesh>
        </group>
        {/* invisible, larger hit area */}
        <mesh position={[0, pc.z, 0]} visible={false}>
          <sphereGeometry args={[0.35, 8, 6]} />
          <meshBasicMaterial />
        </mesh>
      </group>
    </group>
  );
}

/* ─────────────────────────────── mobile robots ─────────────────────────────── */

export const AMR_SPEED = 1.1; // layout units per second of animation
export const AMR_DWELL = 1.6; // seconds per load / unload in the animation

export function Amr3D({ path, pal, mats, index, selected, onSelect, register }: { path: AmrPath; pal: Palette; mats: Materials; index: number; selected: boolean; onSelect?: () => void; register?: (id: string, o: THREE.Object3D | null) => void }) {
  const body = useRef<THREE.Group>(null);
  useEffect(() => {
    register?.(path.amr.id, body.current);
    return () => register?.(path.amr.id, null);
  }, [register, path.amr.id]);
  const cargo = useRef<THREE.Mesh>(null);
  const forks = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.MeshStandardMaterial>(null);
  const color = pal.resolve(path.color);
  const amr = path.amr;
  const parked = amr.status === "parked";
  const speed = AMR_SPEED * (amr.speedMps || 1);
  // Robots of one fleet are spread evenly along their shared route.
  const cycle = (2 * path.length) / speed + 2 * AMR_DWELL;
  const phase = (index % 3) * 0.7 + (path.slot * cycle) / Math.max(1, path.fleetSize);
  const heading = useRef(0);
  // Parking spots side by side at the start of the route.
  const park = useMemo(() => {
    const [x0, y0] = path.points[0];
    const [x1, y1] = path.points[1] ?? [x0 + 1, y0];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const off = path.slot * 0.6;
    return { x: x0 + (-(y1 - y0) / len) * off, y: y0 + ((x1 - x0) / len) * off, heading: Math.atan2(y1 - y0, x1 - x0) };
  }, [path.points, path.slot]);
  useFrame(({ clock }) => {
    if (!body.current) return;
    if (parked) {
      body.current.position.set(...P(park.x, park.y));
      body.current.rotation.y = -park.heading;
      if (cargo.current) cargo.current.visible = false;
      if (beacon.current) beacon.current.emissiveIntensity = Math.sin(clock.elapsedTime * 3) > 0 ? 2.2 : 0.3;
      return;
    }
    const pose = amrPose(path, clock.elapsedTime, speed, AMR_DWELL, phase);
    body.current.position.set(...P(pose.x, pose.y));
    // Smoothly turn toward the travel direction (layout y maps to three z, so the angle is negated).
    const target = -pose.heading;
    let d = target - heading.current;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    heading.current += d * 0.2;
    body.current.rotation.y = heading.current;
    if (cargo.current) cargo.current.visible = pose.loaded;
    if (forks.current) forks.current.position.y = pose.loaded ? 0.22 : 0.06;
    if (beacon.current) beacon.current.emissiveIntensity = pose.phase === "moving" || pose.phase === "returning" ? 1.8 : 0.7;
  });
  const routePts = path.points.map(([x, y]) => P(x, y, 0.025));
  const beaconColor = parked ? "#f59e0b" : "#22c55e";
  const type = amr.robotType;
  const big = type === "agv" || type === "forklift-agv";
  const L = big ? 0.78 : 0.62;
  const W = big ? 0.52 : 0.44;
  const bodyMat = type === "forklift-agv" ? mats.get("safetyYellow") : mats.get("enclosureDark");
  const cargoGeom: [number, number, number] = amr.mission === "kitting" ? [0.42, 0.18, 0.32] : amr.mission === "line-transfer" ? [0.44, 0.22, 0.34] : [0.5, 0.3, 0.38];
  const cargoMat = amr.mission === "finished-goods" ? mats.get("carton") : mats.paint("#2563eb");
  return (
    <group>
      {path.slot === 0 && (
        <Line points={routePts} color={color} lineWidth={selected ? 2.4 : 1.3} dashed dashSize={0.2} gapSize={0.16} transparent opacity={parked ? 0.25 : selected ? 0.95 : 0.5} />
      )}
      <group ref={body} {...pick(onSelect)}>
        <Solid size={[L, type === "forklift-agv" ? 0.26 : 0.16, W]} position={[0, 0.11, 0]} material={bodyMat} quality="high" />
        {/* light strip in the line's colour */}
        {[W / 2 + 0.004, -W / 2 - 0.004].map((z) => (
          <mesh key={z} position={[0, 0.11, z]}>
            <boxGeometry args={[L - 0.12, 0.03, 0.004]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.2} toneMapped={false} />
          </mesh>
        ))}
        {/* lidar */}
        <mesh position={[L / 2 - 0.08, type === "forklift-agv" ? 0.3 : 0.22, 0]} material={mats.get("darkPlastic")}>
          <cylinderGeometry args={[0.05, 0.05, 0.06, 16]} />
        </mesh>
        <mesh position={[-L / 2 + 0.1, type === "forklift-agv" ? 0.32 : 0.24, W / 2 - 0.09]}>
          <sphereGeometry args={[0.045, 12, 8]} />
          <meshStandardMaterial ref={beacon} color={beaconColor} emissive={beaconColor} emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
        {type === "forklift-agv" ? (
          <>
            {/* mast and forks in front */}
            {[-0.16, 0.16].map((z) => (
              <mesh key={z} position={[L / 2 + 0.04, 0.55, z]} material={mats.get("enclosureDark")} castShadow>
                <boxGeometry args={[0.05, 1.05, 0.05]} />
              </mesh>
            ))}
            <group ref={forks} position={[L / 2 + 0.3, 0.06, 0]}>
              {[-0.13, 0.13].map((z) => (
                <mesh key={z} position={[0, 0, z]} material={mats.get("steel")}>
                  <boxGeometry args={[0.5, 0.03, 0.07]} />
                </mesh>
              ))}
              <mesh ref={cargo} position={[0, 0.2, 0]} material={cargoMat} castShadow>
                <boxGeometry args={[0.5, 0.36, 0.42]} />
              </mesh>
            </group>
          </>
        ) : type === "tugger" ? (
          <>
            {/* tow bar and cart behind */}
            <mesh position={[-L / 2 - 0.12, 0.1, 0]} material={mats.get("steel")}>
              <boxGeometry args={[0.24, 0.03, 0.04]} />
            </mesh>
            <mesh position={[-L / 2 - 0.55, 0.12, 0]} material={mats.get("steel")} castShadow>
              <boxGeometry args={[0.62, 0.06, 0.44]} />
            </mesh>
            <mesh ref={cargo} position={[-L / 2 - 0.55, 0.12 + cargoGeom[1] / 2 + 0.03, 0]} material={cargoMat} castShadow>
              <boxGeometry args={cargoGeom} />
            </mesh>
          </>
        ) : (
          <mesh ref={cargo} position={[-0.02, 0.19 + cargoGeom[1] / 2, 0]} material={cargoMat} castShadow>
            <boxGeometry args={cargoGeom} />
          </mesh>
        )}
        {/* larger, invisible hit area */}
        <mesh visible={false}>
          <boxGeometry args={[L + 0.3, 0.6, W + 0.3]} />
          <meshBasicMaterial />
        </mesh>
      </group>
    </group>
  );
}
