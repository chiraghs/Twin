"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import { createXRStore, TeleportTarget, XR, XROrigin, useXR, useXRControllerLocomotion } from "@react-three/xr";
import * as THREE from "three";
import { Activity, Armchair, Check, Copy, Flame, Gauge, Glasses, History, LogOut, Move, Pause, Play, Search, Sparkles, Table2, Waves, Zap } from "lucide-react";
import { useAdmin } from "@/client/admin";
import { api } from "@/client/api";
import { useRecording } from "@/client/recording";
import { useFactory, useUi } from "@/client/store";
import { Button, Dialog } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { amrFleet } from "@/domain/intralogistics";
import { activeAlarms, assetSignals, lineFlows } from "@/domain/live";
import { machineStates, remainingLife, zoneEnvironment } from "@/domain/process-signals";
import { quickWhatIf, type QuickWhatIf } from "@/domain/quick-what-if";
import type { FactoryState } from "@/domain/types";
import type { HeatMetric } from "@/domain/voice-commands";
import { useVoiceSettings } from "@/client/speech";
import { machineParts } from "../iso/geometry";
import { isoModelFromState, layoutIso } from "../iso/model";
import { amrPaths } from "./amr-paths";
import { usePalette } from "./palette";
import { P } from "./scene";
import { Scene } from "./twin-3d";
import { FIND_KIND_LABEL, findEntries, findIndex, standPoint, type FindEntry, type FindKind } from "./vr-search";
import { GripTalk, useVrVoice, VoiceDock, VoiceRig3D } from "./vr-voice";
import { FpsProbe, HandMenu, QuestHand, SimulatorMouse, TablePlacer, useFps, type HandMenuItem } from "./vr-hands";
import { Board, Button3D, textTexture, THEME, type BoardLine, type Spark } from "./vr-ui";
import { VR_WINDOW_WIDTH, VRBrowser, VRNavBar } from "./vr-browser";
import { AlarmSounds, FlowOverlay, HEAT_LABEL, HEAT_LEGEND, HEAT_METRICS, heatCells, HeatOverlay, replayEvents, replayFrame, replayStart, replayStatus } from "./vr-overlays";
import { useView3d } from "@/client/view3d";

const EYE = 1.6; // standing eye height, layout units ≈ m in the 3D scene

// The development headset emulator bundles an older three.js renderer that calls Material.onBuild,
// which current three.js no longer defines. A no-op keeps emulation working; real headsets never call it.
const proto = THREE.Material.prototype as unknown as { onBuild?: () => void };
if (typeof proto.onBuild !== "function") proto.onBuild = () => undefined;

/**
 * The control panel that floats beside a selected machine: change its speed, trip it, restore it
 * and acknowledge its alarm. Uses the same audited commands as Signals & Commissioning; twin only.
 */
function ControlPanel({ state, assetId, position, onWhatIf }: { state: FactoryState; assetId: string; position: [number, number, number]; onWhatIf: (change: { speedPct?: number; maintainNow?: boolean }) => void }) {
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
    () => textTexture([{ text: note?.text ?? (admin ? `Speed ${a?.speedPct ?? 0}% · ${a?.mode ?? ""}` : "Admin needed to change machines"), color: note ? (note.ok ? THEME.healthyInk : THEME.criticalInk) : THEME.ink2, font: "500 26px system-ui, sans-serif" }], 768, 96),
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
      {/* What-if: simulated only, so anyone can ask. */}
      <Button3D label="What if −20%?" color="#a855f7" position={[-0.66, -0.32, 0]} onPress={() => onWhatIf({ speedPct: Math.max(30, a.speedPct - 20) })} />
      <Button3D label="What if +10%?" color="#a855f7" position={[0, -0.32, 0]} onPress={() => onWhatIf({ speedPct: Math.min(110, a.speedPct + 10) })} />
      <Button3D label="What if service now?" color="#a855f7" position={[0.66, -0.32, 0]} onPress={() => onWhatIf({ maintainNow: true })} />
    </Billboard>
  );
}

const walkDir = new THREE.Vector3();
const walkSide = new THREE.Vector3();
/**
 * W A S D or the arrow keys walk in the headset simulator, always. (The simulator's own keys only
 * drive the thumbstick while the mouse is locked to its view, so walking stopped after any click.)
 * Shift is left to the simulator's own free movement, and a locked mouse to its thumbstick keys.
 */
function SimKeyWalk({ origin }: { origin: RefObject<THREE.Group | null> }) {
  const keys = useRef(new Set<string>());
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const WALK = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]") !== null;
    const kd = (e: KeyboardEvent) => {
      if (!WALK.includes(e.code) || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      keys.current.add(e.code);
      if (e.code.startsWith("Arrow")) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => keys.current.delete(e.code);
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", clear);
    };
  }, []);
  useFrame((_, dt) => {
    const k = keys.current;
    const o = origin.current;
    if (!o || !k.size || document.pointerLockElement) return;
    const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const r = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    if (!f && !r) return;
    camera.getWorldDirection(walkDir).setY(0);
    if (walkDir.lengthSq() < 1e-6) return;
    walkDir.normalize();
    walkSide.set(-walkDir.z, 0, walkDir.x);
    const step = 2.2 * Math.min(dt, 0.1);
    o.position.addScaledVector(walkDir, f * step).addScaledVector(walkSide, r * step);
  });
  return null;
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
    camera.position.y = eye.y;
    camera.rotation.order = "YXZ";
    camera.rotation.set(pitch.current, yaw.current, 0);
  });
  return null;
}

const nextHeat = (h: HeatMetric | null): HeatMetric | null => {
  const i = h ? HEAT_METRICS.indexOf(h) : -1;
  return i + 1 < HEAT_METRICS.length ? HEAT_METRICS[i + 1] : null;
};

/** The replay board: when, and what had happened by then. */
function replayLines(state: FactoryState, hour: number): BoardLine[] {
  const ago = state.clock.hour - hour;
  const ev = replayEvents(state, hour, 3);
  return [
    { text: `Replay · ${ago < 1 ? `${Math.round(ago * 60)} min` : `${ago.toFixed(1)} h`} ago`, tone: "title" },
    ...(ev.length ? ev.map((e) => ({ text: `${(state.clock.hour - e.hour).toFixed(1)} h ago: ${e.assetId} ${e.title.replace(/^[^—:]+[—:]\s*/, "")}`, tone: e.severity === "critical" ? ("bad" as const) : ("warn" as const) })) : [{ text: "No incidents yet at this point", tone: "muted" as const }]),
  ];
}

/** Frame rate of the render loop (inside a headset: XR frames). Quest target: 72 fps or more. */
function FpsChip({ questPerf }: { questPerf?: boolean }) {
  const fps = useFps((s) => s.fps);
  const ms = useFps((s) => s.ms);
  if (!fps) return null;
  return (
    <span
      className={`ml-auto flex items-center gap-1 text-[11px] tabular ${fps >= 60 ? "text-success-ink" : "text-warning-ink"}`}
      title={`Render loop: ${fps} FPS (${ms ? `${ms}ms` : `${(1000 / fps).toFixed(1)}ms`} frame time) · Target: 72Hz`}
      data-testid="vr-fps"
    >
      <Gauge className="h-3 w-3" /> {fps} fps {ms ? `(${ms}ms)` : ""} {questPerf ? "⚡" : ""}
    </span>
  );
}

/** Hands the scene camera (the headset pose in XR) to code outside the canvas. */
function CameraRef({ target }: { target: RefObject<THREE.Camera | null> }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => void (target.current = camera), [camera, target]);
  return null;
}

const alwaysAffected = () => true;
const noRegister = () => undefined;

const SIM_KEY = "twin-vr-simulate";
const isLocalhost = () => typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
/**
 * Development only (localhost): desktop Chrome reports WebXR but has no headset, so the Quest
 * emulator stands aside. With "Simulate Quest headset" on, that empty runtime is hidden for this
 * tab so the emulator can install. Never active on a real deployment.
 */
