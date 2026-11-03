"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Bot, Cctv, Crosshair, Eye, Gem, Maximize, Pause, Play, RotateCw, Tag } from "lucide-react";
import type { Highlight } from "@/client/store";
import { amrFleet } from "@/domain/intralogistics";
import type { FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";
import { machineParts } from "../iso/geometry";
import { isoModelFromState, layoutIso } from "../iso/model";
import { Tip } from "../ui/primitives";
import { amrPaths } from "./amr-paths";
import { useMaterials, type Quality } from "./materials";
import { usePalette, type Palette } from "./palette";
import { Amr3D, BayZone, Belt3D, Camera3D, Machine3D, P, Rack3D, Shell, STATUS_COLOR, Truck3D } from "./scene";import { MISSION } from "../ui/labels";


// Post-processing is downloaded only when High quality is on.
const Effects = lazy(() => import("./effects"));

const QUALITY_KEY = "twin-3d-quality";
/** A remembered choice, if the viewer made one. */
function storedQuality(): Quality | null {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    return q === "high" || q === "standard" ? q : null;
  } catch {
    return null;
  }
}

type Goal = { target: THREE.Vector3; position: THREE.Vector3 } | null;

/** A DOM label pinned to a point in the scene. */
interface Anchor {
  id: string;
  at: () => THREE.Vector3 | null;
  node: ReactNode;
}

/**
 * Projects every label anchor to screen space each frame and moves its DOM element. One React
 * tree for all labels (drei's Html creates a root per label, which React 19 warns about when
 * labels come and go).
 */
function LabelProjector({ anchors, els }: { anchors: MutableRefObject<Anchor[]>; els: MutableRefObject<Map<string, HTMLDivElement>> }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const a of anchors.current) {
      const el = els.current.get(a.id);
      if (!el) continue;
      const p = a.at();
      if (!p) {
        el.style.visibility = "hidden";
        continue;
      }
      v.copy(p).project(camera);
      if (v.z > 1) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

function Chip({ title, sub, color, emphasis, pal }: { title: string; sub?: string; color: string; emphasis?: boolean; pal: Palette }) {
  return (
    <div style={{ background: pal["label-bg"], borderColor: emphasis ? color : pal["label-border"], color: pal["label-ink"] }} className="rounded-md border px-2 py-1 font-mono text-[10.5px] leading-tight whitespace-nowrap shadow-lg">
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: color }} />
      <span className="font-semibold">{title}</span>
      {sub && (
        <div style={{ color: pal["label-muted"] }} className="mt-0.5 font-sans text-[9.5px]">
          {sub}
        </div>
      )}
    </div>
  );
}

/** Eases the orbit camera toward a goal (reset, top view, focus), then hands control back to the user. */
function CameraRig({ goal, onArrive }: { goal: Goal; onArrive: () => void }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null };
  useFrame(() => {
    if (!goal || !controls) return;
    camera.position.lerp(goal.position, 0.12);
    controls.target.lerp(goal.target, 0.12);
    controls.update();
    if (camera.position.distanceTo(goal.position) < 0.05 && controls.target.distanceTo(goal.target) < 0.05) onArrive();
  });
  return null;
}

