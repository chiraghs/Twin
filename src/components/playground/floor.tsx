"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { SpecOp } from "@/domain/builder/ops";
import type { TwinSpec } from "@/domain/builder/spec";
import type { AssetKind, MobileRobot } from "@/domain/types";
import type { PlaygroundSelection } from "@/client/playground";
import { amrPose, type AmrPath } from "@/components/three/amr-paths";
import { FOOTPRINT, type PlacedMachine } from "@/components/iso/model";
import { cn } from "@/lib/cn";
import { dropTarget, extents, hitMachine, KIND_SHORT, pinOps, rotOf, snap, type FloorModel } from "./model";

/** What the palette puts on the drag: a machine type or a robot fleet. */
export type PaletteItem = { type: "machine"; archetype: AssetKind } | { type: "fleet"; mission: MobileRobot["mission"]; robotType: MobileRobot["robotType"] };
export const DRAG_TYPE = "application/x-twin-item";

const ROBOT_SPEED = 1.1; // layout units per second of animation (as in the 3D view)
const ROBOT_DWELL = 1.6;

type Drag =
  | { kind: "pan"; x0: number; y0: number; cx0: number; cy0: number; moved: boolean }
  | { kind: "move"; id: string; ox: number; oy: number; x: number; y: number; moved: boolean }
  | { kind: "connect"; from: string; x: number; y: number }
  | null;