/** Simulator only: the emulated head's starting pitch (radians, up is positive). Recordings can override it per page load. */
function simPitch(): number {
  try {
    const v = Number(sessionStorage.getItem("twin-vr-sim-pitch"));
    if (sessionStorage.getItem("twin-vr-sim-pitch") !== null && Number.isFinite(v)) return Math.max(-1, Math.min(1, v));
  } catch {}
  return -0.08;
}

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
 * Prepares the operator for a live VR demonstration: exposes the direct deep-link (/twin?view=vr),
 * demo recording overlay toggle (Shift + C), Quest performance mode status, and voice commands cheat sheet.
 */
function PrepareVRDemoDialog({
  open,
  onOpenChange,
  seated,
  onToggleSeated,
  questPerf,
  onTogglePerf,
  recordingOn,
  onToggleRecording,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seated: boolean;
  onToggleSeated: () => void;
  questPerf: boolean;
  onTogglePerf: () => void;
  recordingOn: boolean;
  onToggleRecording: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const vrUrl = typeof window !== "undefined" ? `${window.location.origin}/twin?view=vr` : "/twin?view=vr";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(vrUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard write blocked */
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Prepare Meta Quest VR & MR Demo"
      description="Direct deep-link to VR, activate hackathon recording badges with live captions, and practice hands-free voice commands."
      footer={
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <div className="space-y-3.5 text-[12.5px]">
        <div className="rounded-xl border border-line bg-surface-2/60 p-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-ink">VR Direct Deep Link</span>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink shadow-sm hover:bg-surface-2"
              data-testid="copy-vr-link"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-success-ink" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
          <p className="mt-1 font-mono text-[11.5px] text-muted break-all select-all">{vrUrl}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Open this URL directly in Meta Quest Browser to enter the VR spatial twin without navigating menus.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-line bg-surface-2/60 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">Recording Overlay</span>
              <button
                onClick={onToggleRecording}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11.5px] font-medium transition-colors",
                  recordingOn
                    ? "border-critical bg-critical text-white font-semibold"
                    : "border-line bg-surface text-ink hover:bg-surface-2",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", recordingOn ? "bg-white animate-pulse" : "bg-muted")} />
                {recordingOn ? "Active" : "Off"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              <b>Shift + C</b>: displays EXISTING vs NEW badges and broadcast-quality voice captions.
            </p>
          </div>

          <div className="rounded-xl border border-line bg-surface-2/60 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">Quest 72Hz Perf Mode</span>
              <button
                onClick={onTogglePerf}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] font-medium transition-colors",
                  questPerf ? "border-amber-500/60 bg-amber-500/10 text-amber-300 font-semibold" : "border-line bg-surface text-muted",
                )}
              >
                <Zap className="h-3 w-3" /> {questPerf ? "72fps On" : "Quality"}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Fixed DPR 1.0 and foveation 1.0 lock smooth frame pacing on Meta Quest 3.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface-2/60 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-medium text-ink">Spatial Ergonomics & Controls</span>
            <button
              onClick={onToggleSeated}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                seated ? "border-purple-500/60 bg-purple-500/15 text-purple-300" : "border-line bg-surface text-muted",
              )}
            >
              <Armchair className="h-3 w-3" /> {seated ? "Seated Desk" : "Standing"}
            </button>
          </div>
          <ul className="space-y-1 text-[11.5px] leading-relaxed text-muted">
            <li>• <b>Push-to-talk (V)</b>: Hold <kbd className="rounded border border-line px-1 py-0.5 font-mono text-[10.5px] text-ink">V</kbd> or squeeze <b>left controller grip</b> inside XR.</li>
            <li>• <b>Palm-up menu</b>: Turn your left or right wrist toward your face to reveal fingertip poke buttons.</li>
            <li>• <b>Tabletop MR</b>: Enter passthrough and pinch any real desk or table to place the miniature factory.</li>
            <li>• <b>Locomotion</b>: Left stick to walk, right stick to snap-turn 45°, push stick forward to teleport.</li>
          </ul>
        </div>

        <div className="rounded-xl border border-line bg-surface-2/60 p-3">
          <p className="font-semibold text-ink mb-1">Key Voice Commands</p>
          <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px] text-ink-2">
            <div>• &ldquo;table view&rdquo; / &ldquo;full scale&rdquo;</div>
            <div>• &ldquo;recenter&rdquo; / &ldquo;seated mode&rdquo;</div>
            <div>• &ldquo;where is the bottleneck&rdquo;</div>
            <div>• &ldquo;what if A-ROB-03 runs at 80%&rdquo;</div>
            <div>• &ldquo;show vibration heatmap&rdquo;</div>
            <div>• &ldquo;replay the last 6 hours&rdquo;</div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The plant in VR (and passthrough AR) for Meta Quest Browser and other WebXR headsets. You stand
 * at the front of the plant floor; point at a machine with a hand (pinch) or controller (trigger)
 * to select it, and its live signals appear on a board above it. Machines with alarms always show
 * a board. On localhost without a headset, a Meta Quest 3 is emulated for development.
 */
/** At most this many website windows at once: each runs a live copy of the site. */
const MAX_SITES = 3;
/** With several windows open they are drawn a little smaller, so they fit side by side. */
const MULTI_SITE_SCALE = 0.78;
type SitePose = { pos: [number, number, number]; yaw: number };
/** A website window: its page and where you carried it (null: its slot in front of you). */
type SiteWin = { id: number; path: string; pose: SitePose | null };