export function Twin3D({
  state,
  highlight,
  selectedId,
  onSelect,
  orderRisk,
}: {
  state: FactoryState;
  highlight: Highlight | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  orderRisk: Record<string, boolean>;
}) {
  const pal = usePalette();
  // WebGL support, and whether it runs in software (no GPU): probed once, before the scene is created.
  const [gpu] = useState(() => {
    if (typeof document === "undefined") return { webgl: true, software: false };
    try {
      const c = document.createElement("canvas");
      const ctx = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
      if (!ctx) return { webgl: false, software: false };
      const dbg = ctx.getExtension("WEBGL_debug_renderer_info");
      const renderer = dbg ? String(ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
      ctx.getExtension("WEBGL_lose_context")?.loseContext();
      return { webgl: true, software: /swiftshader|llvmpipe|software/i.test(renderer) };
    } catch {
      return { webgl: false, software: false };
    }
  });
  const webgl = gpu.webgl;
  const model = useMemo(() => isoModelFromState(state, orderRisk, { cameras: true }), [state, orderRisk]);
  const layout = useMemo(() => layoutIso(model), [model]);
  const fleet = useMemo(() => amrFleet(state), [state]);
  const paths = useMemo(() => amrPaths(layout, fleet, state.lines.map((l) => l.id)), [layout, fleet, state.lines]);
  const [labels, setLabels] = useState<"smart" | "all">("smart");
  const [cameras, setCameras] = useState(true);
  const [robots, setRobots] = useState(true);
  const [spin, setSpin] = useState(false);
  // High quality (soft ambient occlusion, bloom, more detail) unless the device looks slow; the
  // viewer can switch, and a sustained frame-rate drop switches down automatically.
  const chosen = useRef<Quality | null>(storedQuality());
  const [quality, setQualityState] = useState<Quality>(() => chosen.current ?? (!gpu.software && (navigator.hardwareConcurrency ?? 4) >= 6 ? "high" : "standard"));
  const chooseQuality = (q: Quality) => {
    chosen.current = q;
    setQualityState(q);
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      /* not remembered, still applied */
    }
  };
  const [goal, setGoal] = useState<Goal>(null);

  const b = layout.bounds;
  const center = useMemo(() => new THREE.Vector3(...P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)), [b.x0, b.x1, b.y0, b.y1]);
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  // Same vantage point as the isometric view: from the +x / +y corner, looking down at ~35°.
  const home = useMemo(() => center.clone().add(new THREE.Vector3(span * 0.78, span * 0.82, span * 0.78)), [center, span]);
  const top = useMemo(() => center.clone().add(new THREE.Vector3(0.01, span * 1.25, 0.01)), [center, span]);

  const positionOf = (id: string | null): THREE.Vector3 | null => {
    if (!id) return null;
    const m = layout.machines.find((x) => x.m.id === id);
    if (m) return new THREE.Vector3(...P(m.x, m.y, 0.6));
    if (id.startsWith("cam:")) {
      const c = layout.cameras.find((x) => `cam:${x.cam.id}` === id);
      if (c) return new THREE.Vector3(...P(c.x, c.y, c.z / 2));
    }
    if (id.startsWith("inv:")) {
      const r = layout.racks.find((x) => `inv:${x.id}` === id);
      if (r) return new THREE.Vector3(...P(r.x, r.y, 0.6));
    }
    if (id.startsWith("ord:")) {
      const t = layout.trucks.find((x) => `ord:${x.id}` === id);
      if (t) return new THREE.Vector3(...P(t.x, t.y, 0.4));
    }
    if (id.startsWith("amr:")) {
      const p = paths.find((x) => `amr:${x.amr.id}` === id);
      if (p) {
        const [x, y] = p.points[Math.floor(p.points.length / 2)];
        return new THREE.Vector3(...P(x, y, 0.3));
      }
    }
    return null;
  };
  const focus = (id: string | null) => {
    const t = positionOf(id);
    if (!t) return;
    setGoal({ target: t, position: t.clone().add(new THREE.Vector3(3.2, 3.4, 3.2)) });
  };

  const affected = (lineId: string, id: string) => !highlight || highlight.assetIds.includes(id) || highlight.lineIds.includes(lineId) || highlight.targetAssetId === id;

  // Labels: machines (smart or all), trucks, the selected camera, robots and bay names.
  const amrObjects = useRef(new Map<string, THREE.Object3D>());
  const registerAmr = useCallback((id: string, o: THREE.Object3D | null) => {
    if (o) amrObjects.current.set(id, o);
    else amrObjects.current.delete(id);
  }, []);
  const anchors = useMemo<Anchor[]>(() => {
    if (!pal) return [];
    const out: Anchor[] = [];
    const fixed = (v: [number, number, number]) => {
      const w = new THREE.Vector3(...v);
      return () => w;
    };
    for (const bay of layout.bays) {
      const vertical = bay.y1 - bay.y0 > bay.x1 - bay.x0;
      out.push({
        id: `bay:${bay.id}`,
        at: fixed(vertical ? P(bay.x1 + 0.4, bay.y0 + 0.3, 0.02) : P(bay.x0 + 0.6, bay.y1 + 0.55, 0.02)),
        node: (
          <span className="font-sans text-[10.5px] font-bold tracking-[0.12em] whitespace-nowrap uppercase" style={{ color: pal.resolve(bay.color), opacity: 0.85 }}>
            {bay.name}
          </span>
        ),
      });
    }
    for (const pm of layout.machines) {
      const st = pm.m.status;
      const isTarget = highlight?.targetAssetId === pm.m.id;
      const selected = selectedId === pm.m.id;
      if (!(labels === "all" || st !== "healthy" || selected || isTarget)) continue;
      const sub = isTarget ? (highlight?.kind === "continue" ? "runs to predicted trip" : highlight?.kind === "baseline" ? "assumed healthy" : "maintenance window") : st === "healthy" ? `health ${pm.m.health.toFixed(0)}` : `${st} · health ${pm.m.health.toFixed(0)}`;
      out.push({
        id: pm.m.id,
        at: fixed(P(pm.x, pm.y, machineParts(pm.m.kind).height + 0.9)),
        node: <Chip title={pm.m.id} sub={sub} color={isTarget ? pal.accent : STATUS_COLOR[st]} emphasis={st !== "healthy" || isTarget || selected} pal={pal} />,
      });
    }
    for (const t of layout.trucks) {
      if (!(t.atRisk || selectedId === `ord:${t.id}` || labels === "all")) continue;
      out.push({ id: `ord:${t.id}`, at: fixed(P(t.x, t.y, 1.35)), node: <Chip title={t.id} sub={`${Math.round(t.progress * 100)}% loaded${t.atRisk ? " · at risk" : ""}`} color={t.atRisk ? "#ef4444" : "#4c8dff"} emphasis pal={pal} /> });
    }
    if (cameras)
      for (const pc of layout.cameras) {
        if (selectedId !== `cam:${pc.cam.id}`) continue;
        out.push({ id: `cam:${pc.cam.id}`, at: fixed(P(pc.x, pc.y, pc.z + 0.45)), node: <Chip title={pc.cam.id} sub={pc.cam.name} color="#38bdf8" emphasis pal={pal} /> });
      }
    if (robots)
      for (const path of paths) {
        const a = path.amr;
        const sel = selectedId === `amr:${a.id}`;
        if (!(labels === "all" || sel || a.status === "parked")) continue;
        const tmp = new THREE.Vector3();
        out.push({
          id: `amr:${a.id}`,
          at: () => {
            const o = amrObjects.current.get(a.id);
            return o ? o.getWorldPosition(tmp).add(new THREE.Vector3(0, 0.75, 0)) : null;
          },
          node: <Chip title={a.id} sub={a.status === "parked" ? `parked · ${a.reason}` : `${MISSION[a.mission].chip} · ${a.tripsPerHour} trips/h`} color={a.status === "parked" ? "#f59e0b" : pal.resolve(path.color)} emphasis={sel || a.status === "parked"} pal={pal} />,
        });
      }
    return out;
  }, [pal, layout, highlight, selectedId, labels, cameras, robots, paths]);
  const anchorsRef = useRef<Anchor[]>([]);
  anchorsRef.current = anchors;
  const labelEls = useRef(new Map<string, HTMLDivElement>());

  if (!pal) return <div className="h-full w-full" />;
  if (!webgl)
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-muted" data-testid="twin-3d">
        The 3D view needs WebGL, which this browser has turned off. The Isometric and Floor plan views show the same twin.
      </div>
    );
  return (
    <div className="relative h-full w-full" data-testid="twin-3d">
      <Canvas
        shadows="percentage"
        dpr={quality === "high" ? [1, 1.75] : [1, 1.25]}
        camera={{ fov: 38, near: 0.1, far: 400, position: home.toArray() }}
        onPointerMissed={() => onSelect(null)}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}
        aria-label="3D view of the factory digital twin"
      >
        <PerformanceMonitor onDecline={() => !chosen.current && setQualityState("standard")} />
        <Scene
          pal={pal}
          quality={quality}
          layout={layout}
          paths={robots ? paths : []}
          selectedId={selectedId}
          onSelect={onSelect}
          cameras={cameras}
          affected={affected}
          highlight={highlight}
          registerAmr={registerAmr}
        />
        <OrbitControls
          makeDefault
          target={center}
          enableDamping
          dampingFactor={0.08}
          minDistance={2.5}
          maxDistance={span * 2.6}
          maxPolarAngle={Math.PI / 2.08}
          autoRotate={spin}
          autoRotateSpeed={0.6}
          onStart={() => setGoal(null)}
        />
        <CameraRig goal={goal} onArrive={() => setGoal(null)} />
        <LabelProjector anchors={anchorsRef} els={labelEls} />
        {quality === "high" && (
          <Suspense fallback={null}>
            <Effects />
          </Suspense>
        )}
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {anchors.map((a) => (
          <div
            key={a.id}
            ref={(el) => {
              if (el) labelEls.current.set(a.id, el);
              else labelEls.current.delete(a.id);
            }}
            className="absolute top-0 left-0"
            style={{ visibility: "hidden" }}
          >
            <div className="-translate-x-1/2 -translate-y-full">{a.node}</div>
          </div>
        ))}
      </div>

      {/* view controls */}
      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--shadow-card)]">
        {[
          { label: "Reset view", icon: Maximize, onClick: () => setGoal({ target: center.clone(), position: home.clone() }) },
          { label: "Top view", icon: Eye, onClick: () => setGoal({ target: center.clone(), position: top.clone() }) },
          { label: "Focus the selection", icon: Crosshair, onClick: () => focus(selectedId), disabled: !selectedId },
          { label: spin ? "Stop turntable" : "Turntable", icon: spin ? Pause : RotateCw, onClick: () => setSpin(!spin) },
        ].map((x) => (
          <Tip key={x.label} content={x.label} side="right">
            <button
              onClick={x.onClick}
              disabled={x.disabled}
              aria-label={x.label}
              className="flex h-8 w-8 items-center justify-center border-b border-line text-ink-2 last:border-0 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            >
              <x.icon className="h-3.5 w-3.5" />
            </button>
          </Tip>
        ))}
      </div>
      <div className="absolute bottom-3 left-14 flex flex-wrap gap-1.5">
        {[
          { on: labels === "all", label: labels === "all" ? "All labels" : "Smart labels", icon: Tag, onClick: () => setLabels(labels === "all" ? "smart" : "all") },
          { on: cameras, label: "Cameras", icon: Cctv, onClick: () => setCameras(!cameras) },
          { on: robots, label: "Mobile robots", icon: Bot, onClick: () => setRobots(!robots) },
          { on: quality === "high", label: quality === "high" ? "High quality" : "Standard quality", icon: Gem, onClick: () => chooseQuality(quality === "high" ? "standard" : "high") },
        ].map((x) => (
          <button
            key={x.label}
            onClick={x.onClick}
            aria-pressed={x.on}
            className={cn("flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px]", x.on ? "border-accent/50 bg-accent/12 text-accent-ink" : "border-line bg-surface text-muted hover:text-ink")}
          >
            <x.icon className="h-3 w-3" /> {x.label}
          </button>
        ))}
      </div>
      {robots && fleet.length > 0 && (
        <div className="pointer-events-none absolute top-3 left-3 max-w-[260px] rounded-lg border border-line bg-surface/90 px-2.5 py-2 text-[11px] shadow-[var(--shadow-card)] backdrop-blur" data-testid="amr-legend">
          <p className="flex items-center gap-1.5 font-medium text-ink">
            <Bot className="h-3.5 w-3.5 text-accent" /> Mobile robots · {fleet.filter((a) => a.status === "active").length} of {fleet.length} active
          </p>
          <p className="mt-0.5 leading-snug text-muted">
            Trips follow line output; robots park when their line stops.
          </p>
        </div>
      )}
      <p className="pointer-events-none absolute right-3 bottom-3 hidden text-[10.5px] text-muted sm:block">
        <Play className="mr-1 inline h-2.5 w-2.5" />
        Drag to orbit · right-drag to pan · scroll to zoom · double-click to focus
      </p>
      <DoubleClickFocus onFocus={() => focus(selectedId)} />
    </div>
  );
}