export function Floor({
  spec,
  model,
  selection,
  onSelect,
  edit,
  routeFleet,
  onDropItem,
}: {
  spec: TwinSpec;
  model: FloorModel;
  selection: PlaygroundSelection;
  onSelect: (s: PlaygroundSelection) => void;
  edit: (ops: SpecOp[]) => void;
  /** When set, clicks on the floor add waypoints to this fleet's route. */
  routeFleet: string | null;
  onDropItem: (item: PaletteItem, x: number, y: number) => void;
}) {
  const { layout } = model;
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [view, setView] = useState<{ cx: number; cy: number; s: number } | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const b = layout.bounds;
    const s = Math.min(size.w / (b.x1 - b.x0 + 2), size.h / (b.y1 - b.y0 + 2), 90);
    setView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, s: Math.max(12, s) });
  }, [layout.bounds, size.w, size.h]);
  // Fit once the size is known; afterwards the view stays where the person put it.
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w > 50) {
      fitted.current = true;
      fit();
    }
  }, [fit, size.w]);

  const v = view ?? { cx: 0, cy: 0, s: 40 };
  const toFloor = useCallback(
    (clientX: number, clientY: number) => {
      const r = svg.current!.getBoundingClientRect();
      return { x: (clientX - r.left - size.w / 2) / v.s + v.cx, y: (clientY - r.top - size.h / 2) / v.s + v.cy };
    },
    [size.w, size.h, v.s, v.cx, v.cy],
  );

  // Wheel zoom around the pointer (non-passive so the page doesn't scroll).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((cur) => {
        const c = cur ?? { cx: 0, cy: 0, s: 40 };
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left - r.width / 2;
        const py = e.clientY - r.top - r.height / 2;
        const s = Math.min(160, Math.max(8, c.s * Math.exp(-e.deltaY * 0.0015)));
        const fx = px / c.s + c.cx;
        const fy = py / c.s + c.cy;
        return { s, cx: fx - px / s, cy: fy - py / s };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoom = (k: number) => setView((c) => (c ? { ...c, s: Math.min(160, Math.max(8, c.s * k)) } : c));

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = (e.target as Element).closest("[data-hit]") as HTMLElement | null;
    const hit = target?.dataset.hit ?? "";
    const p = toFloor(e.clientX, e.clientY);
    svg.current!.setPointerCapture(e.pointerId);
    if (hit.startsWith("port:")) {
      setDrag({ kind: "connect", from: hit.slice(5), x: p.x, y: p.y });
    } else if (hit.startsWith("machine:") && !routeFleet) {
      const id = hit.slice(8);
      const pm = layout.machines.find((m) => m.m.id === id)!;
      onSelect({ kind: "machine", id });
      setDrag({ kind: "move", id, ox: p.x - pm.x, oy: p.y - pm.y, x: pm.x, y: pm.y, moved: false });
    } else if (hit.startsWith("belt:")) onSelect({ kind: "belt", id: hit.slice(5) });
    else if (hit.startsWith("bay:")) onSelect({ kind: "line", id: hit.slice(4) });
    else if (hit.startsWith("fleet:")) onSelect({ kind: "fleet", id: hit.slice(6) });
    else setDrag({ kind: "pan", x0: e.clientX, y0: e.clientY, cx0: v.cx, cy0: v.cy, moved: false });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      setView({ ...v, cx: drag.cx0 - dx / v.s, cy: drag.cy0 - dy / v.s });
      if (!drag.moved && Math.hypot(dx, dy) > 3) setDrag({ ...drag, moved: true });
    } else {
      const p = toFloor(e.clientX, e.clientY);
      if (drag.kind === "move") {
        const x = snap(p.x - drag.ox);
        const y = snap(p.y - drag.oy);
        if (x !== drag.x || y !== drag.y) setDrag({ ...drag, x, y, moved: true });
      } else setDrag({ ...drag, x: p.x, y: p.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (d.kind === "pan" && !d.moved) {
      if (routeFleet) {
        const f = spec.mobileRobots.find((x) => x.id === routeFleet);
        const p = toFloor(e.clientX, e.clientY);
        if (f && f.route.length < 12) edit([{ op: "set_robot_route", fleetId: f.id, route: [...f.route, { x: snap(p.x), y: snap(p.y) }] }]);
      } else onSelect(null);
    } else if (d.kind === "move" && d.moved) {
      const pm = layout.machines.find((m) => m.m.id === d.id);
      edit([...pinOps(spec, layout, d.id), { op: "place_machine", machineId: d.id, x: d.x, y: d.y, rot: pm ? rotOf(pm) : 0 }]);
    } else if (d.kind === "connect") {
      const to = hitMachine(layout, d.x, d.y, d.from);
      if (to) edit([{ op: "connect", machineId: d.from, targetId: to.m.id }]);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    try {
      const p = toFloor(e.clientX, e.clientY);
      onDropItem(JSON.parse(raw) as PaletteItem, snap(p.x), snap(p.y));
    } catch {
      /* not ours */
    }
  };

  const sel = (kind: NonNullable<PlaygroundSelection>["kind"], id: string) => selection?.kind === kind && selection.id === id;
  const selectedFleet = selection?.kind === "fleet" ? selection.id : null;
  const moving = drag?.kind === "move" ? drag : null;
  const connecting = drag?.kind === "connect" ? drag : null;
  const connectTarget = connecting ? hitMachine(layout, connecting.x, connecting.y, connecting.from) : null;

  // While dragging a machine, draw it (and its belts) at the pointer.
  const placed = (pm: PlacedMachine) => (moving && moving.id === pm.m.id ? { ...pm, x: moving.x, y: moving.y } : pm);
  const fs = 1 / v.s; // one screen pixel in floor units

  return (
    <div ref={box} className={cn("relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-line bg-surface-2/40", routeFleet && "ring-2 ring-agent/50")} data-testid="playground-floor">
      <svg
        ref={svg}
        width={size.w}
        height={size.h}
        className={cn("block touch-none select-none", drag?.kind === "pan" && drag.moved ? "cursor-grabbing" : routeFleet ? "cursor-crosshair" : "cursor-default")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={onDrop}
        data-testid="pg-svg"
        role="application"
        aria-label="Factory floor plan. Drag machines to move them, drag from a machine's output port to another machine to connect them."
      >
        <defs>
          <pattern id="pg-grid" width={1} height={1} patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="var(--color-line)" strokeWidth={fs} />
          </pattern>
          <pattern id="pg-grid5" width={5} height={5} patternUnits="userSpaceOnUse">
            <rect width={5} height={5} fill="url(#pg-grid)" />
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke="var(--color-line-strong)" strokeWidth={1.4 * fs} />
          </pattern>
          <marker id="pg-arrow" viewBox="0 0 10 10" refX={9} refY={5} markerUnits="userSpaceOnUse" markerWidth={0.34} markerHeight={0.34} orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-ink-2)" fillOpacity={0.85} />
          </marker>
        </defs>
        <g transform={`translate(${size.w / 2 - v.cx * v.s} ${size.h / 2 - v.cy * v.s}) scale(${v.s})`}>
          <rect x={v.cx - size.w / 2 / v.s} y={v.cy - size.h / 2 / v.s} width={size.w / v.s} height={size.h / v.s} fill="url(#pg-grid5)" />

          {/* Bays */}
          {layout.bays.map((b) => (
            <g key={b.id}>
              <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={0.25} fill={b.color} fillOpacity={sel("line", b.id) ? 0.12 : 0.05} stroke={b.color} strokeOpacity={0.6} strokeWidth={(sel("line", b.id) ? 2 : 1) * fs} strokeDasharray={`${6 * fs} ${4 * fs}`} />
              <text data-hit={`bay:${b.id}`} x={b.x0 + 0.15} y={b.y0 - 0.18} fontSize={13 * fs} fontWeight={600} fill="var(--color-ink-2)" className="cursor-pointer">
                {b.name}
              </text>
            </g>
          ))}

          {/* Stores and dock */}
          {layout.racks.map((r) => (
            <g key={r.id}>
              <title>{r.name}</title>
              <rect x={r.x - 0.5} y={r.y - 0.42} width={1} height={0.84} rx={0.08} fill="var(--color-surface-3)" stroke="var(--color-line-strong)" strokeWidth={fs} />
              {v.s >= 70 && (
                <text x={r.x} y={r.y + 0.06} fontSize={9.5 * fs} textAnchor="middle" fill="var(--color-muted)">
                  {truncate(r.name, Math.floor(v.s / 6.5))}
                </text>
              )}
            </g>
          ))}
          {layout.racks.length > 0 && (
            <text x={Math.min(...layout.racks.map((r) => r.x)) - 0.5} y={Math.min(...layout.racks.map((r) => r.y)) - 0.62} fontSize={11 * fs} fontWeight={600} fill="var(--color-muted)">
              Stores · {layout.racks.length} materials
            </text>
          )}
          {layout.trucks.map((t) => (
            <g key={t.id}>
              <rect x={t.x - 1} y={t.y - 0.45} width={2} height={0.9} rx={0.1} fill="var(--color-surface-3)" stroke="var(--color-line-strong)" strokeWidth={fs} strokeDasharray={`${4 * fs} ${3 * fs}`} />
              <text x={t.x} y={t.y + 0.07} fontSize={10.5 * fs} textAnchor="middle" fill="var(--color-muted)">
                Shipping dock
              </text>
            </g>
          ))}

          {/* Belts (hidden for a machine being dragged; they follow on release) */}
          {layout.belts.map((bt) => {
            const src = model.beltSource.get(bt.id) ?? null;
            const hidden = moving && (src === moving.id || layout.machines.some((m) => m.m.id === moving.id && m.lineId === bt.lineId));
            if (hidden) return null;
            const isSel = src ? sel("belt", src) : false;
            return (
              <g key={bt.id}>
                <line x1={bt.from[0]} y1={bt.from[1]} x2={bt.to[0]} y2={bt.to[1]} stroke={isSel ? "var(--color-accent)" : bt.color} strokeOpacity={0.85} strokeWidth={isSel ? 0.3 : 0.22} strokeLinecap="round" markerEnd="url(#pg-arrow)" />
                {src && <line data-hit={`belt:${src}`} x1={bt.from[0]} y1={bt.from[1]} x2={bt.to[0]} y2={bt.to[1]} stroke="transparent" strokeWidth={0.6} className="cursor-pointer" />}
              </g>
            );
          })}

          {/* Robot routes */}
          {model.paths
            .filter((p, i, all) => all.findIndex((q) => q.amr.fleetId === p.amr.fleetId) === i)
            .map((p) => {
              const on = selectedFleet === p.amr.fleetId;
              const f = spec.mobileRobots.find((x) => x.id === p.amr.fleetId);
              return (
                <g key={p.amr.fleetId}>
                  <polyline points={p.points.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={on ? "var(--color-agent)" : p.color} strokeOpacity={on ? 0.95 : 0.5} strokeWidth={(on ? 2.4 : 1.4) * fs} strokeDasharray={`${5 * fs} ${4 * fs}`} />
                  <polyline data-hit={`fleet:${p.amr.fleetId}`} points={p.points.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="transparent" strokeWidth={0.5} className="cursor-pointer" />
                  {on &&
                    f?.route.map((w, i) => (
                      <rect key={i} x={w.x - 0.12} y={w.y - 0.12} width={0.24} height={0.24} transform={`rotate(45 ${w.x} ${w.y})`} fill="var(--color-agent)" />
                    ))}
                </g>
              );
            })}

          {/* Machines */}
          {layout.machines.map((raw) => {
            const pm = placed(raw);
            const f = FOOTPRINT[pm.m.kind];
            const rot = rotOf(pm);
            const isSel = sel("machine", pm.m.id);
            const isTarget = connectTarget?.m.id === pm.m.id;
            const { hx, hy } = extents(pm);
            const out = rot % 180 === 0 ? { x: pm.x + (rot === 0 ? 1 : -1) * (f.L / 2 + 0.2), y: pm.y } : { x: pm.x, y: pm.y + (rot === 90 ? 1 : -1) * (f.L / 2 + 0.2) };
            const showPort = (isSel || hover === pm.m.id) && !moving && !routeFleet;
            return (
              <g key={pm.m.id} onPointerEnter={() => setHover(pm.m.id)} onPointerLeave={() => setHover((h) => (h === pm.m.id ? null : h))}>
                <g transform={`translate(${pm.x} ${pm.y}) rotate(${rot})`}>
                  <rect
                    data-hit={`machine:${pm.m.id}`}
                    data-testid={`pg-machine-${pm.m.id}`}
                    x={-f.L / 2}
                    y={-f.W / 2}
                    width={f.L}
                    height={f.W}
                    rx={0.12}
                    fill={pm.color}
                    fillOpacity={isSel || isTarget ? 0.42 : 0.24}
                    stroke={isSel ? "var(--color-accent)" : isTarget ? "var(--color-agent)" : pm.color}
                    strokeWidth={(isSel || isTarget ? 2.4 : 1.2) * fs}
                    className={routeFleet ? "" : "cursor-move"}
                  />
                  {/* flow direction tick */}
                  <path d={`M ${f.L / 2 - 0.28} -0.14 L ${f.L / 2 - 0.1} 0 L ${f.L / 2 - 0.28} 0.14`} fill="none" stroke={pm.color} strokeWidth={1.4 * fs} pointerEvents="none" />
                </g>
                <title>{`${pm.m.name} · ${KIND_SHORT[pm.m.kind]}`}</title>
                {rot % 180 === 0 ? (
                  <text x={pm.x} y={pm.y + hy + 13 * fs} fontSize={11 * fs} textAnchor="middle" fill="var(--color-ink)" pointerEvents="none" fontWeight={isSel ? 650 : 500}>
                    {truncate(pm.m.name, Math.max(6, Math.floor((2.6 * v.s) / 6.2)))}
                  </text>
                ) : (
                  <text x={pm.x + hx + 6 * fs} y={pm.y + 4 * fs} fontSize={11 * fs} fill="var(--color-ink)" pointerEvents="none" fontWeight={isSel ? 650 : 500}>
                    {truncate(pm.m.name, 18)}
                  </text>
                )}
                <text x={pm.x} y={pm.y + 3.5 * fs} fontSize={9.5 * fs} textAnchor="middle" fill="var(--color-ink-2)" pointerEvents="none">
                  {ABBR[pm.m.kind]}
                </text>
                {showPort && (
                  <g>
                    <circle data-hit={`port:${pm.m.id}`} data-testid={`pg-port-${pm.m.id}`} cx={out.x} cy={out.y} r={7 * fs} fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth={2 * fs} className="cursor-crosshair" />
                    <circle cx={out.x} cy={out.y} r={2.5 * fs} fill="var(--color-accent)" pointerEvents="none" />
                  </g>
                )}
              </g>
            );
          })}

          {connecting && (
            <line
              x1={layout.machines.find((m) => m.m.id === connecting.from)?.x}
              y1={layout.machines.find((m) => m.m.id === connecting.from)?.y}
              x2={connecting.x}
              y2={connecting.y}
              stroke="var(--color-agent)"
              strokeWidth={2 * fs}
              strokeDasharray={`${5 * fs} ${3 * fs}`}
              markerEnd="url(#pg-arrow)"
              pointerEvents="none"
            />
          )}

          <RobotDots paths={model.paths} fs={fs} selectedFleet={selectedFleet} />
        </g>
      </svg>

      <div className="absolute right-2 bottom-2 flex flex-col gap-1">
        <IconBtn label="Zoom in" onClick={() => zoom(1.25)}>
          <Plus className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Zoom out" onClick={() => zoom(0.8)}>
          <Minus className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Fit to floor" onClick={fit}>
          <Maximize2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>
      {routeFleet && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-lg border border-agent/50 bg-shell/95 px-3 py-1.5 text-[12px] text-agent-ink shadow-xl">
          Click the floor to add waypoints · Esc when done
        </div>
      )}
      {connecting && (
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-lg border border-agent/50 bg-shell/95 px-3 py-1.5 text-[12px] text-agent-ink shadow-xl">
          {connectTarget ? `Release: ${connectTarget.m.name} will come next` : "Drop on the machine that should come next"}
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-ink-2 shadow-sm hover:text-ink">
      {children}
    </button>
  );
}

/** Short tags drawn inside a machine's footprint. */
const ABBR: Record<AssetKind, string> = {
  conveyor: "CNV",
  press: "PRS",
  robot: "ROB",
  camera: "QA",
  packager: "PKG",
  labeler: "LBL",
  cnc: "CNC",
  mixer: "MIX",
  oven: "OVN",
  filler: "FIL",
  molder: "MLD",
  welder: "WLD",
  palletizer: "PAL",
  pump: "PMP",
  workstation: "WS",
  extruder: "EXT",
};

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

/** Robots moving along their routes; positions are set directly on the elements each frame. */
function RobotDots({ paths, fs, selectedFleet }: { paths: AmrPath[]; fs: number; selectedFleet: string | null }) {
  const refs = useRef<(SVGGElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const t = reduce ? 4 : (performance.now() - t0) / 1000;
      paths.forEach((p, i) => {
        const el = refs.current[i];
        if (!el || p.points.length < 2) return;
        const speed = ROBOT_SPEED * (p.amr.speedMps || 1);
        const cycle = (2 * p.length) / speed + 2 * ROBOT_DWELL;
        const pose = amrPose(p, t, speed, ROBOT_DWELL, (i % 3) * 0.7 + (p.slot * cycle) / Math.max(1, p.fleetSize));
        el.setAttribute("transform", `translate(${pose.x} ${pose.y}) rotate(${(pose.heading * 180) / Math.PI})`);
        el.dataset.loaded = pose.loaded ? "1" : "0";
      });
      if (!reduce) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [paths]);
  return (
    <g pointerEvents="none">
      {paths.map((p, i) => (
        <g key={p.amr.id} ref={(el) => void (refs.current[i] = el)}>
          <rect x={-0.28} y={-0.2} width={0.56} height={0.4} rx={0.08} fill={selectedFleet === p.amr.fleetId ? "var(--color-agent)" : "var(--color-surface)"} stroke={p.color} strokeWidth={1.6 * fs} />
          <circle cx={0.16} cy={0} r={0.06} fill={p.color} />
        </g>
      ))}
    </g>
  );
}
