"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { createXRStore, XR, XROrigin } from "@react-three/xr";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Activity, AlertTriangle, Bookmark, Bot, Glasses, Smartphone, Cctv, Crosshair, Download, Eye, Gem, Maximize, Pause, Play, RotateCw, Pin, Sparkles, Tag, Trash2, Video, X } from "lucide-react";
import { useUi } from "@/client/store";
import { useView3d } from "@/client/view3d";
import { LIVE_CAMERA_LIMIT, type Vec3 } from "@/domain/views";
import type { Highlight } from "@/client/store";
import { amrFleet } from "@/domain/intralogistics";
import { activeAlarms, assetSignals, lineFlows, lineOutput } from "@/domain/live";
import type { FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";
import { machineParts } from "../iso/geometry";
import { isoModelFromState, layoutIso } from "../iso/model";
import { Tip } from "../ui/primitives";
import { amrPaths } from "./amr-paths";
import { useMaterials, type Quality } from "./materials";
import { usePalette, type Palette } from "./palette";
import { Amr3D, BayZone, Belt3D, Camera3D, Machine3D, P, Rack3D, Shell, STATUS_COLOR, Truck3D } from "./scene";
import { MISSION } from "../ui/labels";
import { savePref } from "@/client/server-storage";


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
const EMPTY: string[] = [];

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

type Pose = { position: Vec3; target: Vec3 };
/** Renders the current view once and returns it as a JPEG (for "Ask AI about this view"). */
type Capture = () => Promise<Blob | null>;
/**
 * Keeps the current camera pose in a ref, so "save this view" can read it without re-rendering,
 * and exposes a frame capture (render + encode in the same task, before the buffer is cleared).
 */
function PoseProbe({ pose, capture }: { pose: MutableRefObject<Pose | null>; capture: MutableRefObject<Capture | null> }) {
  const { camera, controls, gl, scene } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: OrbitControlsImpl | null; gl: THREE.WebGLRenderer; scene: THREE.Scene };
  useEffect(() => {
    capture.current = () =>
      new Promise((resolve) => {
        gl.render(scene, camera);
        gl.domElement.toBlob((b) => resolve(b), "image/jpeg", 0.85);
      });
    return () => {
      capture.current = null;
    };
  }, [gl, scene, camera, capture]);
  useFrame(() => {
    if (!controls) return;
    pose.current = { position: camera.position.toArray() as Vec3, target: controls.target.toArray() as Vec3 };
  });
  return null;
}

