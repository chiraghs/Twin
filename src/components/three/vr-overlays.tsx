"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { classifyStatus, computeHealthScore } from "@/domain/health";
import { FOOTPRINT, type Layout } from "@/domain/layout";
import { machineStates, remainingLife, zoneEnvironment, type MachineState } from "@/domain/process-signals";
import type { AssetStatus, FactoryState, TelemetryReading } from "@/domain/types";
import type { HeatMetric } from "@/domain/voice-commands";
import { machineParts } from "../iso/geometry";
import { P } from "./scene";
import { textTexture, THEME } from "./vr-ui";

/* ─────────────────────────── heatmap ─────────────────────────── */

export const HEAT_METRICS: HeatMetric[] = ["temperature", "vibration", "energy", "health", "life", "state", "noise"];
export const HEAT_LABEL: Record<HeatMetric, string> = {
  temperature: "Temperature",
  vibration: "Vibration",
  energy: "Energy",
  health: "Health",
  life: "Remaining life",
  state: "Machine state",
  noise: "Noise",
};
export const HEAT_LEGEND: Record<HeatMetric, string> = {
  temperature: "green: near baseline · red: at trip limit",
  vibration: "green: near baseline · red: at trip limit",
  energy: "bar height: kW drawn now",
  health: "green: healthy · red: critical",
  life: "red: trip predicted within 24 h",
  state: "green run · amber starved · orange blocked · red fault · purple bottleneck",
  noise: "zone noise: green < 75 dB · red ≥ 88 dB",
};

export const STATE_COLOR: Record<MachineState, string> = {
  running: "#22c55e",
  idle: "#64748b",
  starved: "#f59e0b",
  blocked: "#f97316",
  changeover: "#38bdf8",
  fault: "#ef4444",
  maintenance: "#a78bfa",
};
const BOTTLENECK = "#c026d3";

/** 0 → green, 0.5 → amber, 1 → red. */
export function ramp(t: number) {
  const c = new THREE.Color();
  const g = new THREE.Color("#22c55e");
  const a = new THREE.Color("#f59e0b");
  const r = new THREE.Color("#ef4444");
  const k = Math.max(0, Math.min(1, t));
  return k < 0.5 ? c.lerpColors(g, a, k / 0.5) : c.lerpColors(a, r, (k - 0.5) / 0.5);
}

/** Values the replay shows for one past moment: the recorded reading nearest before that hour. */
export interface ReplayFrame {
  hour: number;
  readings: Record<string, TelemetryReading | undefined>;
}

export function replayFrame(state: FactoryState, hour: number): ReplayFrame {
  const readings: ReplayFrame["readings"] = {};
  for (const a of state.assets) {
    const hist = state.telemetry[a.id] ?? [];
    let hit: TelemetryReading | undefined;
    for (const r of hist) {
      if (r.t <= hour + 1e-6) hit = r;
      else break;
    }
    readings[a.id] = hit ?? hist[0];
  }
  return { hour, readings };
}

/** Oldest recorded hour, for the replay range. */
export const replayStart = (state: FactoryState) => Math.min(...state.assets.map((a) => state.telemetry[a.id]?.[0]?.t ?? state.clock.hour));

export interface HeatCell {
  assetId: string;
  x: number;
  y: number;
  /** 0–1 intensity (bar height). */
  t: number;
  color: string;
  label: string;
}