/** Double-click anywhere in the view focuses the current selection (the click itself selects first). */
function DoubleClickFocus({ onFocus }: { onFocus: () => void }) {
  const ref = useRef(onFocus);
  ref.current = onFocus;
  useEffect(() => {
    const h = () => setTimeout(() => ref.current(), 30);
    const el = document.querySelector('[data-testid="twin-3d"] canvas');
    el?.addEventListener("dblclick", h);
    return () => el?.removeEventListener("dblclick", h);
  }, []);
  return null;
}

function Scene({
  pal,
  quality,
  layout,
  paths,
  selectedId,
  onSelect,
  cameras,
  affected,
  highlight,
  registerAmr,
}: {
  pal: Palette;
  quality: Quality;
  layout: ReturnType<typeof layoutIso>;
  paths: ReturnType<typeof amrPaths>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  cameras: boolean;
  affected: (lineId: string, id: string) => boolean;
  highlight: Highlight | null;
  registerAmr: (id: string, o: THREE.Object3D | null) => void;
}) {
  const b = layout.bounds;
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const mats = useMaterials(pal, quality);
  // The light theme already has a bright floor and walls; less studio light keeps it from washing out.
  const k = pal.theme === "dark" ? 1 : 0.65;
  return (
    <>
      {/* Studio lighting built from light panels (no HDR download): gives metal and glass their reflections. */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.4 * k} position={[0, 7, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
        <Lightformer form="rect" intensity={1.3 * k} position={[-9, 3, 0]} rotation-y={Math.PI / 2} scale={[12, 2.5, 1]} />
        <Lightformer form="rect" intensity={1.3 * k} position={[9, 3, 0]} rotation-y={-Math.PI / 2} scale={[12, 2.5, 1]} />
        <Lightformer form="rect" intensity={0.9 * k} color="#cfe3ff" position={[0, 3, 9]} rotation-y={Math.PI} scale={[12, 2, 1]} />
      </Environment>
      <hemisphereLight args={[pal.theme === "dark" ? "#c4d4f2" : "#ffffff", "#5b636c", pal.theme === "dark" ? 0.7 : 0.6]} />
      <ambientLight intensity={0.15} />
      <directionalLight
        position={P(cx + span * 0.4, cy - span * 0.2, span * 0.9)}
        intensity={pal.theme === "dark" ? 1.8 : 1.6}
        castShadow
        shadow-mapSize={quality === "high" ? [2048, 2048] : [1024, 1024]}
        shadow-normalBias={0.02}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        shadow-camera-near={0.5}
        shadow-camera-far={span * 4}
        shadow-bias={-0.0004}
      >
        <object3D attach="target" position={P(cx, cy)} />
      </directionalLight>

      <Shell layout={layout} mats={mats} quality={quality} onMiss={() => onSelect(null)} />
      {layout.bays.map((bay) => {
        const hot = !!highlight && (highlight.lineIds.includes(bay.id) || highlight.rerouteLineId === bay.id);
        return <BayZone key={bay.id} bay={bay} mats={mats} accent={pal.accent} color={pal.resolve(bay.color)} hot={hot} dim={!!highlight && !hot} />;
      })}
      {layout.belts.map((bt) => {
        const hot = !!highlight && (highlight.rerouteLineId === bt.lineId || highlight.lineIds.includes(bt.lineId));
        return <Belt3D key={bt.id} bt={bt} pal={pal} mats={mats} quality={quality} hot={hot} dim={!!highlight && !hot} />;
      })}
      {layout.machines.map((pm) => (
        <Machine3D
          key={pm.m.id}
          pm={pm}
          pal={pal}
          mats={mats}
          quality={quality}
          status={pm.m.status}
          dim={!affected(pm.lineId, pm.m.id)}
          selected={selectedId === pm.m.id}
          target={highlight?.targetAssetId === pm.m.id}
          reroute={!!highlight?.rerouteLineId && highlight.rerouteLineId === pm.lineId}
          onSelect={() => onSelect(pm.m.id)}
        />
      ))}
      {layout.racks.map((rk) => (
        <Rack3D key={rk.id} rk={rk} pal={pal} mats={mats} selected={selectedId === `inv:${rk.id}`} dim={!!highlight} onSelect={() => onSelect(`inv:${rk.id}`)} />
      ))}
      {layout.trucks.map((t) => (
        <Truck3D key={t.id} t={t} pal={pal} mats={mats} selected={selectedId === `ord:${t.id}`} onSelect={() => onSelect(`ord:${t.id}`)} />
      ))}
      {cameras && layout.cameras.map((pc) => <Camera3D key={pc.cam.id} pc={pc} pal={pal} mats={mats} selected={selectedId === `cam:${pc.cam.id}`} onSelect={() => onSelect(`cam:${pc.cam.id}`)} />)}
      {paths.map((p, i) => (
        <Amr3D key={p.amr.id} path={p} pal={pal} mats={mats} index={i} selected={selectedId === `amr:${p.amr.id}`} onSelect={() => onSelect(`amr:${p.amr.id}`)} register={registerAmr} />
      ))}
    </>
  );
}
