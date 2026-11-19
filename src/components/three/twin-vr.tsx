"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { createXRStore, TeleportTarget, XR, XROrigin, useXR, useXRControllerLocomotion } from "@react-three/xr";
import * as THREE from "three";
import { Glasses, LogOut, Move, Search, Smartphone } from "lucide-react";
import { useAdmin } from "@/client/admin";
import { api } from "@/client/api";
import { useFactory, useUi } from "@/client/store";
import { amrFleet } from "@/domain/intralogistics";
import { activeAlarms, assetSignals, lineFlows } from "@/domain/live";
import type { FactoryState } from "@/domain/types";
import { machineParts } from "../iso/geometry";
import { isoModelFromState, layoutIso } from "../iso/model";
import { amrPaths } from "./amr-paths";
import { usePalette } from "./palette";
import { P } from "./scene";
import { Scene } from "./twin-3d";
import { FIND_KIND_LABEL, findEntries, findIndex, standPoint, type FindEntry, type FindKind } from "./vr-search";

const EYE = 1.6; // standing eye height, layout units ≈ m in the 3D scene

// The development headset emulator bundles an older three.js renderer that calls Material.onBuild,
// which current three.js no longer defines. A no-op keeps emulation working; real headsets never call it.
const proto = THREE.Material.prototype as unknown as { onBuild?: () => void };
if (typeof proto.onBuild !== "function") proto.onBuild = () => undefined;

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

/** Draws text lines to a canvas texture (shared by boards and buttons). */
function textTexture(lines: { text: string; color?: string; font?: string }[], w: number, h: number, bg: string, border?: string) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 0, w, h, Math.min(24, h / 3));
  g.fill();
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 6;
    g.stroke();
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => {
    g.font = l.font ?? "600 34px system-ui, sans-serif";
    g.fillStyle = l.color ?? "#e5e7eb";
    g.fillText(l.text, w / 2, (h * (i + 1)) / (lines.length + 1));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A 3D button: point with a hand or controller and pinch / pull the trigger (or click on screen). */
function Button3D({ label, color, position, width = 0.62, disabled, onPress }: { label: string; color: string; position: [number, number, number]; width?: number; disabled?: boolean; onPress: () => void }) {
  const [hover, setHover] = useState(false);
  const tex = useMemo(() => textTexture([{ text: label, color: disabled ? "#64748b" : "#f8fafc" }], 384, 128, disabled ? "rgba(30,41,59,0.9)" : hover ? color : "rgba(15,23,42,0.95)", disabled ? undefined : color), [label, color, hover, disabled]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh
      position={position}
      scale={hover && !disabled ? 1.06 : 1}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onPress();
      }}
    >
      <planeGeometry args={[width, width / 3]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

/**
 * The control panel that floats beside a selected machine: change its speed, trip it, restore it
 * and acknowledge its alarm. Uses the same audited commands as Signals & Commissioning; twin only.
 */
function ControlPanel({ state, assetId, position }: { state: FactoryState; assetId: string; position: [number, number, number] }) {
  const admin = useAdmin((s) => s.admin);
  const loaded = useAdmin((s) => s.loaded);
  const loadAdmin = useAdmin((s) => s.load);
  const apply = useFactory((s) => s.apply);
  const operator = useUi((s) => s.operator);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!loaded) void loadAdmin();
  }, [loaded, loadAdmin]);
  const a = state.assets.find((x) => x.id === assetId);
  const incident = state.incidents.find((i) => i.assetId === assetId && i.status === "open");
  const noteTex = useMemo(
    () => textTexture([{ text: note?.text ?? (admin ? `Speed ${a?.speedPct ?? 0}% · ${a?.mode ?? ""}` : "Admin needed to change machines"), color: note ? (note.ok ? "#4ade80" : "#f87171") : "#94a3b8", font: "28px system-ui, sans-serif" }], 768, 96, "rgba(10,14,24,0.85)"),
    [note, admin, a?.speedPct, a?.mode],
  );
  useEffect(() => () => noteTex.dispose(), [noteTex]);
  if (!a) return null;
  const run = async (label: string, fn: () => Promise<FactoryState>) => {
    if (busy) return;
    setBusy(true);
    try {
      apply(await fn());
      setNote({ text: label, ok: true });
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message.slice(0, 48) : "Failed", ok: false });
    } finally {
      setBusy(false);
    }
  };
  const speed = (d: number) => {
    const v = Math.max(30, Math.min(110, a.speedPct + d));
    return run(`Speed set to ${v}%`, async () => (await api<{ state: FactoryState }>(`/api/assets/${a.id}`, { method: "PATCH", body: { speedPct: v } })).state);
  };
  const fault = (mode: "failure" | "restore", label: string) => run(label, () => api<FactoryState>("/api/faults", { body: { assetId: a.id, mode, severity: mode === "failure" ? 100 : 0 } }));
  const off = !admin || busy;
  const running = a.mode === "running";
  return (
    <Billboard position={position}>
      <mesh position={[0, 0.48, -0.01]}>
        <planeGeometry args={[2.0, 0.25]} />
        <meshBasicMaterial map={noteTex} transparent toneMapped={false} />
      </mesh>
      <Button3D label="Speed −10%" color="#3b82f6" position={[-0.66, 0.2, 0]} disabled={off || a.speedPct <= 30} onPress={() => void speed(-10)} />
      <Button3D label="Speed +10%" color="#3b82f6" position={[0, 0.2, 0]} disabled={off || a.speedPct >= 110} onPress={() => void speed(10)} />
      <Button3D label={running ? "Trip" : "Restore"} color={running ? "#ef4444" : "#22c55e"} position={[0.66, 0.2, 0]} disabled={off} onPress={() => void (running ? fault("failure", `${a.id} tripped`) : fault("restore", `${a.id} restored`))} />
      <Button3D
        label={incident ? "Acknowledge alarm" : "No open alarm"}
        color="#f59e0b"
        width={1.3}
        position={[0, -0.06, 0]}
        disabled={off || !incident}
        onPress={() => incident && void run(`${incident.id} acknowledged`, async () => (await api<{ state: FactoryState }>(`/api/incidents/${incident.id}/ack`, { body: { by: operator } })).state)}
      />
    </Billboard>
  );
}