/** Colour every machine by a metric, live or (with a replay frame) at a past moment. */
export function heatCells(state: FactoryState, layout: Layout, metric: HeatMetric, frame: ReplayFrame | null = null): HeatCell[] {
  const byId = new Map(state.assets.map((a) => [a.id, a]));
  const st = metric === "state" && !frame ? machineStates(state) : null;
  const env = metric === "noise" ? new Map(zoneEnvironment(state).map((z) => [z.lineId, z])) : null;
  const maxKw = Math.max(1, ...state.assets.map((a) => a.ratedPowerKw));
  return layout.machines.flatMap((pm): HeatCell[] => {
    const a = byId.get(pm.m.id);
    if (!a) return [];
    const r = frame?.readings[a.id];
    const vib = frame ? (r?.vibration ?? a.baseline.vibration) : a.signal.vibration;
    const temp = frame ? (r?.temperature ?? a.baseline.temperature) : a.signal.temperature;
    const kw = frame ? (r?.powerKw ?? 0) : a.signal.powerKw;
    const running = frame ? !!r?.running : a.mode === "running";
    const base = { assetId: a.id, x: pm.x, y: pm.y };
    const frac = (v: number, b: number, trip: number) => Math.max(0, Math.min(1, (v - b) / Math.max(1e-6, trip - b)));
    const m = frame && (metric === "life" || metric === "state" || metric === "noise") ? "health" : metric;
    switch (m) {
      case "temperature": {
        const t = frac(temp, a.baseline.temperature, a.thresholds.temperatureTrip);
        return [{ ...base, t, color: `#${ramp(t).getHexString()}`, label: `${temp.toFixed(0)} °C` }];
      }
      case "vibration": {
        const t = frac(vib, a.baseline.vibration, a.thresholds.vibrationTrip);
        return [{ ...base, t, color: `#${ramp(t).getHexString()}`, label: `${vib.toFixed(1)} mm/s` }];
      }
      case "energy": {
        const t = kw / maxKw;
        return [{ ...base, t, color: `#${ramp(t).getHexString()}`, label: `${kw.toFixed(1)} kW` }];
      }
      case "health": {
        const h = frame ? computeHealthScore(vib, temp, a.baseline, a.thresholds) : a.healthScore;
        const t = 1 - h / 100;
        return [{ ...base, t: running ? t : 0.02, color: running ? `#${ramp(t * 1.4).getHexString()}` : "#64748b", label: running ? `health ${h.toFixed(0)}` : "stopped" }];
      }
      case "life": {
        const rl = remainingLife(state, a);
        const t = rl.hoursToTrip === null ? 0.05 : Math.max(0.05, Math.min(1, 1 - rl.hoursToTrip / 72));
        return [{ ...base, t, color: `#${ramp(t).getHexString()}`, label: rl.hoursToTrip === null ? "no wear trend" : rl.hoursToTrip <= 0 ? "at trip" : `trip in ${Math.round(rl.hoursToTrip)} h` }];
      }
      case "state": {
        const s = st?.[a.id];
        if (!s) return [];
        return [{ ...base, t: s.bottleneck ? 0.9 : s.state === "running" ? 0.35 : 0.6, color: s.bottleneck && s.state === "running" ? BOTTLENECK : STATE_COLOR[s.state], label: s.bottleneck && s.state === "running" ? "bottleneck" : s.state }];
      }
      case "noise": {
        const z = env?.get(pm.lineId);
        if (!z) return [];
        const t = Math.max(0, Math.min(1, (z.noiseDb - 72) / 16));
        return [{ ...base, t, color: `#${ramp(t).getHexString()}`, label: `${z.noiseDb.toFixed(0)} dB` }];
      }
    }
    return [];
  });
}

const glowTexture = (() => {
  let t: THREE.Texture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, "rgba(255,255,255,0.95)");
    grd.addColorStop(0.55, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    t = new THREE.CanvasTexture(c);
    return t;
  };
})();