export function Twin3D({
  state,
  highlight,
  selectedId,
  onSelect,
  orderRisk,
  views = false,
}: {
  state: FactoryState;
  highlight: Highlight | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  orderRisk: Record<string, boolean>;
  /** Show the saved-views menu and obey view requests (the copilot, the camera wall). */
  views?: boolean;
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
  const [live, setLive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const flows = useMemo(() => lineFlows(state), [state]);
  const alarms = useMemo(() => activeAlarms(state), [state]);
  const plantRef = useRef<THREE.Group | null>(null);
  // WebXR: one store per view; the buttons only appear where the browser supports a session.
  const xrStore = useMemo(() => createXRStore({ emulate: false, offerSession: false }), []);
  const [xr, setXr] = useState<{ vr: boolean; ar: boolean }>({ vr: false, ar: false });
  useEffect(() => {
    const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } }).xr : undefined;
    if (!nav) return;
    let alive = true;
    Promise.all([nav.isSessionSupported("immersive-vr").catch(() => false), nav.isSessionSupported("immersive-ar").catch(() => false)]).then(([vr, ar]) => alive && setXr({ vr, ar }));
    return () => {
      alive = false;
    };
  }, []);
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
    savePref(QUALITY_KEY, q);
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

  // Saved views and requests from elsewhere (views menu, camera wall, copilot).
  const pose = useRef<Pose | null>(null);
  const capture = useRef<Capture | null>(null);
  const loadModels = useView3d((s) => s.loadModels);
  useEffect(() => {
    void loadModels(state.profile.id);
  }, [loadModels, state.profile.id]);
  const pins = useView3d((s) => s.pinned[state.profile.id]) ?? EMPTY;
  const togglePin = useView3d((s) => s.togglePin);
  const request = useView3d((s) => s.request);
  const consume = useView3d((s) => s.consume);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    if (!views || !request) return;
    consume(request.nonce);
    if (request.kind === "pose") setGoal({ position: new THREE.Vector3(...request.position), target: new THREE.Vector3(...request.target) });
    else if (request.kind === "reset") setGoal({ target: center.clone(), position: home.clone() });
    else {
      onSelect(request.id);
      focusRef.current(request.id);
    }
  }, [views, request, consume, center, home, onSelect]);

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
    const assetById = new Map(state.assets.map((a) => [a.id, a]));
    for (const pm of layout.machines) {
      const st = pm.m.status;
      const isTarget = highlight?.targetAssetId === pm.m.id;
      const selected = selectedId === pm.m.id;
      if (!(live || labels === "all" || st !== "healthy" || selected || isTarget)) continue;
      const a = assetById.get(pm.m.id);
      const liveSub = a ? `${Math.round(a.signal.throughput)} u/h · ${a.signal.vibration.toFixed(1)} mm/s · H ${a.healthScore.toFixed(0)}` : "";
      const sub = live && !isTarget
        ? liveSub
        : isTarget ? (highlight?.kind === "continue" ? "runs to predicted trip" : highlight?.kind === "baseline" ? "assumed healthy" : "maintenance window") : st === "healthy" ? `health ${pm.m.health.toFixed(0)}` : `${st} · health ${pm.m.health.toFixed(0)}`;
      out.push({
        id: pm.m.id,
        at: fixed(P(pm.x, pm.y, machineParts(pm.m.kind).height + 0.9)),
        node: <Chip title={pm.m.id} sub={sub} color={isTarget ? pal.accent : STATUS_COLOR[st]} emphasis={st !== "healthy" || isTarget || selected} pal={pal} />,
      });
    }
    // Pinned HMI panels: live signals of a machine, kept on screen while you move around.
    if (views)
      for (const id of pins) {
        const pm = layout.machines.find((m) => m.m.id === id);
        const a = assetById.get(id);
        if (!pm || !a) continue;
        out.push({
          id: `pin:${id}`,
          at: fixed(P(pm.x, pm.y, machineParts(pm.m.kind).height + 1.9)),
          node: <PinnedPanel state={state} assetId={id} onClose={() => togglePin(state.profile.id, id)} />,
        });
      }
    // End-of-line counters (live data): good units in the last 8 h at each line's last machine.
    if (live)
      for (const line of state.lines) {
        const last = layout.machines.filter((m) => m.lineId === line.id).at(-1);
        if (!last) continue;
        out.push({
          id: `count:${line.id}`,
          at: fixed(P(last.x + 0.9, last.y + 0.6, 0.7)),
          node: <Chip title={`${fmtCount(lineOutput(state, line.id))} good`} sub={`${line.name} · last 8 h · ${Math.round((flows[line.id] ?? 0) * 100)}% pace`} color={(flows[line.id] ?? 0) > 0 ? "#22c55e" : "#ef4444"} emphasis pal={pal} />,
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
  }, [pal, layout, highlight, selectedId, labels, cameras, robots, paths, live, state, flows, views, pins, togglePin]);
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
        <XR store={xrStore}>
        {/* In VR/AR the viewer stands at the front edge of the plant floor, facing it. */}
        <XROrigin position={[center.x, 0, center.z + span * 0.55]} />
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
          flows={flows}
          plantRef={plantRef}
          facility={{ id: state.profile.id, name: state.profile.name }}
        />
        </XR>
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
        <PoseProbe pose={pose} capture={capture} />
        <LabelProjector anchors={anchorsRef} els={labelEls} />
        {quality === "high" && (
          <Suspense fallback={null}>
            <Effects />
          </Suspense>
        )}
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {anchors.filter((a) => !a.id.startsWith("pin:")).map((a) => (
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
      <div className="pointer-events-none absolute inset-0 overflow-hidden" data-testid="pinned-panels">
        {anchors
          .filter((a) => a.id.startsWith("pin:"))
          .map((a) => (
            <div
              key={a.id}
              ref={(el) => {
                if (el) labelEls.current.set(a.id, el);
                else labelEls.current.delete(a.id);
              }}
              className="absolute top-0 left-0"
              style={{ visibility: "hidden" }}
            >
              <div className="pointer-events-auto -translate-x-1/2 -translate-y-full">{a.node}</div>
            </div>
          ))}
      </div>

      {/* view controls */}
      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--shadow-card)]">
        {[
          { label: "Reset view", icon: Maximize, onClick: () => setGoal({ target: center.clone(), position: home.clone() }) },
          { label: "Top view", icon: Eye, onClick: () => setGoal({ target: center.clone(), position: top.clone() }) },
          { label: "Focus the selection", icon: Crosshair, onClick: () => focus(selectedId), disabled: !selectedId },
          ...(views
            ? [
                {
                  label: selectedId && pins.includes(selectedId) ? "Unpin the live panel" : "Pin a live panel for the selected machine",
                  icon: Pin,
                  onClick: () => selectedId && togglePin(state.profile.id, selectedId),
                  disabled: !selectedId || !state.assets.some((a) => a.id === selectedId),
                },
              ]
            : []),
          { label: spin ? "Stop turntable" : "Turntable", icon: spin ? Pause : RotateCw, onClick: () => setSpin(!spin) },
          {
            label: exporting ? "Exporting…" : "Download the 3D model (.glb)",
            icon: Download,
            disabled: exporting,
            onClick: async () => {
              if (!plantRef.current) return;
              setExporting(true);
              try {
                const { exportPlantGlb } = await import("./export-glb");
                await exportPlantGlb(plantRef.current, state);
              } finally {
                setExporting(false);
              }
            },
          },
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
          { on: live, label: "Live data", icon: Activity, onClick: () => setLive(!live) },
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
      {(xr.vr || xr.ar) && (
        <div className="absolute top-3 left-1/2 flex -translate-x-1/2 gap-1.5" data-testid="xr-buttons">
          {xr.vr && (
            <button onClick={() => xrStore.enterVR()} className="flex h-8 items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/12 px-3 text-[12px] font-medium text-accent-ink">
              <Glasses className="h-3.5 w-3.5" /> View in VR
            </button>
          )}
          {xr.ar && (
            <button onClick={() => xrStore.enterAR()} className="flex h-8 items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/12 px-3 text-[12px] font-medium text-accent-ink">
              <Smartphone className="h-3.5 w-3.5" /> View in AR
            </button>
          )}
        </div>
      )}
      {alarms.length > 0 && (
        <div className="absolute top-3 right-3 w-[280px] overflow-hidden rounded-lg border border-critical/40 bg-surface/95 text-[11.5px] shadow-[var(--shadow-card)] backdrop-blur" data-testid="alarm-list">
          <p className="flex items-center gap-1.5 border-b border-line px-2.5 py-1.5 font-medium text-ink">
            <AlertTriangle className="h-3.5 w-3.5 text-critical" /> Alarms · {alarms.length}
          </p>
          <ul className="max-h-48 overflow-auto">
            {alarms.slice(0, 8).map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => {
                    onSelect(a.assetId);
                    focus(a.assetId);
                  }}
                  className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2"
                >
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", a.severity === "critical" ? "bg-critical" : "bg-warning")} />
                  <span className="text-ink-2">
                    <span className="font-mono text-[10.5px] text-muted">{a.assetId}</span> {a.title}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="pointer-events-none absolute right-3 bottom-3 hidden text-[10.5px] text-muted sm:block">
        <Play className="mr-1 inline h-2.5 w-2.5" />
        Drag to orbit · right-drag to pan · scroll to zoom · double-click to focus
      </p>
      <DoubleClickFocus onFocus={() => focus(selectedId)} />
      {views && (
        <div className="absolute bottom-12 left-14 flex items-end gap-1.5">
          <ViewsMenu facilityId={state.profile.id} pose={pose} />
          <AskView capture={capture} />
        </div>
      )}
    </div>
  );
}

/** Save the current viewpoint as a view (fly back later) or a virtual camera (live on the camera wall). */
function ViewsMenu({ facilityId, pose }: { facilityId: string; pose: MutableRefObject<Pose | null> }) {
  const { views, load, save, remove, go, facilityId: loadedFor } = useView3d();
  const operator = useUi((s) => s.operator);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void load(loadedFor !== null && loadedFor !== facilityId);
  }, [load, facilityId, loadedFor]);
  const cams = views.filter((v) => v.kind === "camera").length;
  const submit = async () => {
    const p = pose.current;
    if (!p || !name.trim()) return;
    setError(null);
    try {
      await save({ name: name.trim(), kind: camera ? "camera" : "view", ...p, by: operator });
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="relative" data-testid="views-menu">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn("flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px]", open ? "border-accent/50 bg-accent/12 text-accent-ink" : "border-line bg-surface text-muted hover:text-ink")}
      >
        <Bookmark className="h-3 w-3" /> Views{views.length ? ` · ${views.length}` : ""}
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 w-[270px] rounded-lg border border-line bg-surface p-2.5 text-[11.5px] shadow-[var(--shadow-card)]">
          <ul className="mb-2 max-h-44 space-y-0.5 overflow-auto">
            {views.length === 0 && <li className="text-muted">No saved views. Orbit to a viewpoint, name it and save.</li>}
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-1.5">
                <button onClick={() => go({ kind: "pose", position: v.position, target: v.target })} className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-ink-2 hover:bg-surface-2 hover:text-ink">
                  {v.kind === "camera" ? <Video className="h-3 w-3 shrink-0 text-accent" /> : <Bookmark className="h-3 w-3 shrink-0 text-muted" />}
                  <span className="truncate">{v.name}</span>
                </button>
                <button aria-label={`Delete view ${v.name}`} onClick={() => void remove(v.id)} className="p-1 text-muted hover:text-critical">
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1.5">
            <input
              aria-label="View name"
              value={name}
              maxLength={60}
              placeholder="Name this viewpoint"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-shell px-2 text-ink outline-none focus:border-accent"
            />
            <button onClick={() => void submit()} disabled={!name.trim()} className="h-7 rounded-md border border-accent/50 bg-accent/12 px-2.5 font-medium text-accent-ink disabled:opacity-40">
              Save
            </button>
          </div>
          <label className="mt-1.5 flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={camera} onChange={(e) => setCamera(e.target.checked)} />
            Virtual camera: show live on the CCTV wall{cams >= LIVE_CAMERA_LIMIT ? ` (wall shows the first ${LIVE_CAMERA_LIMIT})` : ""}
          </label>
          {error && <p className="mt-1 text-critical-ink">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** Double-click anywhere in the view focuses the current selection (the click itself selects first). */
const fmtCount = (n: number) => n.toLocaleString("en-US");

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

export function Scene({
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
  flows,
  plantRef,
  facility,
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
  flows: Record<string, number>;
  plantRef: MutableRefObject<THREE.Group | null>;
  facility: { id: string; name: string };
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

      <group ref={plantRef} name="TwinPlant" userData={{ twin: { type: "plant", facilityId: facility.id, name: facility.name, unit: "layout unit ≈ 2 m" } }}>
      <Shell layout={layout} mats={mats} quality={quality} onMiss={() => onSelect(null)} />
      {layout.bays.map((bay) => {
        const hot = !!highlight && (highlight.lineIds.includes(bay.id) || highlight.rerouteLineId === bay.id);
        return <BayZone key={bay.id} bay={bay} mats={mats} accent={pal.accent} color={pal.resolve(bay.color)} hot={hot} dim={!!highlight && !hot} />;
      })}
      {layout.belts.map((bt) => {
        const hot = !!highlight && (highlight.rerouteLineId === bt.lineId || highlight.lineIds.includes(bt.lineId));
        return <Belt3D key={bt.id} bt={bt} pal={pal} mats={mats} quality={quality} hot={hot} dim={!!highlight && !hot} flow={flows[bt.lineId] ?? (bt.running ? 1 : 0)} />;
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
      </group>
    </>
  );
}

/** Ask the AI about what this view shows: a frame of the 3D view plus the twin's actual state. */
function AskView({ capture }: { capture: MutableRefObject<Capture | null> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ answer: string; model: string } | { error: string } | null>(null);
  const ask = async () => {
    const shot = await capture.current?.();
    if (!shot) return setOut({ error: "Couldn't capture the 3D view." });
    setBusy(true);
    setOut(null);
    try {
      const form = new FormData();
      form.append("image", shot, "twin-view.jpg");
      form.append("question", q);
      const res = await fetch("/api/twin-view/ask", { method: "POST", body: form, cache: "no-store" });
      const d = (await res.json().catch(() => null)) as { answer?: string; model?: string; error?: string } | null;
      setOut(res.ok && d?.answer ? { answer: d.answer, model: d.model ?? "" } : { error: d?.error ?? `Request failed (${res.status})` });
    } catch (e) {
      setOut({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative" data-testid="ask-view">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn("flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px]", open ? "border-agent/50 bg-agent/12 text-agent" : "border-line bg-surface text-muted hover:text-ink")}
      >
        <Sparkles className="h-3 w-3" /> Ask AI about this view
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 w-[320px] rounded-lg border border-line bg-surface p-2.5 text-[11.5px] shadow-[var(--shadow-card)]">
          <div className="flex gap-1.5">
            <input
              aria-label="Question about the view"
              value={q}
              maxLength={500}
              placeholder="What's wrong here? (optional)"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void ask()}
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-shell px-2 text-ink outline-none focus:border-accent"
            />
            <button onClick={() => void ask()} disabled={busy} className="h-7 rounded-md border border-agent/50 bg-agent/12 px-2.5 font-medium text-agent disabled:opacity-40">
              {busy ? "Looking…" : "Ask"}
            </button>
          </div>
          {out && "answer" in out && (
            <div className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-ink-2" data-testid="ask-view-answer">
              {out.answer}
              <p className="mt-1 text-[10.5px] text-muted">{out.model} · picture + live twin state</p>
            </div>
          )}
          {out && "error" in out && <p className="mt-2 text-critical-ink">{out.error}</p>}
          <p className="mt-1.5 text-[10.5px] text-muted">Sends this frame and the twin&apos;s current state to the AI. Nothing is stored.</p>
        </div>
      )}
    </div>
  );
}

/** A pinned HMI panel: the machine's live signals, with alarm states, anchored above it in 3D. */
function PinnedPanel({ state, assetId, onClose }: { state: FactoryState; assetId: string; onClose: () => void }) {
  const a = state.assets.find((x) => x.id === assetId);
  if (!a) return null;
  const sig = assetSignals(state, a).filter((x) => x.name !== "Fault");
  return (
    <div className="w-[210px] overflow-hidden rounded-lg border border-line bg-surface/95 text-[11px] shadow-[var(--shadow-card)] backdrop-blur" data-testid={`pinned-${assetId}`}>
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-1">
        <span className={cn("h-2 w-2 rounded-full", a.status === "healthy" ? "bg-healthy" : a.status === "warning" ? "bg-warning" : a.status === "critical" ? "bg-critical" : "bg-muted")} />
        <span className="min-w-0 flex-1 truncate font-medium text-ink">
          <span className="font-mono text-[10px] text-muted">{a.id}</span> {a.name}
        </span>
        <button aria-label={`Unpin ${a.id}`} onClick={onClose} className="text-muted hover:text-ink">
          <X className="h-3 w-3" />
        </button>
      </div>
      <table className="w-full">
        <tbody>
          {sig.map((x) => (
            <tr key={x.id}>
              <td className="px-2 py-0.5 text-muted">{x.name}</td>
              <td className={cn("tabular px-2 py-0.5 text-right", x.state === "trip" ? "text-critical-ink" : x.state === "alarm" ? "text-warning-ink" : "text-ink")}>
                {typeof x.value === "number" ? (Math.abs(x.value) >= 100 ? x.value.toFixed(0) : x.value.toFixed(1)) : x.value ? "yes" : "no"} {x.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