/** Thumbsticks in the headset: left to move, right to snap-turn. */
function Locomotion({ origin }: { origin: RefObject<THREE.Group | null> }) {
  useXRControllerLocomotion(origin, { speed: 2.2 }, { type: "snap", degrees: 45 });
  return null;
}

/**
 * On-screen walking when no headset is in use: drag to look around, W A S D or the arrow keys to
 * walk (Shift to go faster). You stay at eye height and inside the plant walls.
 */
/**
 * Find, in the headset: typing is impractical in VR, so pick a category, then an item (6 per page).
 * Choosing an item teleports you in front of it.
 */
function FindMenu({ index, onPick, onClose }: { index: FindEntry[]; onPick: (e: FindEntry) => void; onClose: () => void }) {
  const [kind, setKind] = useState<FindKind | null>(null);
  const [page, setPage] = useState(0);
  const kinds = (Object.keys(FIND_KIND_LABEL) as FindKind[]).filter((k) => index.some((e) => e.kind === k));
  const items = kind ? index.filter((e) => e.kind === kind) : [];
  const per = 6;
  const pages = Math.max(1, Math.ceil(items.length / per));
  const shown = items.slice(page * per, page * per + per);
  const short = (t: string) => (t.length > 26 ? `${t.slice(0, 25)}…` : t);
  return (
    <group position={[0, 1.35, -1.1]}>
      {!kind ? (
        <>
          {kinds.map((k, i) => (
            <Button3D key={k} label={`${FIND_KIND_LABEL[k]} (${index.filter((e) => e.kind === k).length})`} color="#4c8dff" width={0.9} position={[i % 2 ? 0.48 : -0.48, 0.3 - Math.floor(i / 2) * 0.33, 0]} onPress={() => (setKind(k), setPage(0))} />
          ))}
          <Button3D label="Close" color="#64748b" width={0.5} position={[0, 0.3 - Math.ceil(kinds.length / 2) * 0.33, 0]} onPress={onClose} />
        </>
      ) : (
        <>
          {shown.map((e, i) => (
            <Button3D key={e.key} label={short(e.label)} color="#22c55e" width={0.9} position={[i % 2 ? 0.48 : -0.48, 0.3 - Math.floor(i / 2) * 0.33, 0]} onPress={() => onPick(e)} />
          ))}
          <Button3D label="‹ Back" color="#64748b" width={0.45} position={[-0.62, -0.7, 0]} onPress={() => setKind(null)} />
          <Button3D label={`Page ${page + 1}/${pages}`} color="#64748b" width={0.5} position={[0, -0.7, 0]} disabled={pages < 2} onPress={() => setPage((page + 1) % pages)} />
          <Button3D label="Close" color="#64748b" width={0.45} position={[0.62, -0.7, 0]} onPress={onClose} />
        </>
      )}
    </group>
  );
}