function ValueTag({ text, color, position, scale = 1 }: { text: string; color: string; position: [number, number, number]; scale?: number }) {
  const tex = useMemo(() => textTexture([{ text, color: THEME.ink, font: "600 36px system-ui, sans-serif" }], 320, 84, undefined, color), [text, color]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <Billboard position={position}>
      <mesh>
        <planeGeometry args={[0.62 * scale, 0.163 * scale]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

/**
 * The heatmap: a glow on the floor under each machine and a translucent bar above it whose height
 * and colour show the metric, with the value on a tag. Ghosted (dashed look) during replay.
 */
export function HeatOverlay({ cells, layout, ghost = false, floorOnly, tagScale = 1 }: { cells: HeatCell[]; layout: Layout; ghost?: boolean; /** Machines showing a board: floor glow only, the board carries the value. */ floorOnly?: Set<string>; /** Larger tags on the tabletop miniature. */ tagScale?: number }) {
  const kinds = useMemo(() => new Map(layout.machines.map((m) => [m.m.id, m.m.kind])), [layout]);
  const glow = useMemo(() => glowTexture(), []);
  // Calm by default: every machine gets a floor glow; only the few that stand out (worst first) get a
  // column and a value tag, so the view stays readable.
  const notable = useMemo(() => new Set([...cells].filter((c) => c.t >= 0.35).sort((a, b) => b.t - a.t).slice(0, 3).map((c) => c.assetId)), [cells]);
  return (
    <group name="heatmap">
      {cells.map((c) => {
        const kind = kinds.get(c.assetId);
        if (!kind) return null;
        const f = FOOTPRINT[kind];
        const top = machineParts(kind).height;
        const r = Math.max(f.L, f.W) * 0.9 + 0.45;
        const h = 0.2 + c.t * 1.1;
        return (
          <group key={c.assetId}>
            <mesh rotation-x={-Math.PI / 2} position={P(c.x, c.y, 0.015)}>
              <planeGeometry args={[r * 2, r * 2]} />
              <meshBasicMaterial map={glow} color={c.color} transparent opacity={ghost ? 0.5 : 0.8} depthWrite={false} toneMapped={false} />
            </mesh>
            {!floorOnly?.has(c.assetId) && notable.has(c.assetId) && (
              <>
                <mesh position={P(c.x, c.y, top + 0.15 + h / 2)}>
                  <cylinderGeometry args={[0.1, 0.1, h, 20, 1, true]} />
                  <meshBasicMaterial color={c.color} transparent opacity={ghost ? 0.3 : 0.4} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} wireframe={ghost} />
                </mesh>
                <ValueTag text={c.label} color={c.color} position={P(c.x, c.y, top + 0.3 * tagScale + h)} scale={tagScale * 0.7} />
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

/* ─────────────────────────── product flow state ─────────────────────────── */

export type FlowState = "flowing" | "blocked" | "starved" | "stopped";
const FLOW_COLOR: Record<FlowState, string> = { flowing: "#22c55e", blocked: "#ef4444", starved: "#f59e0b", stopped: "#64748b" };

/** For each belt: is product flowing, backing up (blocked downstream) or not arriving (starved)? */
export function beltStates(state: FactoryState, layout: Layout, flows: Record<string, number>) {
  const st = machineStates(state);
  const near = (p: [number, number], lineId: string) =>
    layout.machines.filter((m) => m.lineId === lineId).reduce<{ id: string; d: number } | null>((best, m) => {
      const d = Math.hypot(m.x - p[0], m.y - p[1]);
      return !best || d < best.d ? { id: m.m.id, d } : best;
    }, null)?.id ?? null;
  return layout.belts.map((bt) => {
    const up = near(bt.from, bt.lineId);
    const down = near(bt.to, bt.lineId);
    const su = up ? st[up]?.state : undefined;
    const sd = down ? st[down]?.state : undefined;
    let s: FlowState = (flows[bt.lineId] ?? 0) > 0 ? "flowing" : "stopped";
    if (sd === "fault" || sd === "maintenance" || sd === "blocked") s = "blocked";
    else if (su === "fault" || su === "maintenance" || su === "starved") s = "starved";
    return { belt: bt, state: s };
  });
}

function chevronTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 32;
  const g = c.getContext("2d")!;
  g.fillStyle = "rgba(255,255,255,0)";
  g.fillRect(0, 0, 128, 32);
  g.strokeStyle = "white";
  g.lineWidth = 7;
  g.lineCap = "round";
  for (const x0 of [20, 84]) {
    g.beginPath();
    g.moveTo(x0, 6);
    g.lineTo(x0 + 18, 16);
    g.lineTo(x0, 26);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function FlowStrip({ from, to, state, speed }: { from: [number, number]; to: [number, number]; state: FlowState; speed: number }) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const tex = useMemo(() => {
    const t = chevronTexture();
    t.repeat.set(Math.max(1, len / 0.6), 1);
    return t;
  }, [len]);
  useEffect(() => () => tex.dispose(), [tex]);
  useFrame((_, dt) => {
    if (state === "flowing") tex.offset.x -= Math.min(dt, 0.1) * speed * 1.5;
  });
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    // Blocked belts pulse so they catch the eye.
    if (mat.current) mat.current.opacity = state === "blocked" ? 0.55 + 0.4 * Math.sin(clock.elapsedTime * 5) : 0.85;
  });
  return (
    <mesh position={P((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, 0.56)} rotation={[-Math.PI / 2, 0, angle]}>
      <planeGeometry args={[len * 0.92, 0.22]} />
      <meshBasicMaterial ref={mat} map={tex} color={FLOW_COLOR[state]} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** Chevrons over every belt showing where product flows and where it backs up or runs dry. */
export function FlowOverlay({ state, layout, flows }: { state: FactoryState; layout: Layout; flows: Record<string, number> }) {
  const belts = useMemo(() => beltStates(state, layout, flows), [state, layout, flows]);
  return (
    <group name="flow-overlay">
      {belts.map(({ belt, state: s }) => (
        <FlowStrip key={belt.id} from={belt.from} to={belt.to} state={s} speed={Math.max(0.2, flows[belt.lineId] ?? 0)} />
      ))}
    </group>
  );
}

/* ─────────────────────────── spatial alarm sound ─────────────────────────── */

export interface SoundingAlarm {
  id: string;
  assetId: string;
  severity: "warning" | "critical";
}

function AlarmSource({ listener, position, severity }: { listener: THREE.AudioListener; position: [number, number, number]; severity: "warning" | "critical" }) {
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    const ctx = listener.context;
    const pa = new THREE.PositionalAudio(listener);
    pa.setDistanceModel("inverse");
    pa.setRefDistance(2.5);
    pa.setRolloffFactor(1.4);
    pa.panner.panningModel = "HRTF";
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    const env = ctx.createGain();
    env.gain.value = 0;
    osc.connect(env);
    env.connect(pa.getOutput());
    osc.start();
    g.add(pa);
    // Critical: a rising two-tone every 1.6 s; warning: one soft tone every 3.2 s.
    const beep = () => {
      const t = ctx.currentTime + 0.02;
      const tones = severity === "critical" ? [660, 880] : [520];
      tones.forEach((f, i) => {
        const s = t + i * 0.22;
        osc.frequency.setValueAtTime(f, s);
        env.gain.setValueAtTime(0, s);
        env.gain.linearRampToValueAtTime(severity === "critical" ? 0.32 : 0.18, s + 0.02);
        env.gain.linearRampToValueAtTime(0, s + 0.18);
      });
    };
    beep();
    const timer = setInterval(beep, severity === "critical" ? 1600 : 3200);
    return () => {
      clearInterval(timer);
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      osc.disconnect();
      env.disconnect();
      g.remove(pa);
      pa.disconnect();
    };
  }, [listener, severity]);
  return <group ref={group} position={position} />;
}

/**
 * Unacknowledged alarms sound from the machine itself (3D audio): turn your head toward the
 * sound to find it. Silent when muted; at most four sources, criticals first.
 */
export function AlarmSounds({ alarms, layout, enabled }: { alarms: SoundingAlarm[]; layout: Layout; enabled: boolean }) {
  const camera = useThree((s) => s.camera);
  const listener = useMemo(() => (typeof window === "undefined" ? null : new THREE.AudioListener()), []);
  useEffect(() => {
    if (!listener) return;
    camera.add(listener);
    const resume = () => void listener.context.resume().catch(() => undefined);
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    return () => {
      camera.remove(listener);
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, [camera, listener]);
  if (!listener || !enabled) return null;
  const pos = new Map(layout.machines.map((m) => [m.m.id, m]));
  const sources = [...alarms].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1)).slice(0, 4);
  return (
    <>
      {sources.map((a) => {
        const pm = pos.get(a.assetId);
        if (!pm) return null;
        return <AlarmSource key={`${a.id}:${a.severity}`} listener={listener} severity={a.severity} position={P(pm.x, pm.y, machineParts(pm.m.kind).height + 0.4)} />;
      })}
    </>
  );
}

/* ─────────────────────────── replay ─────────────────────────── */

/** Machine status at a past moment (from the recorded reading), for the replay board. */
export function replayStatus(state: FactoryState, frame: ReplayFrame): Record<string, AssetStatus> {
  const out: Record<string, AssetStatus> = {};
  for (const a of state.assets) {
    const r = frame.readings[a.id];
    if (!r) continue;
    const h = computeHealthScore(r.vibration, r.temperature, a.baseline, a.thresholds);
    out[a.id] = r.running ? classifyStatus("running", r.vibration, r.temperature, h, a.thresholds) : "offline";
  }
  return out;
}

/** Plant events up to a past moment, newest first: what the replay narrates. */
export function replayEvents(state: FactoryState, hour: number, limit = 4) {
  return state.incidents
    .filter((i) => i.openedHour <= hour + 1e-6)
    .sort((a, b) => b.openedHour - a.openedHour)
    .slice(0, limit)
    .map((i) => ({ id: i.id, hour: i.openedHour, assetId: i.assetId, title: i.title, severity: i.severity }));
}
