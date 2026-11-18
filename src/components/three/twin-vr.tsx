"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { createXRStore, XR, XROrigin, useXR } from "@react-three/xr";
import * as THREE from "three";
import { Glasses, Smartphone } from "lucide-react";
import { amrFleet } from "@/domain/intralogistics";
import { activeAlarms, assetSignals, lineFlows } from "@/domain/live";
import type { FactoryState } from "@/domain/types";
import { machineParts } from "../iso/geometry";
import { isoModelFromState, layoutIso } from "../iso/model";
import { amrPaths } from "./amr-paths";
import { usePalette } from "./palette";
import { P } from "./scene";
import { Scene } from "./twin-3d";

const EYE = 1.6; // standing eye height, layout units ≈ m in the 3D scene

/** A text board in the scene (drawn to a canvas texture), so it is visible inside the headset. */
function Board({ lines, accent, position, width = 1.5 }: { lines: { text: string; tone?: "title" | "warn" | "bad" | "ok" | "muted" }[]; accent: string; position: [number, number, number]; width?: number }) {
  const tex = useMemo(() => {
    const W = 512;
    const rowH = 44;
    const H = 24 + lines.length * rowH;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(10,14,24,0.92)";
    g.beginPath();
    g.roundRect(0, 0, W, H, 22);
    g.fill();
    g.fillStyle = accent;
    g.fillRect(0, 0, 10, H);
    lines.forEach((l, i) => {
      g.font = l.tone === "title" ? "600 30px system-ui, sans-serif" : "26px system-ui, sans-serif";
      g.fillStyle = l.tone === "bad" ? "#f87171" : l.tone === "warn" ? "#fbbf24" : l.tone === "ok" ? "#4ade80" : l.tone === "muted" ? "#94a3b8" : "#e5e7eb";
      g.fillText(l.text, 28, 44 + i * rowH);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { t, aspect: H / W };
  }, [lines, accent]);
  useEffect(() => () => tex.t.dispose(), [tex]);
  return (
    <Billboard position={position}>
      <mesh>
        <planeGeometry args={[width, width * tex.aspect]} />
        <meshBasicMaterial map={tex.t} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

/** Before entering VR, look at the plant from where you'll stand: the front edge, at eye height. */
function StandingView({ eye, target }: { eye: THREE.Vector3; target: THREE.Vector3 }) {
  const camera = useThree((s) => s.camera);
  const session = useXR((s) => s.session);
  useEffect(() => {
    if (session) return;
    camera.position.copy(eye);
    camera.lookAt(target);
  }, [camera, eye, target, session]);
  return null;
}

/**
 * The plant in VR (and passthrough AR) for Meta Quest Browser and other WebXR headsets. You stand
 * at the front of the plant floor; point at a machine with a hand (pinch) or controller (trigger)
 * to select it, and its live signals appear on a board above it. Machines with alarms always show
 * a board. On localhost without a headset, a Meta Quest 3 is emulated for development.
 */
export function TwinVR({ state }: { state: FactoryState }) {
  const pal = usePalette();
  const store = useMemo(() => createXRStore({ emulate: "metaQuest3", offerSession: false }), []);
  const [support, setSupport] = useState<{ vr: boolean; ar: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const plantRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    let alive = true;
    // The emulator (localhost only) installs navigator.xr once the store is created.
    const check = async () => {
      const xr = (navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean> } }).xr;
      if (!xr) return alive && setSupport({ vr: false, ar: false });
      const [vr, ar] = await Promise.all([xr.isSessionSupported("immersive-vr").catch(() => false), xr.isSessionSupported("immersive-ar").catch(() => false)]);
      if (alive) setSupport({ vr, ar });
    };
    void check();
    // The emulator loads asynchronously; check again whenever the XR store changes.
    const unsub = store.subscribe(() => void check());
    const t = setTimeout(check, 1500);
    return () => {
      alive = false;
      unsub();
      clearTimeout(t);
    };
  }, [store]);

  const model = useMemo(() => isoModelFromState(state, {}, { cameras: false }), [state]);
  const layout = useMemo(() => layoutIso(model), [model]);
  const paths = useMemo(() => amrPaths(layout, amrFleet(state), state.lines.map((l) => l.id)), [layout, state]);
  const flows = useMemo(() => lineFlows(state), [state]);
  const b = layout.bounds;
  const center = useMemo(() => new THREE.Vector3(...P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)), [b.x0, b.x1, b.y0, b.y1]);
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const front = useMemo(() => new THREE.Vector3(center.x, 0, center.z + span * 0.55), [center, span]);
  const eye = useMemo(() => front.clone().add(new THREE.Vector3(0, EYE, 0)), [front]);
  const lookAt = useMemo(() => center.clone().add(new THREE.Vector3(0, 0.6, 0)), [center]);

  const boards = useMemo(() => {
    const alarmed = new Map(activeAlarms(state).map((a) => [a.assetId, a]));
    const ids = new Set<string>([...alarmed.keys(), ...(selected ? [selected] : [])]);
    return [...ids].flatMap((id) => {
      const pm = layout.machines.find((m) => m.m.id === id);
      const a = state.assets.find((x) => x.id === id);
      if (!pm || !a) return [];
      const alarm = alarmed.get(id);
      const sig = assetSignals(state, a).filter((s) => ["Running", "Throughput", "Vibration", "Temperature", "Health"].includes(s.name));
      const lines = [
        { text: `${a.id} · ${a.name}`, tone: "title" as const },
        ...(alarm ? [{ text: alarm.title.slice(0, 34), tone: alarm.severity === "critical" ? ("bad" as const) : ("warn" as const) }] : []),
        ...(id === selected
          ? sig.map((s) => ({
              text: `${s.name}: ${typeof s.value === "number" ? (Math.abs(s.value) >= 100 ? s.value.toFixed(0) : s.value.toFixed(1)) : s.value ? "yes" : "no"} ${s.unit}`,
              tone: s.state === "trip" ? ("bad" as const) : s.state === "alarm" ? ("warn" as const) : ("muted" as const),
            }))
          : [{ text: `health ${a.healthScore.toFixed(0)} · ${a.signal.vibration.toFixed(1)} mm/s`, tone: "muted" as const }]),
      ];
      return [{ id, lines, accent: alarm ? (alarm.severity === "critical" ? "#ef4444" : "#f59e0b") : "#4c8dff", position: P(pm.x, pm.y, machineParts(pm.m.kind).height + 1.1) }];
    });
  }, [state, layout, selected]);

  if (!pal) return <div className="h-full w-full" />;
  return (
    <div className="relative h-full w-full" data-testid="twin-vr">
      <Canvas camera={{ fov: 70, near: 0.05, far: 400, position: eye.toArray() }} onCreated={({ gl }) => void (gl.toneMapping = THREE.ACESFilmicToneMapping)} aria-label="The plant in VR">
        <XR store={store}>
          <XROrigin position={front.toArray()} />
          <StandingView eye={eye} target={lookAt} />
          <Scene
            pal={pal}
            quality="standard"
            layout={layout}
            paths={paths}
            selectedId={selected}
            onSelect={(id) => setSelected(id && state.assets.some((a) => a.id === id) ? id : null)}
            cameras={false}
            affected={() => true}
            highlight={null}
            registerAmr={() => undefined}
            flows={flows}
            plantRef={plantRef}
            facility={{ id: state.profile.id, name: state.profile.name }}
          />
          {boards.map((bd) => (
            <Board key={bd.id} lines={bd.lines} accent={bd.accent} position={bd.position} />
          ))}
        </XR>
      </Canvas>
      <div className="absolute top-3 left-3 max-w-[340px] rounded-lg border border-line bg-surface/90 px-3 py-2 text-[12px] shadow-[var(--shadow-card)] backdrop-blur">
        <p className="font-medium text-ink">Walk the plant in VR</p>
        <p className="mt-0.5 leading-snug text-muted">
          You stand at the front of the plant floor. Point at a machine with your hand (pinch) or controller (trigger) to see its live signals; machines with alarms always show theirs.
        </p>
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2" data-testid="vr-buttons">
        <button
          onClick={() => void store.enterVR()}
          disabled={!support?.vr}
          className="flex h-10 items-center gap-2 rounded-xl border border-accent/60 bg-accent px-4 text-[13px] font-medium text-white shadow-lg disabled:opacity-40"
        >
          <Glasses className="h-4 w-4" /> Enter VR
        </button>
        <button
          onClick={() => void store.enterAR()}
          disabled={!support?.ar}
          className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-medium text-ink shadow-lg disabled:opacity-40"
        >
          <Smartphone className="h-4 w-4" /> Enter passthrough AR
        </button>
      </div>
      {support && !support.vr && !support.ar && (
        <p className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-md bg-surface/90 px-3 py-1 text-[11.5px] text-muted">Open this page in Meta Quest Browser (or another WebXR browser) to enter VR.</p>
      )}
    </div>
  );
}