type Jump = { eye: THREE.Vector3; target: THREE.Vector3; n: number } | null;

function WalkControls({ eye, target, bounds, jump }: { eye: THREE.Vector3; target: THREE.Vector3; bounds: { x0: number; x1: number; z0: number; z1: number }; jump: Jump }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const session = useXR((s) => s.session);
  const yaw = useRef(0);
  const pitch = useRef(0);
  const keys = useRef(new Set<string>());
  useEffect(() => {
    camera.position.copy(eye);
    const d = target.clone().sub(eye);
    yaw.current = Math.atan2(-d.x, -d.z);
    pitch.current = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }, [camera, eye, target]);
  // "Go to" from search: stand where asked, looking at the target.
  useEffect(() => {
    if (!jump) return;
    camera.position.copy(jump.eye);
    const d = jump.target.clone().sub(jump.eye);
    yaw.current = Math.atan2(-d.x, -d.z);
    pitch.current = Math.atan2(d.y, Math.hypot(d.x, d.z));
  }, [camera, jump]);
  useEffect(() => {
    if (session) return;
    const el = gl.domElement;
    let last: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => void (last = { x: e.clientX, y: e.clientY });
    const move = (e: PointerEvent) => {
      if (!last) return;
      yaw.current -= (e.clientX - last.x) * 0.005;
      pitch.current = Math.max(-1.3, Math.min(1.3, pitch.current - (e.clientY - last.y) * 0.005));
      last = { x: e.clientX, y: e.clientY };
    };
    const up = () => void (last = null);
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && (e.target.closest("input, textarea, select, [contenteditable]") !== null);
    const kd = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(e.code)) {
        keys.current.add(e.code);
        if (e.code.startsWith("Arrow")) e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
    };
  }, [gl, session]);
  useFrame((_, dt) => {
    if (session) return;
    const k = keys.current;
    const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    const speed = (k.has("ShiftLeft") || k.has("ShiftRight") ? 6 : 2.5) * Math.min(dt, 0.1);
    const sy = Math.sin(yaw.current);
    const cy = Math.cos(yaw.current);
    camera.position.x = Math.max(bounds.x0, Math.min(bounds.x1, camera.position.x + (-sy * f + cy * r) * speed));
    camera.position.z = Math.max(bounds.z0, Math.min(bounds.z1, camera.position.z + (-cy * f - sy * r) * speed));
    camera.position.y = EYE;
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitch.current, yaw.current, 0);
  });
  return null;
}