/** One website window with its nav bar above it, carried by the bar under it. */
function SiteWindow({
  path,
  pose,
  scale,
  focused,
  navBar,
  onFocus,
  onPath,
  onPose,
  onClose,
  onOpenOnScreen,
  onNewWindow,
  onArrange,
}: {
  path: string;
  pose: SitePose;
  scale: number;
  focused: boolean;
  navBar: boolean;
  onFocus: () => void;
  onPath: (p: string) => void;
  onPose: (pose: SitePose) => void;
  onClose: () => void;
  onOpenOnScreen: (p: string) => void;
  onNewWindow?: () => void;
  onArrange?: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const move = (center: THREE.Vector3, eye: THREE.Vector3, done: boolean) => {
    const g = ref.current;
    if (!g?.parent) return;
    onFocus();
    const local = g.parent.worldToLocal(center.clone());
    const e = g.parent.worldToLocal(eye.clone());
    // Keep it off the floor and within reach of your eyes; turn it to face you.
    local.y = Math.max(0.5, Math.min(e.y + 1.2, local.y));
    const yaw = Math.atan2(e.x - local.x, e.z - local.z);
    g.position.copy(local);
    g.rotation.set(0, yaw, 0);
    if (done) onPose({ pos: local.toArray() as [number, number, number], yaw });
  };
  return (
    <group ref={ref} position={pose.pos} rotation-y={pose.yaw} scale={scale}>
      {navBar && (
        <VRNavBar
          current={path}
          onOpen={(href) => {
            onFocus();
            if (href) onPath(href);
          }}
          position={[0, 0.6, 0.03]}
          rotationX={-0.15}
        />
      )}
      <VRBrowser
        path={path}
        onPath={onPath}
        onClose={onClose}
        onOpenOnScreen={onOpenOnScreen}
        position={[0, 0, 0]}
        onMove={move}
        focused={focused}
        onFocus={onFocus}
        onNewWindow={onNewWindow}
        onArrange={onArrange}
        // The window you are using stays live every 2.5 s; the others every 5 s.
        refreshMs={focused || !onArrange ? 2500 : 5000}
      />
    </group>
  );
}

export function TwinVR({ state }: { state: FactoryState }) {
  const pal = usePalette();
  // On localhost without WebXR, emulate a Meta Quest 3 (stereo, no synthetic room) for development.
  const [simulating] = useState(() => simulationOn());
  const [inXR, setInXR] = useState(false);
  const [xrMode, setXrMode] = useState<XRSessionMode | null>(null);
  /** Tabletop: the plant as a miniature on a real surface (passthrough) or in front of you (VR). */
  const [tableVR, setTableVR] = useState(false);
  const [table, setTable] = useState<{ at: THREE.Vector3; yaw: number } | null>(null);
  const [rigOpen, setRigOpen] = useState(false);
  const [seated, setSeated] = useState(false);
  const [questPerf, setQuestPerf] = useState(true);
  const [prepareOpen, setPrepareOpen] = useState(false);
  const recordingOn = useRecording((s) => s.on);
  const recordingToggle = useRecording((s) => s.toggle);
  const tableRef = useRef<(on: boolean) => void>(() => undefined);
  const camRef = useRef<THREE.Camera | null>(null);
  const store = useMemo(() => createXRStore({
        emulate: {
          type: "metaQuest3",
          // Development only: a virtual office stands in for your room in passthrough (tabletop placement).
          syntheticEnvironment: "office_small",
          // One full-size view on screen (a headset renders both eyes itself).
          stereoEnabled: false,
          headset: { position: [0, 1.7, 0], rotation: [simPitch(), 0, 0] },
          controller: { left: { position: [-0.32, -0.42, -0.45] }, right: { position: [0.32, -0.42, -0.45] } },
        },
        controller: { teleportPointer: true },
        // Quest-style see-through hands with a light rim, with the default pointers.
        hand: QuestHand,
        offerSession: false,
        // Quest performance: full foveation, and a steady 72 or 90 Hz rather than chasing 120.
        foveation: 1,
        frameRate: (rates) => ([90, 72].find((r) => Array.from(rates).includes(r)) ?? false),
      }), []);
  const [support, setSupport] = useState<{ vr: boolean; ar: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [jump, setJump] = useState<Jump>(null);
  const [heat, setHeat] = useState<HeatMetric | null>(null);
  const [flowOn, setFlowOn] = useState(true);
  const [replay, setReplay] = useState<{ hour: number; playing: boolean } | null>(null);
  const [whatIf, setWhatIf] = useState<QuickWhatIf | null>(null);
  /** A selected machine shows one "Controls" button; its speed / trip / what-if panel opens on demand. */
  const [controlsOpen, setControlsOpen] = useState(false);
  useEffect(() => setControlsOpen(false), [selected]);
  /**
   * The website windows in the headset (up to three, e.g. Visual Quality on the left and Fleet
   * Traffic on the right). `site` is the page of the one you used last: the nav bar, voice and
   * Details act on it.
   */
  const router = useRouter();
  const [wins, setWins] = useState<SiteWin[]>([]);
  const winsRef = useRef(wins);
  winsRef.current = wins;
  const [focusId, setFocusId] = useState<number | null>(null);
  const nextWin = useRef(1);
  const focusedWin = wins.find((w) => w.id === focusId) ?? wins[wins.length - 1] ?? null;
  const site = focusedWin?.path ?? null;
  const lastSite = useRef("/dashboard");
  const setWinPath = (id: number, p: string) => setWins((ws) => ws.map((w) => (w.id === id && w.path !== p ? { ...w, path: p } : w)));
  const addWin = (p: string) => {
    if (winsRef.current.length >= MAX_SITES) return false;
    const id = nextWin.current++;
    winsRef.current = [...winsRef.current, { id, path: p, pose: null }];
    setWins(winsRef.current);
    setFocusId(id);
    return true;
  };
  /** Shows a page in the window you used last (opening one if none is open); null closes them all. */
  const setSite = (p: string | null) => {
    if (p === null) return void setWins([]);
    const ws = winsRef.current;
    const f = ws.find((w) => w.id === focusId) ?? ws[ws.length - 1];
    if (f) setWinPath(f.id, p);
    else addWin(p);
  };
  const closeWin = (id: number) => setWins((ws) => ws.filter((w) => w.id !== id));
  /** Puts every window back in its slot: one in front of you, several side by side. */
  const arrangeSites = () => {
    setWins((ws) => ws.map((w) => (w.pose ? { ...w, pose: null } : w)));
    return winsRef.current.length;
  };
  const siteHome = (): [number, number, number] => (tableMode ? [0.35, seated ? 1.35 : 1.72, -1.4] : [0, seated ? 1.32 : 1.72, -1.25]);
  /** Window i of n: in front of you, or on an arc around you, each turned to face you. */
  const slotPose = (i: number, n: number): SitePose => {
    const h = siteHome();
    if (n <= 1) return { pos: h, yaw: 0 };
    // Centred straight ahead (the single window sits a little right in table view, clear of the controls).
    const r = -h[2] + 0.3;
    const mid = 0;
    const step = 2 * Math.asin(Math.min(0.95, ((VR_WINDOW_WIDTH * MULTI_SITE_SCALE) / 2 + 0.06) / r));
    const a = mid + (i - (n - 1) / 2) * step;
    return { pos: [r * Math.sin(a), h[1], -r * Math.cos(a)], yaw: -a };
  };
  const openSite = (href: string | null, open = true, inNewWindow = false) => {
    if (!open) return void setSite(null);
    const p = href ?? lastSite.current;
    lastSite.current = p;
    setFindOpen(false);
    if (inNewWindow && winsRef.current.length) return addWin(p);
    setSite(p);
    return true;
  };
  /** The selected machine's panel (the one the 3D view shows beside a clicked machine) in the website window. */
  const assetPath = (id: string, tab?: string) => `/assets/${encodeURIComponent(id)}${tab && tab !== "overview" ? `?tab=${tab}` : ""}`;
  const openDetails = (tab?: string) => {
    if (!selected) return false;
    // Reuse the window already showing a machine; otherwise the one you used last.
    const shown = winsRef.current.find((w) => assetOfPath(w.path));
    if (shown) {
      setWinPath(shown.id, assetPath(selected, tab));
      setFocusId(shown.id);
    } else openSite(assetPath(selected, tab));
    return true;
  };
  const assetOfPath = (p: string | null) => {
    const m = p?.match(/^\/assets\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  // While a machine's panel is open, selecting another machine shows that one's panel.
  useEffect(() => {
    if (!selected) return;
    setWins((ws) => (ws.some((w) => assetOfPath(w.path) && assetOfPath(w.path) !== selected) ? ws.map((w) => (assetOfPath(w.path) && assetOfPath(w.path) !== selected ? { ...w, path: assetPath(selected) } : w)) : ws));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  /** Leaves the headset on the full page in the browser. */
  const openOnScreen = (p: string) => {
    setSite(null);
    void store.getState().session?.end();
    router.push(p);
  };
  const muted = useVoiceSettings((s) => s.muted);
  const searchRef = useRef<HTMLInputElement>(null);
  const originRef = useRef<THREE.Group>(null);
  useEffect(() => {
    setInXR(store.getState().session != null);
    setXrMode(store.getState().mode);
    return store.subscribe((st) => {
      setInXR(st.session != null);
      setXrMode(st.mode);
      if (!st.session) {
        // Each session starts fresh: at the plant front, facing it, with no website window open.
        setTable(null);
        setRigOpen(false);
        setSite(null);
        setSelected(null);
        setWhatIf(null);
        setReplay(null);
        const o = originRef.current;
        if (o) {
          o.position.fromArray(originPosRef.current);
          o.rotation.set(0, 0, 0);
        }
      }
    });
  }, [store]);
  const exitXR = () => void store.getState().session?.end();
  // Simulator only: scripted recordings and tests drive the emulated headset through this.
  useEffect(() => {
    if (simulating) Object.assign(window, { __twinXR: store, __twinOrigin: originRef });
  }, [simulating, store]);
  /** Simulator: the browser goes full screen with the session (as a headset would), and back after it. */
  const fullScreenSim = () => {
    if (simulating && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };
  useEffect(() => {
    if (!inXR && simulating && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, [inXR, simulating]);
  const plantRef = useRef<THREE.Group | null>(null);
  const facility = useMemo(() => ({ id: state.profile.id, name: state.profile.name }), [state.profile.id, state.profile.name]);

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
  const eyeHeight = seated ? 1.2 : 1.6;
  // Stand on the floor in front of the lines, inside the dock apron.
  const front = useMemo(() => new THREE.Vector3(center.x, 0, center.z + span * 0.3), [center, span]);
  const eye = useMemo(() => front.clone().add(new THREE.Vector3(0, eyeHeight, 0)), [front, eyeHeight]);
  const lookAt = useMemo(() => center.clone().add(new THREE.Vector3(0, 0.6, 0)), [center]);
  const originPos = useMemo(() => front.toArray() as [number, number, number], [front]);
  const originPosRef = useRef(originPos);
  originPosRef.current = originPos;
  const walkBounds = useMemo(() => ({ x0: b.x0 - 0.5, x1: b.x1 + 0.5, z0: b.y0 - 0.5, z1: b.y1 + 3 }), [b.x0, b.x1, b.y0, b.y1]);
  const headset = !!support && (support.vr || support.ar);
  const tableMode = (inXR && xrMode === "immersive-ar") || tableVR;
  /** Passthrough, before the plant is on a surface: only the placement hint shows. */
  const placing = tableMode && xrMode === "immersive-ar" && !table;
  /** Tabletop scale: the whole plant fits in about 0.8 m. */
  const tableScale = 0.8 / Math.max(1, span);
  /** In VR the table appears in front of you at desk height; in passthrough you place it on a real surface. */
  const placeVRTable = () => {
    // In front of your head, a little below eye level: comfortable seated or standing.
    const cam = camRef.current;
    if (!cam) {
      setTable({ at: new THREE.Vector3(center.x, seated ? 0.65 : 0.85, center.z), yaw: 0 });
      return;
    }
    const head = cam.getWorldPosition(new THREE.Vector3());
    const fwd = cam.getWorldDirection(new THREE.Vector3()).setY(0);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const dist = seated ? 0.65 : 0.82;
    const yOffset = seated ? 0.35 : 0.45;
    const at = head.clone().addScaledVector(fwd, dist).setY(Math.max(0.3, head.y - yOffset));
    setTable({ at, yaw: Math.atan2(-fwd.x, -fwd.z) });
  };
  const recenter = () => {
    arrangeSites();
    if (tableMode) return xrMode === "immersive-ar" ? setTable(null) : placeVRTable();
    originRef.current?.position.set(front.x, 0, front.z);
    originRef.current?.rotation.set(0, 0, 0);
    if (!inXR) {
      setJump({ eye: front.clone().setY(eyeHeight), target: lookAt, n: Date.now() });
    }
  };
  const toggleTable = () => {
    arrangeSites();
    if (xrMode === "immersive-ar") return setTable(null); // re-place on a surface
    if (tableVR) {
      setTableVR(false);
      setTable(null);
    } else {
      setTableVR(true);
      placeVRTable();
    }
  };

  const index = useMemo(() => findIndex(state, layout, paths), [state, layout, paths]);
  const results = useMemo(() => findEntries(index, query), [index, query]);
  /** Go to a search result: stand at a clear spot a few metres away, facing it; select machines. */
  const goTo = (e: FindEntry) => {
    if (tableMode) {
      // On the table everything is within reach: just select it.
      if (e.assetId) setSelected(e.assetId);
      setQuery("");
      setFindOpen(false);
      return;
    }
    const target = new THREE.Vector3(...P(e.x, e.y, 1.3));
    const sp = standPoint(layout, e.x, e.y, { x0: walkBounds.x0, x1: walkBounds.x1, y0: walkBounds.z0, y1: walkBounds.z1 }, e.assetId);
    const stand = new THREE.Vector3(...P(sp.x, sp.y, 0));
    if (originRef.current && inXR) {
      originRef.current.position.set(stand.x, 0, stand.z);
      // Face the target (the headset's forward is -z of the origin).
      originRef.current.rotation.set(0, Math.atan2(-(target.x - stand.x), -(target.z - stand.z)), 0);
    } else setJump({ eye: stand.clone().setY(eyeHeight), target, n: Date.now() });
    if (e.assetId) setSelected(e.assetId);
    setQuery("");
    setFindOpen(false);
  };
  const runWhatIf = (assetId: string, change: { speedPct?: number; maintainNow?: boolean }) => {
    const r = quickWhatIf(state, assetId, change);
    setWhatIf(r);
    return r;
  };
  const startReplay = (hours: number | null) => {
    if (hours === null) return setReplay(null);
    const from = Math.max(replayStart(state), state.clock.hour - hours);
    setReplay({ hour: from, playing: true });
    if (!heat) setHeat("health");
  };
  const voice = useVrVoice({
    state,
    index,
    selected,
    goTo,
    exitXR,
    inXR,
    overlays: {
      setHeat,
      setFlow: setFlowOn,
      whatIf: runWhatIf,
      replay: startReplay,
      table: (on) => {
        if (on !== tableMode) toggleTable();
      },
      recenter,
      seated: (on) => setSeated(on),
      perf: (on) => setQuestPerf(on),
      page: openSite,
      arrange: arrangeSites,
      details: openDetails,
    },
  });

  useEffect(() => {
    if (typeof window !== "undefined" && isLocalhost()) {
      (window as unknown as Record<string, unknown>).__twinVrRecord = {
        selectAsset: (id: string) => {
          setSelected(id);
          const e = index.find((x) => x.assetId === id);
          if (e) goTo(e);
        },
        openDetails: (tab?: string, assetId?: string) => {
          const id = assetId || selected || "A-ROB-03";
          setSelected(id);
          const p = assetPath(id, tab);
          const shown = winsRef.current.find((w) => assetOfPath(w.path));
          if (shown) {
            setWinPath(shown.id, p);
            setFocusId(shown.id);
          } else addWin(p);
          return true;
        },
        closeSite: () => setSite(null),
        toggleTable: () => toggleTable(),
        isTable: () => tableMode,
        addWindow: (href: string) => addWin(href),
        setWindowPath: (id: number, href: string) => setWinPath(id, href),
        arrangeSites: () => arrangeSites(),
        getWins: () => winsRef.current,
        focusWindow: (id: number) => setFocusId(id),
      };
    }
  }, [index, selected, inXR, tableMode, wins]);
  // The copilot's show_in_3d (spoken or typed) moves you here instead of switching to the 3D tab.
  const request = useView3d((s) => s.request);
  const consume = useView3d((s) => s.consume);
  useEffect(() => {
    if (!request) return;
    consume(request.nonce);
    if (request.kind === "focus") {
      const id = request.id.replace(/^(cam|amr|inv|ord):/, "");
      const hit = index.find((e) => e.assetId === id || e.key.endsWith(`:${id}`));
      if (hit) goTo(hit);
    }
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  // Simulator only: Shift + H hides its control panels for clean recordings (voice and keys still work).
  useEffect(() => {
    if (!simulating) return;
    let hidden = false;
    const k = (ev: KeyboardEvent) => {
      if (!ev.shiftKey || ev.code !== "KeyH") return;
      hidden = !hidden;
      document.querySelectorAll<HTMLElement>("div").forEach((el) => {
        if (el.shadowRoot && el.style.position === "fixed" && el.style.width === "100vw") el.style.visibility = hidden ? "hidden" : "";
      });
      document.documentElement.toggleAttribute("data-sim-clean", hidden);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [simulating]);
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

  // Replay plays forward at about 40 plant minutes per second, then returns to live.
  useEffect(() => {
    if (!replay?.playing) return;
    const t = setInterval(() => {
      setReplay((r) => {
        if (!r || !r.playing) return r;
        const next = r.hour + 1 / 6; // 10 plant minutes per 250 ms
        return next >= state.clock.hour ? null : { ...r, hour: next };
      });
    }, 250);
    return () => clearInterval(t);
  }, [replay?.playing, state.clock.hour]);
  const frame = useMemo(() => (replay ? replayFrame(state, replay.hour) : null), [state, replay]);
  const cells = useMemo(() => (heat ? heatCells(state, layout, heat, frame) : []), [state, layout, heat, frame]);
  const soundAlarms = useMemo(() => activeAlarms(state).filter((a) => !a.acknowledged).map((a) => ({ id: a.id, assetId: a.assetId, severity: a.severity })), [state]);
  const envBoards = useMemo(() => {
    if (heat !== "noise" || frame) return [];
    return zoneEnvironment(state).flatMap((z) => {
      const ms = layout.machines.filter((m) => m.lineId === z.lineId);
      if (!ms.length) return [];
      const mid = ms[Math.floor(ms.length / 2)];
      const name = state.lines.find((l) => l.id === z.lineId)?.name ?? z.lineId;
      return [{ id: z.lineId, position: P(mid.x, mid.y - 2.2, 3.4), lines: [{ text: `${name} · zone`, tone: "title" as const }, { text: `${z.noiseDb} dB · ${z.temperatureC} °C · ${z.humidityPct}% RH`, tone: z.noiseDb >= 85 ? ("warn" as const) : ("muted" as const) }, { text: `PM2.5 ${z.pm25} µg/m³${z.noiseDb >= 85 ? " · hearing protection" : ""}`, tone: "muted" as const }] }];
    });
  }, [heat, frame, state, layout]);
  const whatIfBoard = useMemo(() => {
    if (!whatIf || whatIf.assetId === selected) return null;
    const pm = layout.machines.find((m) => m.m.id === whatIf.assetId);
    if (!pm) return null;
    const w = whatIf;
    const n = (v: number) => v.toLocaleString("en-US");
    const d = w.plan.output - w.asIs.output;
    const trip = (h: number | null) => (h === null ? "none" : `h+${Math.round(h)}`);
    const lines: BoardLine[] = [
      { text: `What if ${w.change}?`, tone: "title" },
      { text: `Output ${w.horizonHours} h: ${n(w.asIs.output)} → ${n(w.plan.output)} (${d >= 0 ? "+" : "−"}${n(Math.abs(d))})`, tone: d >= 0 ? "ok" : "warn" },
      { text: `Trip: ${trip(w.asIs.failureHour)} → ${trip(w.plan.failureHour)}`, tone: w.plan.failureHour === null ? "ok" : w.asIs.failureHour !== null && w.plan.failureHour > w.asIs.failureHour ? "ok" : "bad" },
      { text: `Late units: ${n(w.asIs.lateUnits)} → ${n(w.plan.lateUnits)}`, tone: w.plan.lateUnits <= w.asIs.lateUnits ? "ok" : "bad" },
      { text: `Operating cost: $${n(w.asIs.operatingCost)} → $${n(w.plan.operatingCost)}`, tone: "muted" },
      { text: w.better ? "Better than continuing as is" : "Worse than continuing as is", tone: w.better ? "ok" : "bad" },
      { text: "Simulated estimate · nothing changed", tone: "muted" },
    ];
    return { lines, accent: w.better ? "#22c55e" : "#ef4444", position: P(pm.x, pm.y, machineParts(pm.m.kind).height + 3.3) };
  }, [whatIf, layout, selected]);
  useEffect(() => {
    if (!whatIf) return;
    const t = setTimeout(() => setWhatIf(null), 60_000);
    return () => clearTimeout(t);
  }, [whatIf]);

  const boards = useMemo(() => {
    const alarmed = new Map(activeAlarms(state).map((a) => [a.assetId, a]));
    const states = machineStates(state);
    const past = frame ? replayStatus(state, frame) : null;
    const ids = new Set<string>([...alarmed.keys(), ...(selected ? [selected] : [])]);
    return [...ids].flatMap((id) => {
      const pm = layout.machines.find((m) => m.m.id === id);
      const a = state.assets.find((x) => x.id === id);
      if (!pm || !a) return [];
      const alarm = alarmed.get(id);
      const ms = states[id];
      const toneOf = (st: string): BoardLine["tone"] => (st === "trip" ? "bad" : st === "alarm" ? "warn" : "muted");
      let lines: BoardLine[];
      let sparks: Spark[] = [];
      if (frame) {
        // Replay: what this machine looked like then.
        const r = frame.readings[id];
        const ago = state.clock.hour - frame.hour;
        lines = [
          { text: `${a.id} · ${a.name}`, tone: "title" },
          { text: `Replay · ${ago < 1 ? `${Math.round(ago * 60)} min` : `${ago.toFixed(1)} h`} ago`, tone: "info" },
          { text: `Status then: ${past?.[id] ?? "unknown"}`, tone: past?.[id] === "critical" || past?.[id] === "offline" ? "bad" : past?.[id] === "warning" ? "warn" : "ok" },
          ...(r ? [{ text: `Vibration ${r.vibration.toFixed(2)} mm/s · ${r.temperature.toFixed(1)} °C`, tone: "muted" as const }, { text: `${r.powerKw.toFixed(1)} kW · ${Math.round(r.throughput)} u/h`, tone: "muted" as const }] : []),
        ];
      } else if (id === selected) {
        const sig = assetSignals(state, a, { full: false });
        const v = (n: string) => sig.find((x) => x.name === n);
        const rul = remainingLife(state, a);
        const rejects = sig.find((x) => x.name === "Rejects caused (8 h)")?.value as number | undefined;
        // Essentials only; electrical and process values live on the Assets page (website window).
        const stateLine = ms ? (ms.bottleneck && ms.state === "running" ? "Bottleneck · sets the line's pace" : `${ms.state[0].toUpperCase()}${ms.state.slice(1)} · ${ms.reason}`) : null;
        const wi = whatIf && whatIf.assetId === id ? whatIf : null;
        const trip = (h: number | null) => (h === null ? "none" : `h+${Math.round(h)}`);
        lines = [
          { text: `${a.id} · ${a.name}`, tone: "title" },
          ...(stateLine ? [{ text: stateLine, tone: ms!.state === "fault" ? ("bad" as const) : ms!.state === "starved" || ms!.state === "blocked" ? ("warn" as const) : ms!.bottleneck ? ("info" as const) : ("ok" as const) }] : []),
          { text: `Life: ${rul.summary}`, tone: rul.tone },
          { text: `Vibration ${a.signal.vibration.toFixed(2)} mm/s · ${a.signal.temperature.toFixed(1)} °C`, tone: toneOf(v("Vibration")?.state === "ok" ? (v("Temperature")?.state ?? "ok") : (v("Vibration")?.state ?? "ok")) },
          { text: `Health ${a.healthScore.toFixed(0)}/100${rejects ? ` · ${rejects} rejects (8 h)` : ""}`, tone: a.healthScore < 45 ? "bad" : a.healthScore < 75 ? "warn" : "muted" },
          ...(wi
            ? [
                { text: `What if ${wi.change}`, tone: "title" as const },
                { text: `Trip ${trip(wi.asIs.failureHour)} → ${trip(wi.plan.failureHour)} · late ${wi.asIs.lateUnits.toLocaleString("en-US")} → ${wi.plan.lateUnits.toLocaleString("en-US")}`, tone: wi.better ? ("ok" as const) : ("bad" as const) },
              ]
            : []),
        ];
        const hist = (state.telemetry[a.id] ?? []).slice(-36);
        sparks = [
          { label: "Vibration 6 h", values: hist.map((r) => r.vibration), color: "#60a5fa", limit: a.thresholds.vibrationAlarm },
          { label: "Temp 6 h", values: hist.map((r) => r.temperature), color: "#f97316", limit: a.thresholds.temperatureAlarm },
        ];
      } else {
        const rul = remainingLife(state, a);
        lines = [
          { text: `${a.id} · ${a.name}`, tone: "title" },
          ...(alarm ? [{ text: `${alarm.acknowledged ? "ACK · " : ""}${alarm.title}`, tone: alarm.acknowledged ? ("muted" as const) : alarm.severity === "critical" ? ("bad" as const) : ("warn" as const) }] : []),
          { text: rul.hoursToTrip !== null || a.mode === "down" ? rul.summary : `health ${a.healthScore.toFixed(0)} · ${a.signal.vibration.toFixed(1)} mm/s`, tone: rul.tone === "ok" ? "muted" : rul.tone },
        ];
      }
      return [{ id, lines, sparks, accent: frame ? "#38bdf8" : alarm ? (alarm.severity === "critical" ? "#ef4444" : "#f59e0b") : "#4c8dff", position: P(pm.x, pm.y, machineParts(pm.m.kind).height + 0.9) }];
    });
  }, [state, layout, selected, frame, whatIf]);
  const boarded = useMemo(() => new Set(boards.map((b) => b.id)), [boards]);

  const selectedPos = useMemo<[number, number, number] | null>(() => {
    const pm = selected ? layout.machines.find((m) => m.m.id === selected) : null;
    // Beside the machine, at chest height, on the side facing the front of the plant.
    return pm ? (P(pm.x, pm.y + 1.6, 1.0) as [number, number, number]) : null;
  }, [selected, layout]);

  tableRef.current = (on: boolean) => {
    if (on !== tableMode || xrMode === "immersive-ar") toggleTable();
  };
  const handItems: HandMenuItem[] = [
    { key: "table", label: xrMode === "immersive-ar" ? "Move table" : tableVR ? "Full size" : "Table", color: "#14b8a6", active: tableMode, onPress: toggleTable },
    { key: "recenter", label: "Recenter", color: "#64748b", onPress: recenter },
    { key: "seated", label: seated ? "Seated" : "Standing", color: "#8b5cf6", active: seated, onPress: () => setSeated(!seated) },
    { key: "perf", label: questPerf ? "Perf: 72fps" : "Quality", color: "#eab308", active: questPerf, onPress: () => setQuestPerf(!questPerf) },
    { key: "find", label: findOpen ? "Hide find" : "Find", color: "#4c8dff", active: findOpen, onPress: () => setFindOpen(!findOpen) },
    { key: "site", label: wins.length > 1 ? "Hide sites" : site ? "Hide site" : "Website", color: "#0ea5e9", active: !!site, onPress: () => openSite(null, !site) },
    { key: "heat", label: heat ? HEAT_LABEL[heat] : "Heat", color: "#f97316", active: !!heat, onPress: () => setHeat(nextHeat(heat)) },
    { key: "flow", label: flowOn ? "Flow on" : "Flow off", color: "#22c55e", active: flowOn, onPress: () => setFlowOn(!flowOn) },
    { key: "replay", label: replay ? "Live" : "Replay 6 h", color: "#38bdf8", active: !!replay, onPress: () => startReplay(replay ? null : 6) },
  ];

  if (!pal) return <div className="h-full w-full" />;
  return (
    <div className="relative h-full w-full" data-testid="twin-vr">
      <Canvas dpr={questPerf ? [1, 1] : [1, 1.5]} camera={{ fov: 70, near: 0.01, far: 400, position: eye.toArray() }} onCreated={({ gl }) => void (gl.toneMapping = THREE.ACESFilmicToneMapping)} aria-label="The plant in VR">
        <XR store={store}>
          <SimulatorMouse enabled={simulating && inXR} />
          <XROrigin ref={originRef} position={originPos}>
            {/* Exit VR: always within reach, at waist height in front of you; moves and turns with you. */}
            {/* Waist-height controls within arm's reach while seated. In table view they swing to your left so the table stays clear. */}
            {/* Full controls at waist height within reach. In table view they fold into a small group at your
                left (Controls opens them), and while you place the plant only the placement hint shows. */}
            {inXR && !placing && (!tableMode || rigOpen) && (
              <group position={[0, seated ? -0.16 : 0, seated ? 0.08 : 0]} rotation-x={seated ? 0.22 : 0}>
                <Button3D label="Exit VR" color="#64748b" position={[0.3, 0.88, -0.7]} width={0.5} onPress={exitXR} />
                <Button3D label={xrMode === "immersive-ar" ? "Move table" : tableVR ? "Full size" : "Table view"} color="#14b8a6" width={0.5} position={[-0.85, 0.88, -0.7]} onPress={toggleTable} />
                <Button3D label="Recenter" color="#64748b" width={0.5} position={[0.85, 0.88, -0.7]} onPress={recenter} />
                <Button3D label={findOpen ? "Hide Find" : "Find…"} color="#4c8dff" position={[-0.3, 0.88, -0.7]} width={0.5} onPress={() => setFindOpen(!findOpen)} />
                <VoiceRig3D voice={voice} compact={!!site} />
                <Button3D label={seated ? "Seated: on" : "Seated: off"} color="#8b5cf6" width={0.5} active={seated} position={[-0.85, 0.52, -0.7]} onPress={() => setSeated(!seated)} />
                <Button3D label={questPerf ? "Perf: 72fps" : "Quality"} color="#eab308" width={0.5} active={questPerf} position={[0.85, 0.52, -0.7]} onPress={() => setQuestPerf(!questPerf)} />
                <Button3D label={heat ? `Heat: ${HEAT_LABEL[heat]}` : "Heat: off"} color="#f97316" width={0.52} active={!!heat} position={[-0.35, 0.52, -0.7]} onPress={() => setHeat(nextHeat(heat))} />
                <Button3D label={flowOn ? "Flow: on" : "Flow: off"} color="#22c55e" width={0.4} active={flowOn} position={[0.12, 0.52, -0.7]} onPress={() => setFlowOn(!flowOn)} />
                <Button3D label={replay ? "Live" : "Replay 6 h"} color="#38bdf8" width={0.46} active={!!replay} position={[0.55, 0.52, -0.7]} onPress={() => startReplay(replay ? null : 6)} />
                {tableMode && <Button3D label="Hide controls" color="#64748b" width={0.46} position={[0, 1.04, -0.7]} onPress={() => setRigOpen(false)} />}
              </group>
            )}
            {inXR && !placing && tableMode && !rigOpen && (
              // Table view: a small column low at your left, clear of the table, with Twin's answers above it.
              <group position={[-0.35, seated ? -0.16 : 0, 0]} rotation-y={0.75}>
                {/* Tilted back to face your eyes as you glance down at it. */}
                <group position={[0, 0.8, -0.7]} rotation-x={-0.6}>
                  <Button3D label="Controls" color="#4c8dff" width={0.36} position={[0, 0.18, 0]} onPress={() => setRigOpen(true)} />
                  <Button3D label={xrMode === "immersive-ar" ? "Move table" : "Full size"} color="#14b8a6" width={0.36} position={[0, 0.06, 0]} onPress={toggleTable} />
                  <Button3D label="Exit VR" color="#64748b" width={0.36} position={[0, -0.06, 0]} onPress={exitXR} />
                  <VoiceRig3D voice={voice} compact minimal talkAt={[0, -0.18, 0]} boardAt={[0, 0.44, 0]} boardYaw={0} />
                </group>
              </group>
            )}
            {placing && (
              <group position={[0, 0, 0]}>
                <Board lines={[{ text: "Look down at a table or desk", tone: "title" }, { text: "The plant lands on the blue ring. No table? Place it in front.", tone: "muted" }]} accent="#4c8dff" position={[0, 1.42, -1.0]} width={0.56} />
                <Button3D label="Place in front" color="#4c8dff" width={0.3} position={[-0.16, 1.27, -1.0]} onPress={placeVRTable} />
                <Button3D label="Exit VR" color="#64748b" width={0.3} position={[0.16, 1.27, -1.0]} onPress={exitXR} />
              </group>
            )}
            {inXR && findOpen && <FindMenu index={index} onPick={goTo} onClose={() => setFindOpen(false)} />}
            {/* The website's nav bar: low in your view like the headset's own system bar (above the window while a page is open). */}
            {inXR && !placing && !site && (
              <VRNavBar
                current={site}
                onOpen={(href) => openSite(href)}
                // Table view: hung above and behind the table, so it never lies across the plant you look down at.
                position={tableMode ? [0, 1.5, -1.35] : [0, 1.1, -0.85]}
                rotationX={tableMode ? 0.08 : 0.55}
                aboveEyes={tableMode ? -0.18 : -0.5}
                legend={heat ? `${HEAT_LABEL[heat]} · ${HEAT_LEGEND[heat]}` : undefined}
              />
            )}
            {/* The website windows, each with its nav bar above it: one group, carried by the bar under the window. */}
            {inXR &&
              wins.map((w, i) => (
                <SiteWindow
                  key={w.id}
                  path={w.path}
                  pose={w.pose ?? slotPose(i, wins.length)}
                  scale={wins.length > 1 ? MULTI_SITE_SCALE : 1}
                  focused={wins.length > 1 && w.id === focusedWin?.id}
                  navBar={!placing}
                  onFocus={() => w.id !== focusId && setFocusId(w.id)}
                  onPath={(p) => {
                    lastSite.current = p;
                    setWinPath(w.id, p);
                    // A machine's page (e.g. picked on its Links tab) selects that machine in the plant.
                    const id = assetOfPath(p);
                    if (id && id !== selected && state.assets.some((a) => a.id === id)) setSelected(id);
                  }}
                  onPose={(pose) => setWins((ws) => ws.map((x) => (x.id === w.id ? { ...x, pose } : x)))}
                  onClose={() => closeWin(w.id)}
                  onOpenOnScreen={openOnScreen}
                  onNewWindow={wins.length < MAX_SITES ? () => addWin(w.path) : undefined}
                  onArrange={wins.length > 1 ? arrangeSites : undefined}
                />
              ))}
            {inXR && replay && frame && <Board lines={replayLines(state, frame.hour)} accent="#38bdf8" position={[0.8, 1.5, -1.2]} width={0.7} />}
            {inXR && recordingOn && (
              <group position={[0, 1.76, -1.2]}>
                <Board
                  lines={[
                    { text: "New in the hackathon · Twin on Meta Quest", tone: "title" },
                    ...(voice.heard ? [{ text: `“${voice.heard}”`, tone: "info" as const }] : []),
                    ...(voice.reply ? [{ text: voice.reply.slice(0, 140), tone: "muted" as const }] : []),
                  ]}
                  accent="#ef4444"
                  position={[0, 0, 0]}
                  width={0.88}
                />
              </group>
            )}
            {/* Palm menu: inside the origin, so the hand's pose (relative to it) puts the menu on your hand
                wherever you have walked or teleported. */}
            {inXR && <HandMenu items={handItems} label={tableMode ? "Tabletop" : heat ? HEAT_LABEL[heat] : "Twin"} />}
          </XROrigin>
          {!tableMode && <Locomotion origin={originRef} />}
          {!tableMode && simulating && inXR && <SimKeyWalk origin={originRef} />}
          {/* Teleport: push a thumbstick forward (or pinch-and-hold with hands), aim at the floor, release. */}
          {!tableMode && (
            <TeleportTarget onTeleport={(p) => originRef.current?.position.set(p.x, 0, p.z)}>
              <mesh rotation-x={-Math.PI / 2} position={[center.x, 0.002, center.z]}>
                <planeGeometry args={[(b.x1 - b.x0) + 2, (b.y1 - b.y0) + 6]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
            </TeleportTarget>
          )}
          <WalkControls eye={eye} target={lookAt} bounds={walkBounds} jump={jump} />
          <GripTalk voice={voice} />
          <FpsProbe />
          {/* In VR the plant has a sky; in passthrough the background stays clear so your room shows. */}
          {inXR && xrMode === "immersive-vr" && <color attach="background" args={[pal.theme === "dark" ? "#0b1220" : "#dfe6ee"]} />}
          <CameraRef target={camRef} />
          {/* Passthrough: find a real table and pinch to put the plant on it. */}
          {tableMode && !table && xrMode === "immersive-ar" && <TablePlacer onPlace={(at, yaw) => setTable({ at, yaw })} />}
          {/* Virtual command desk slab underneath the miniature factory when in table mode (non-passthrough) */}
          {tableMode && table && xrMode !== "immersive-ar" && (
            <group position={table.at} rotation-y={table.yaw}>
              <mesh position={[0, -0.015, 0]} receiveShadow>
                <boxGeometry args={[Math.max(1.1, span * tableScale + 0.15), 0.03, Math.max(0.7, span * tableScale + 0.15)]} />
                <meshStandardMaterial color="#0b1120" roughness={0.35} metalness={0.8} />
              </mesh>
              <mesh position={[0, 0.001, 0]} rotation-x={-Math.PI / 2}>
                <planeGeometry args={[Math.max(1.08, span * tableScale + 0.13), Math.max(0.68, span * tableScale + 0.13)]} />
                <meshBasicMaterial color="#38bdf8" transparent opacity={0.12} wireframe />
              </mesh>
            </group>
          )}
          {(!tableMode || table) && (
            <group position={tableMode && table ? table.at : undefined} rotation-y={tableMode && table ? table.yaw : 0} scale={tableMode ? tableScale : 1}>
              <group position={tableMode ? [-center.x, 0, -center.z] : [0, 0, 0]}>
                <Scene
                  pal={pal}
                  quality="standard"
                  layout={layout}
                  paths={paths}
                  selectedId={selected}
                  onSelect={(id) => setSelected(id && state.assets.some((a) => a.id === id) ? id : null)}
                  cameras={false}
                  affected={alwaysAffected}
                  highlight={null}
                  registerAmr={noRegister}
                  flows={flows}
                  plantRef={plantRef}
                  facility={facility}
                />
                {boards.map((bd) => {
                  // On the table, boards keep a readable real-world size (≈ 35 cm) and float clear of the model.
                  const w = tableMode ? 0.36 / tableScale : bd.sparks.length ? 2.6 : 2.2;
                  const pos: [number, number, number] = tableMode ? [bd.position[0], bd.position[1] + 0.2 / tableScale, bd.position[2]] : bd.position;
                  return <Board key={bd.id} lines={bd.lines} sparks={bd.sparks} accent={bd.accent} position={pos} width={w} />;
                })}
                {selectedPos && selected && !replay && (
                  <group position={tableMode ? [selectedPos[0], 0.05 / tableScale, selectedPos[2] + 0.12 / tableScale] : selectedPos} scale={tableMode ? 0.22 / tableScale : 1}>
                    {controlsOpen ? (
                      <>
                        <ControlPanel state={state} assetId={selected} position={[0, 0, 0]} onWhatIf={(c) => runWhatIf(selected, c)} />
                        <Button3D label="Hide controls" color="#64748b" width={0.5} position={[-0.27, -0.62, 0]} onPress={() => setControlsOpen(false)} />
                        <Button3D label="Details" color="#0ea5e9" width={0.5} active={wins.some((w) => assetOfPath(w.path) === selected)} position={[0.27, -0.62, 0]} onPress={() => openDetails()} />
                      </>
                    ) : (
                      <>
                        <Button3D label="Controls" color="#4c8dff" width={0.42} position={[-0.23, -0.1, 0]} onPress={() => setControlsOpen(true)} />
                        <Button3D label="Details" color="#0ea5e9" width={0.42} active={wins.some((w) => assetOfPath(w.path) === selected)} position={[0.23, -0.1, 0]} onPress={() => openDetails()} />
                      </>
                    )}
                  </group>
                )}
                {heat && <HeatOverlay cells={cells} layout={layout} ghost={!!replay} floorOnly={boarded} tagScale={tableMode ? 2.5 : 1} />}
                {flowOn && !replay && <FlowOverlay state={state} layout={layout} flows={flows} />}
                <AlarmSounds alarms={soundAlarms} layout={layout} enabled={!muted && !replay} />
                {envBoards.map((eb) => (
                  <Board key={`env-${eb.id}`} lines={eb.lines} accent="#14b8a6" position={eb.position} width={tableMode ? 0.3 / tableScale : 2.1} />
                ))}
                {whatIfBoard && (
                  <Board
                    lines={whatIfBoard.lines}
                    accent={whatIfBoard.accent}
                    position={tableMode ? [whatIfBoard.position[0], whatIfBoard.position[1] + 0.32 / tableScale, whatIfBoard.position[2]] : whatIfBoard.position}
                    width={tableMode ? 0.42 / tableScale : 2.6}
                  />
                )}
              </group>
            </group>
          )}
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
            data-sim-chrome
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
      <div hidden={inXR} className="absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2" data-testid="vr-buttons">
        <button
          onClick={() => (fullScreenSim(), void store.enterVR())}
          disabled={!support?.vr}
          className="flex h-10 items-center gap-2 rounded-xl border border-accent/60 bg-accent px-4 text-[13px] font-medium text-white shadow-lg disabled:opacity-40"
        >
          <Glasses className="h-4 w-4" /> Enter VR
        </button>
        <button
          onClick={() => (fullScreenSim(), void store.enterAR())}
          disabled={!support?.ar}
          className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-medium text-ink shadow-lg disabled:opacity-40"
        >
          <Table2 className="h-4 w-4" /> Tabletop MR (passthrough)
        </button>
        <button
          onClick={toggleTable}
          className={cn(
            "flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-medium shadow-lg transition-colors",
            tableMode ? "border-accent bg-accent/15 text-accent-ink font-semibold" : "border-line bg-surface text-ink hover:bg-surface-2",
          )}
          data-testid="toggle-table-mode"
          title="Toggle Tabletop Miniature View"
        >
          <Table2 className="h-4 w-4" /> Table view {tableMode ? "on" : "off"}
        </button>
        <button
          onClick={() => setPrepareOpen(true)}
          className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3.5 text-[13px] font-medium text-ink shadow-lg hover:bg-surface-2"
          data-testid="prepare-vr-demo-btn"
          title="Open VR Demo Preparation Sheet"
        >
          <Sparkles className="h-4 w-4 text-accent" /> Prepare VR demo
        </button>
        <button
          onClick={recordingToggle}
          className={cn(
            "flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-medium shadow-lg transition-colors",
            recordingOn ? "border-red-500 bg-red-500/15 text-red-400 font-semibold" : "border-line bg-surface text-ink hover:bg-surface-2",
          )}
          data-testid="toggle-recording-btn"
          title="Toggle Hackathon Recording Overlay (Shift + C)"
        >
          <span className={cn("h-2.5 w-2.5 rounded-full", recordingOn ? "bg-red-500 animate-pulse" : "bg-muted")} />
          REC {recordingOn ? "On" : "(Shift+C)"}
        </button>
      </div>
      {!inXR && <VoiceDock voice={voice} />}
      {!inXR && (
        <div className="absolute top-14 right-3 z-10 flex w-[min(310px,calc(100%-24px))] flex-col gap-2" data-testid="vr-overlays">
          <div className="rounded-lg border border-line bg-surface/92 p-2 text-[12px] shadow-[var(--shadow-card)] backdrop-blur">
            <div className="mb-2 flex items-center justify-between border-b border-line pb-1.5">
              <span className="text-[11px] font-semibold text-ink">Spatial Mode</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setSeated(!seated)}
                  className={cn("flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px]", seated ? "border-purple-500/60 bg-purple-500/15 text-purple-300 font-medium" : "border-line text-muted hover:text-ink")}
                  title="Toggle Seated Desk vs Standing Eye Height"
                >
                  <Armchair className="h-3 w-3" /> {seated ? "Seated" : "Standing"}
                </button>
                <button
                  onClick={() => setQuestPerf(!questPerf)}
                  className={cn("flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px]", questPerf ? "border-amber-500/60 bg-amber-500/15 text-amber-300 font-medium" : "border-line text-muted hover:text-ink")}
                  title="Toggle Quest 72Hz Performance Mode"
                >
                  <Zap className="h-3 w-3" /> {questPerf ? "72fps" : "Quality"}
                </button>
                <button
                  onClick={recenter}
                  className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-muted hover:text-ink"
                  title="Recenter camera viewpoint"
                >
                  Recenter
                </button>
              </div>
            </div>
            <p className="mb-1.5 flex items-center gap-1.5 font-medium text-ink">
              <Flame className="h-3.5 w-3.5 text-accent" /> Heatmap
              <FpsChip questPerf={questPerf} />
            </p>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Heatmap metric">
              {[null, ...HEAT_METRICS].map((m) => (
                <button
                  key={m ?? "off"}
                  onClick={() => setHeat(m)}
                  aria-pressed={heat === m}
                  className={`rounded-md border px-2 py-0.5 text-[11.5px] ${heat === m ? "border-accent bg-accent text-white" : "border-line text-ink-2 hover:bg-surface-2"}`}
                >
                  {m ? HEAT_LABEL[m] : "Off"}
                </button>
              ))}
            </div>
            {heat && <p className="mt-1.5 text-[11px] leading-snug text-muted">{HEAT_LEGEND[heat]}</p>}
            <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
              <button onClick={() => setFlowOn(!flowOn)} aria-pressed={flowOn} className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] ${flowOn ? "border-success/60 text-success-ink" : "border-line text-muted"}`}>
                <Waves className="h-3 w-3" /> Product flow {flowOn ? "on" : "off"}
              </button>
              <span className="text-[11px] text-muted">green flowing · amber starved · red blocked</span>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-surface/92 p-2 text-[12px] shadow-[var(--shadow-card)] backdrop-blur" data-testid="vr-replay">
            <div className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5 text-accent" />
              <span className="font-medium text-ink">Replay</span>
              <span className="ml-auto tabular text-muted">{replay ? `${(state.clock.hour - replay.hour).toFixed(1)} h ago` : "live"}</span>
            </div>
            <input
              type="range"
              aria-label="Replay time"
              className="mt-1.5 w-full accent-[var(--color-accent)]"
              min={replayStart(state)}
              max={state.clock.hour}
              step={1 / 6}
              value={replay?.hour ?? state.clock.hour}
              onChange={(e) => {
                const h = Number(e.target.value);
                if (h >= state.clock.hour - 1 / 12) return setReplay(null);
                setReplay({ hour: h, playing: false });
                if (!heat) setHeat("health");
              }}
            />
            <div className="mt-1 flex gap-1.5">
              <button onClick={() => (replay ? setReplay({ ...replay, playing: !replay.playing }) : startReplay(6))} className="flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:bg-surface-2">
                {replay?.playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} {replay ? (replay.playing ? "Pause" : "Play") : "Replay last 6 h"}
              </button>
              {replay && (
                <button onClick={() => setReplay(null)} className="rounded-md border border-line px-2 py-0.5 text-[11.5px] text-ink-2 hover:bg-surface-2">
                  Back to live
                </button>
              )}
            </div>
            {replay && frame && (
              <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted">
                {replayLines(state, frame.hour).slice(1).map((l, i) => (
                  <li key={i}>{l.text}</li>
                ))}
              </ul>
            )}
          </div>
          {whatIf && (
            <div className={`rounded-lg border bg-surface/95 p-2 text-[12px] shadow-[var(--shadow-card)] backdrop-blur ${whatIf.better ? "border-success/60" : "border-danger/60"}`} data-testid="vr-whatif">
              <p className="flex items-center gap-1.5 font-medium text-ink">
                <Activity className="h-3.5 w-3.5 text-accent" /> What if {whatIf.change}?
              </p>
              <p className="mt-1 leading-snug text-ink-2">{whatIf.summary.replace(/^What if [^:]+: /, "")}</p>
              <button onClick={() => setWhatIf(null)} className="mt-1 text-[11px] text-muted hover:text-ink">
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
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
      <PrepareVRDemoDialog
        open={prepareOpen}
        onOpenChange={setPrepareOpen}
        seated={seated}
        onToggleSeated={() => setSeated(!seated)}
        questPerf={questPerf}
        onTogglePerf={() => setQuestPerf(!questPerf)}
        recordingOn={recordingOn}
        onToggleRecording={recordingToggle}
      />
    </div>
  );
}