const SIM_KEY = "twin-vr-simulate";
const isLocalhost = () => typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
/**
 * Development only (localhost): desktop Chrome reports WebXR but has no headset, so the Quest
 * emulator stands aside. With "Simulate Quest headset" on, that empty runtime is hidden for this
 * tab so the emulator can install. Never active on a real deployment.
 */
function simulationOn(): boolean {
  if (!isLocalhost()) return false;
  try {
    if (sessionStorage.getItem(SIM_KEY) !== "1") return false;
  } catch {
    return false;
  }
  Object.defineProperty(Navigator.prototype, "xr", { get: () => undefined, configurable: true });
  return true;
}

/**
 * The plant in VR (and passthrough AR) for Meta Quest Browser and other WebXR headsets. You stand
 * at the front of the plant floor; point at a machine with a hand (pinch) or controller (trigger)
 * to select it, and its live signals appear on a board above it. Machines with alarms always show
 * a board. On localhost without a headset, a Meta Quest 3 is emulated for development.
 */
export function TwinVR({ state }: { state: FactoryState }) {
  const pal = usePalette();
  // On localhost without WebXR, emulate a Meta Quest 3 (stereo, no synthetic room) for development.
  const [simulating] = useState(() => simulationOn());
  const [inXR, setInXR] = useState(false);
  const store = useMemo(() => createXRStore({
        emulate: {
          type: "metaQuest3",
          syntheticEnvironment: false,
          // One full-size view on screen (a headset renders both eyes itself).
          stereoEnabled: false,
          headset: { position: [0, 1.7, 0], rotation: [0.12, 0, 0] },
          controller: { left: { position: [-0.32, -0.42, -0.45] }, right: { position: [0.32, -0.42, -0.45] } },
        },
        controller: { teleportPointer: true },
        hand: { teleportPointer: true },
        offerSession: false,
      }), []);
  const [support, setSupport] = useState<{ vr: boolean; ar: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [jump, setJump] = useState<Jump>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const originRef = useRef<THREE.Group>(null);
  useEffect(() => {
    setInXR(store.getState().session != null);
    return store.subscribe((st) => setInXR(st.session != null));
  }, [store]);
  const exitXR = () => void store.getState().session?.end();
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
  // Stand on the floor in front of the lines, inside the dock apron.
  const front = useMemo(() => new THREE.Vector3(center.x, 0, center.z + span * 0.3), [center, span]);
  const eye = useMemo(() => front.clone().add(new THREE.Vector3(0, EYE, 0)), [front]);
  const lookAt = useMemo(() => center.clone().add(new THREE.Vector3(0, 0.6, 0)), [center]);
  const originPos = useMemo(() => front.toArray() as [number, number, number], [front]);
  const walkBounds = useMemo(() => ({ x0: b.x0 - 0.5, x1: b.x1 + 0.5, z0: b.y0 - 0.5, z1: b.y1 + 3 }), [b.x0, b.x1, b.y0, b.y1]);
  const headset = !!support && (support.vr || support.ar);

  const index = useMemo(() => findIndex(state, layout, paths), [state, layout, paths]);
  const results = useMemo(() => findEntries(index, query), [index, query]);
  /** Go to a search result: stand at a clear spot a few metres away, facing it; select machines. */
  const goTo = (e: FindEntry) => {
    const target = new THREE.Vector3(...P(e.x, e.y, 1.3));
    const sp = standPoint(layout, e.x, e.y, { x0: walkBounds.x0, x1: walkBounds.x1, y0: walkBounds.z0, y1: walkBounds.z1 }, e.assetId);
    const stand = new THREE.Vector3(...P(sp.x, sp.y, 0));
    if (originRef.current && inXR) {
      originRef.current.position.set(stand.x, 0, stand.z);
      // Face the target (the headset's forward is -z of the origin).
      originRef.current.rotation.set(0, Math.atan2(-(target.x - stand.x), -(target.z - stand.z)), 0);
    } else setJump({ eye: stand.clone().setY(EYE), target, n: Date.now() });
    if (e.assetId) setSelected(e.assetId);
    setQuery("");
    setFindOpen(false);
  };
  // "/" focuses search (when not typing elsewhere).
  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (ev.key !== "/" || (ev.target instanceof HTMLElement && ev.target.closest("input, textarea, select"))) return;
      ev.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

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
        ...(alarm ? [{ text: `${alarm.acknowledged ? "ACK · " : ""}${alarm.title}`.slice(0, 36), tone: alarm.acknowledged ? ("muted" as const) : alarm.severity === "critical" ? ("bad" as const) : ("warn" as const) }] : []),
        ...(id === selected
          ? sig.map((s) => ({
              text: `${s.name}: ${typeof s.value === "number" ? (Math.abs(s.value) >= 100 ? s.value.toFixed(0) : s.value.toFixed(1)) : s.value ? "yes" : "no"} ${s.unit}`,
              tone: s.state === "trip" ? ("bad" as const) : s.state === "alarm" ? ("warn" as const) : ("muted" as const),
            }))
          : [{ text: `health ${a.healthScore.toFixed(0)} · ${a.signal.vibration.toFixed(1)} mm/s`, tone: "muted" as const }]),
      ];
      return [{ id, lines, accent: alarm ? (alarm.severity === "critical" ? "#ef4444" : "#f59e0b") : "#4c8dff", position: P(pm.x, pm.y, machineParts(pm.m.kind).height + 0.9) }];
    });
  }, [state, layout, selected]);

  const selectedPos = useMemo<[number, number, number] | null>(() => {
    const pm = selected ? layout.machines.find((m) => m.m.id === selected) : null;
    // Beside the machine, at chest height, on the side facing the front of the plant.
    return pm ? (P(pm.x, pm.y + 1.6, 1.0) as [number, number, number]) : null;
  }, [selected, layout]);

  if (!pal) return <div className="h-full w-full" />;
  return (
    <div className="relative h-full w-full" data-testid="twin-vr">
      <Canvas camera={{ fov: 70, near: 0.05, far: 400, position: eye.toArray() }} onCreated={({ gl }) => void (gl.toneMapping = THREE.ACESFilmicToneMapping)} aria-label="The plant in VR">
        <XR store={store}>
          <XROrigin ref={originRef} position={originPos}>
            {/* Exit VR: always within reach, at waist height in front of you; moves and turns with you. */}
            {inXR && <Button3D label="Exit VR" color="#64748b" position={[0.3, 0.85, -0.7]} width={0.5} onPress={exitXR} />}
            {inXR && <Button3D label={findOpen ? "Hide Find" : "Find…"} color="#4c8dff" position={[-0.3, 0.85, -0.7]} width={0.5} onPress={() => setFindOpen(!findOpen)} />}
            {inXR && findOpen && <FindMenu index={index} onPick={goTo} onClose={() => setFindOpen(false)} />}
          </XROrigin>
          <Locomotion origin={originRef} />
          {/* Teleport: push a thumbstick forward (or pinch-and-hold with hands), aim at the floor, release. */}
          <TeleportTarget onTeleport={(p) => originRef.current?.position.set(p.x, 0, p.z)}>
            <mesh rotation-x={-Math.PI / 2} position={[center.x, 0.002, center.z]}>
              <planeGeometry args={[(b.x1 - b.x0) + 2, (b.y1 - b.y0) + 6]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </TeleportTarget>
          <WalkControls eye={eye} target={lookAt} bounds={walkBounds} jump={jump} />
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
            <Board key={bd.id} lines={bd.lines} accent={bd.accent} position={bd.position} width={2.2} />
          ))}
          {selectedPos && selected && <ControlPanel state={state} assetId={selected} position={selectedPos} />}
        </XR>
      </Canvas>
      {/* On <body>, above everything (including the headset simulator's own layer). */}
      {inXR &&
        createPortal(
          <button
            onClick={exitXR}
            style={{ zIndex: 2147483647 }}
            className="fixed top-16 left-1/2 flex h-10 -translate-x-1/2 items-center gap-2 rounded-xl border border-line bg-surface px-5 text-[13.5px] font-medium text-ink shadow-2xl hover:bg-surface-2"
            data-testid="exit-vr"
          >
            <LogOut className="h-4 w-4" /> Exit VR
          </button>,
          document.body,
        )}
      {!inXR && (
        <div className="absolute top-3 left-1/2 z-10 w-[min(420px,calc(100%-24px))] -translate-x-1/2" data-testid="vr-search">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface/95 px-3 text-[13px] shadow-[var(--shadow-card)] backdrop-blur focus-within:border-accent">
            <Search className="h-4 w-4 shrink-0 text-muted" />
            <input
              ref={searchRef}
              aria-label="Find in the plant"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results[0]) goTo(results[0]);
                if (e.key === "Escape") (setQuery(""), (e.target as HTMLInputElement).blur());
              }}
              placeholder="Find a machine, line, robot, camera, stock, order…  ( / )"
              className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
            />
          </label>
          {query.trim() && (
            <ul className="mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-surface/97 p-1 text-[12.5px] shadow-xl backdrop-blur" data-testid="vr-search-results">
              {results.length === 0 && <li className="px-2 py-1.5 text-muted">Nothing matches “{query}”.</li>}
              {results.map((r) => (
                <li key={r.key}>
                  <button onClick={() => goTo(r)} className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2">
                    <span className="w-16 shrink-0 text-[10.5px] tracking-wide text-muted uppercase">{FIND_KIND_LABEL[r.kind].replace(/s$/, "")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink">{r.label}</span>
                      <span className="block truncate text-[11px] text-muted">{r.sub}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div hidden={inXR} className="absolute top-14 left-3 max-w-[320px] rounded-lg border border-line bg-surface/90 px-3 py-2 text-[12px] shadow-[var(--shadow-card)] backdrop-blur">
        <p className="font-medium text-ink">Walk the plant in VR</p>
        <p className="mt-0.5 leading-snug text-muted">
          In a headset: left thumbstick to move, right to turn, push a stick forward and aim at the floor to teleport. Point at a machine and pinch / pull the trigger to select it: its live signals and a control panel (speed, trip / restore, acknowledge alarm) appear beside it.
        </p>
        <p className="mt-1.5 flex items-start gap-1.5 leading-snug text-ink-2" data-testid="walk-help">
          <Move className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span>
            On screen: <b>drag</b> to look around, <b>W A S D</b> or <b>arrow keys</b> to walk (<b>Shift</b> to go faster), <b>click</b> a machine for its live board and control panel.
          </span>
        </p>
      </div>
      <div hidden={inXR} className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2" data-testid="vr-buttons">
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
      {support && !headset && !inXR && (
        <p className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded-md bg-surface/90 px-3 py-1 text-center text-[11.5px] text-muted">
          No headset found, so you&apos;re walking on screen. To enter VR, open this page in Meta Quest Browser.
        </p>
      )}
      {isLocalhost() && !inXR && (support !== null || simulating) && (!headset || simulating) && (
        <button
          onClick={() => {
            try {
              if (simulating) sessionStorage.removeItem(SIM_KEY);
              else sessionStorage.setItem(SIM_KEY, "1");
            } catch {
              /* storage off: nothing to toggle */
            }
            window.location.reload();
          }}
          className="absolute right-3 bottom-4 h-8 rounded-lg border border-dashed border-line bg-surface/90 px-3 text-[11.5px] text-muted hover:text-ink"
          data-testid="simulate-headset"
        >
          {simulating ? "Stop simulating the headset" : "Simulate Quest headset (localhost)"}
        </button>
      )}
    </div>
  );
}
