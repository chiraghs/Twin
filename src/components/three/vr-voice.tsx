"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { useXRInputSourceState } from "@react-three/xr";
import * as THREE from "three";
import { Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useAdmin } from "@/client/admin";
import { api, apiForm } from "@/client/api";
import { useCopilot } from "@/client/copilot";
import { useRecording } from "@/client/recording";
import { speak, stopSpeaking, useVoiceSettings } from "@/client/speech";
import { useFactory, useUi } from "@/client/store";
import { startRecording, type Recorder } from "@/client/voice";
import { activeAlarms } from "@/domain/live";
import type { FactoryState } from "@/domain/types";
import { bottlenecks, machineStates, throughputExplanation } from "@/domain/process-signals";
import type { QuickWhatIf } from "@/domain/quick-what-if";
import { parseVoiceCommand, VOICE_HELP, type HeatMetric } from "@/domain/voice-commands";
import { cn } from "@/lib/cn";
import { HEAT_LABEL } from "./vr-overlays";
import { controlTexture, FONT, THEME } from "./vr-ui";
import { pageLabel } from "@/domain/site-pages";
import { findEntries, type FindEntry } from "./vr-search";

export type VoiceStatus = "idle" | "listening" | "thinking";

export interface VrVoice {
  status: VoiceStatus;
  heard: string | null;
  reply: string | null;
  start: () => void;
  stop: () => void;
}

interface Deps {
  state: FactoryState;
  index: FindEntry[];
  selected: string | null;
  goTo: (e: FindEntry) => void;
  exitXR: () => void;
  inXR: boolean;
  /** The VR view's overlays, driven by voice. */
  overlays: {
    setHeat: (m: HeatMetric | null) => void;
    setFlow: (on: boolean) => void;
    whatIf: (assetId: string, change: { speedPct?: number; maintainNow?: boolean }) => QuickWhatIf;
    replay: (hours: number | null) => void;
    table: (on: boolean) => void;
    recenter?: () => void;
    seated?: (on: boolean) => void;
    perf?: (on: boolean) => void;
    /** The website panel: open at a page (or the last one), or close (null). */
    page?: (href: string | null, open: boolean) => void;
  };
}

const CONFIRM_MS = 15_000;

/**
 * Push-to-talk in the VR plant: record while held, transcribe with Muse Voice Transcribe, then run
 * a command (go to, acknowledge, speed, trip / restore with confirmation, mute, exit) or ask the
 * copilot. Replies appear on screen and are spoken unless muted. New alarms are announced.
 */
export function useVrVoice({ state, index, selected, goTo, exitXR, inXR, overlays }: Deps): VrVoice {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [heard, setHeard] = useState<string | null>(null);
  const [reply, setReplyState] = useState<string | null>(null);
  const rec = useRef<Recorder | null>(null);
  const starting = useRef(false);
  const pending = useRef<{ assetId: string; at: number } | null>(null);
  const apply = useFactory((s) => s.apply);
  const operator = useUi((s) => s.operator);
  const loadAdmin = useAdmin((s) => s.load);
  const adminLoaded = useAdmin((s) => s.loaded);
  useEffect(() => {
    if (!adminLoaded) void loadAdmin();
  }, [adminLoaded, loadAdmin]);

  // Latest values for async handlers.
  const ref = useRef({ state, index, selected, goTo, exitXR, overlays });
  ref.current = { state, index, selected, goTo, exitXR, overlays };

  const say = useCallback((text: string, maxSentences = 2) => {
    setReplyState(text);
    speak(text, { maxSentences });
  }, []);

  /** The machine a command is about: a spoken name, else the selected one, else the only alarmed one. */
  const machineFor = (target: string | null, preferAlarmed = false) => {
    const { state: s, index: ix, selected: sel } = ref.current;
    if (target) {
      // Several matches ("the robot"): prefer the one with an open alarm.
      const hits = findEntries(ix, target).filter((e) => e.assetId);
      const alarmed = hits.find((e) => s.incidents.some((i) => i.assetId === e.assetId && i.status !== "resolved"));
      return (alarmed ?? hits[0])?.assetId ?? null;
    }
    if (sel) return sel;
    if (preferAlarmed) {
      const open = s.incidents.filter((i) => i.status === "open");
      if (open.length === 1) return open[0].assetId;
    }
    return null;
  };

  /** The line a spoken target names ("line A"), or the line of a named machine. */
  const lineFor = (target: string | null) => {
    if (!target) return null;
    const { state: s, index: ix } = ref.current;
    const hit = findEntries(ix, target)[0];
    if (!hit) return null;
    if (hit.kind === "line") return hit.key.slice(2);
    return hit.assetId ? (s.assets.find((a) => a.id === hit.assetId)?.lineId ?? null) : null;
  };

  const needAdmin = () => {
    if (useAdmin.getState().admin) return false;
    say("Admin access is needed to change machines.");
    return true;
  };

  const handle = useCallback(
    async (text: string) => {
      const cmd = parseVoiceCommand(text);
      const { state: s, index: ix } = ref.current;
      const nameOf = (id: string) => {
        const a = s.assets.find((x) => x.id === id);
        return a ? `${a.id}, ${a.name}` : id;
      };
      try {
        switch (cmd.kind) {
          case "help":
            return say(VOICE_HELP, 3);
          case "mute":
            setReplyState("Muted. Say “unmute” or press Sound to hear me again.");
            return useVoiceSettings.getState().setMuted(true);
          case "unmute":
            useVoiceSettings.getState().setMuted(false);
            return say("Sound on.");
          case "exit":
            say("Leaving VR.");
            return ref.current.exitXR();
          case "cancel":
            pending.current = null;
            return say("Cancelled.");
          case "goto": {
            const hit = findEntries(ix, cmd.query)[0];
            if (!hit) return say(`I couldn't find ${cmd.query}.`);
            ref.current.goTo(hit);
            return say(`Going to ${hit.label.replace(" · ", ", ")}.`);
          }
          case "ack": {
            const id = machineFor(cmd.target, true);
            const inc = s.incidents.find((i) => i.status === "open" && (!id || i.assetId === id));
            if (!inc) return say(id ? `${nameOf(id)} has no open alarm.` : "There's no open alarm to acknowledge.");
            if (needAdmin()) return;
            apply((await api<{ state: FactoryState }>(`/api/incidents/${inc.id}/ack`, { body: { by: operator } })).state);
            return say(`Alarm on ${inc.assetId} acknowledged.`);
          }
          case "speed": {
            const id = machineFor(cmd.target);
            if (!id) return say("Select a machine first, or say its name, for example: speed down on A-ROB-03.");
            if (needAdmin()) return;
            const a = s.assets.find((x) => x.id === id)!;
            const v = Math.max(30, Math.min(110, a.speedPct + cmd.delta));
            apply((await api<{ state: FactoryState }>(`/api/assets/${id}`, { method: "PATCH", body: { speedPct: v } })).state);
            return say(`${id} speed set to ${v} percent.`);
          }
          case "trip": {
            const id = machineFor(cmd.target);
            if (!id) return say("Which machine? Select it, or say: trip A-ROB-03.");
            if (needAdmin()) return;
            pending.current = { assetId: id, at: Date.now() };
            return say(`Say confirm to trip ${nameOf(id)}, or cancel.`);
          }
          case "confirm": {
            const p = pending.current;
            pending.current = null;
            if (!p || Date.now() - p.at > CONFIRM_MS) return say("Nothing to confirm.");
            if (needAdmin()) return;
            apply(await api<FactoryState>("/api/faults", { body: { assetId: p.assetId, mode: "failure", severity: 100 } }));
            return say(`${p.assetId} tripped.`);
          }
          case "restore": {
            const id = machineFor(cmd.target);
            if (!id) return say("Which machine? Select it, or say: restore A-ROB-03.");
            if (needAdmin()) return;
            apply(await api<FactoryState>("/api/faults", { body: { assetId: id, mode: "restore", severity: 0 } }));
            return say(`${id} restored.`);
          }
          case "heat": {
            ref.current.overlays.setHeat(cmd.metric);
            return say(cmd.metric ? `Showing the ${HEAT_LABEL[cmd.metric].toLowerCase()} heatmap.` : "Heatmap off.");
          }
          case "table": {
            ref.current.overlays.table(cmd.on);
            return say(cmd.on ? "Table view: the whole plant in front of you." : "Back to full size.");
          }
          case "page": {
            if (!ref.current.overlays.page) return say("The website panel is only in the headset.");
            ref.current.overlays.page(cmd.href, cmd.open);
            return say(!cmd.open ? "Closed the website." : cmd.href ? `Opening ${pageLabel(cmd.href)}. Point and pinch to click.` : "Here is the website. Pick a page on the left.");
          }
          case "recenter": {
            ref.current.overlays.recenter?.();
            return say("Recentered view.");
          }
          case "seated": {
            ref.current.overlays.seated?.(cmd.on);
            return say(cmd.on ? "Seated mode: desk height and nearby controls." : "Standing mode: full eye height.");
          }
          case "perf": {
            ref.current.overlays.perf?.(cmd.on);
            return say(cmd.on ? "Quest performance mode on: steady 72 fps target." : "Quest performance mode off.");
          }
          case "flow": {
            ref.current.overlays.setFlow(cmd.on);
            return say(cmd.on ? "Showing product flow: green flowing, amber starved, red blocked." : "Product flow hidden.");
          }
          case "replay": {
            ref.current.overlays.replay(cmd.hours);
            return say(cmd.hours ? `Replaying the last ${cmd.hours} hours.` : "Back to live.");
          }
          case "bottleneck": {
            const line = lineFor(cmd.target);
            const all = bottlenecks(s);
            const pick = line ? all.find((b) => b.lineId === line) : (all.find((b) => b.assetId && machineStates(s)[b.assetId]?.state === "fault") ?? all.find((b) => b.assetId));
            ref.current.overlays.setHeat("state");
            const hit = pick?.assetId ? ix.find((e) => e.assetId === pick.assetId) : undefined;
            if (hit) ref.current.goTo(hit);
            return say(throughputExplanation(s, line ?? undefined), 3);
          }
          case "whatif": {
            let id = cmd.target ? machineFor(cmd.target) : null;
            const line = !id && cmd.target ? lineFor(cmd.target) : null;
            if (line) id = bottlenecks(s).find((b) => b.lineId === line)?.assetId ?? s.lines.find((l) => l.id === line)?.assetIds[0] ?? null;
            if (!id) id = machineFor(null, true) ?? [...s.assets].sort((a, b) => a.healthScore - b.healthScore)[0]?.id ?? null;
            if (!id) return say("Which machine? For example: what if A-ROB-03 runs at 80 percent.");
            setReplyState("Simulating…");
            const at = ix.find((e) => e.assetId === id);
            if (at) ref.current.goTo(at);
            const r = ref.current.overlays.whatIf(id, cmd.maintain ? { maintainNow: true } : { speedPct: cmd.speedPct ?? 100 });
            return say(r.summary, 1);
          }
          case "ask": {
            setReplyState("Asking the copilot…");
            const before = useCopilot.getState().turns.length;
            await useCopilot.getState().ask(cmd.text);
            const turns = useCopilot.getState().turns.slice(before);
            const answer = [...turns].reverse().find((t) => t.role === "copilot");
            const text = answer?.error ? `The copilot couldn't answer: ${answer.error}` : answer?.text?.trim() || "The copilot didn't return an answer.";
            return say(text, 2);
          }
        }
      } catch (e) {
        say(e instanceof Error ? e.message : "That didn't work.");
      }
    },
    [apply, operator, say], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const start = useCallback(() => {
    if (useVoiceSettings.getState().micOff || rec.current || starting.current) return;
    starting.current = true;
    stopSpeaking();
    setHeard(null);
    startRecording()
      .then((r) => {
        rec.current = r;
        setStatus("listening");
      })
      .catch((e) => {
        setReplyState(e instanceof Error ? `Microphone: ${e.message}` : "Microphone unavailable.");
        setStatus("idle");
      })
      .finally(() => {
        starting.current = false;
      });
  }, []);

  const stop = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    setStatus("thinking");
    void (async () => {
      try {
        const wav = await r.stop();
        if (wav.size < 2000) {
          setStatus("idle");
          return;
        }
        const form = new FormData();
        form.append("audio", new File([wav], "voice.wav", { type: "audio/wav" }));
        const { text } = await apiForm<{ text: string }>("/api/speech", form);
        setHeard(text.trim() || null);
        if (text.trim()) await handle(text);
      } catch (e) {
        setReplyState(e instanceof Error ? e.message : "Couldn't understand that.");
      } finally {
        setStatus("idle");
      }
    })();
  }, [handle]);

  // Hold V to talk (on screen, in the simulator, or with a keyboard paired to the headset).
  useEffect(() => {
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]") !== null;
    const down = (e: KeyboardEvent) => {
      if (e.code !== "KeyV" || e.repeat || typing(e)) return;
      start();
    };
    const up = (e: KeyboardEvent) => e.code === "KeyV" && stop();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [start, stop]);

  // Mic turned off while recording: drop it.
  const micOff = useVoiceSettings((s) => s.micOff);
  useEffect(() => {
    if (micOff && rec.current) {
      rec.current.cancel();
      rec.current = null;
      setStatus("idle");
    }
  }, [micOff]);

  // Announce new alarms (not the ones already there when the VR tab opened) and greet on entering VR.
  const alarms = useMemo(() => activeAlarms(state).filter((a) => !a.acknowledged), [state]);
  const announced = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!announced.current) {
      announced.current = new Set(alarms.map((a) => a.id));
      return;
    }
    const fresh = alarms.filter((a) => !announced.current!.has(a.id));
    fresh.forEach((a) => announced.current!.add(a.id));
    if (fresh.length) say(`New alarm. ${fresh[0].title}.`, 1);
  }, [alarms, say]);
  const wasInXR = useRef(false);
  useEffect(() => {
    if (inXR && !wasInXR.current) {
      const n = alarms.length;
      say(n ? `Welcome to ${state.profile.name}. ${n} active alarm${n > 1 ? "s" : ""}: ${alarms[0].title}.` : `Welcome to ${state.profile.name}. No active alarms.`, 2);
    }
    wasInXR.current = inXR;
  }, [inXR]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recording captions (Shift + C) follow the conversation.
  useEffect(() => {
    useRecording.getState().caption(heard, reply);
  }, [heard, reply]);

  // Clear the reply after a while.
  useEffect(() => {
    if (!reply || status !== "idle") return;
    const t = setTimeout(() => setReplyState(null), 20_000);
    return () => clearTimeout(t);
  }, [reply, status]);

  return { status, heard, reply, start, stop };
}

/* ───────────────────────────── in the headset ───────────────────────────── */

/** Hold the left controller's grip to talk. */
export function GripTalk({ voice }: { voice: VrVoice }) {
  const left = useXRInputSourceState("controller", "left");
  const held = useRef(false);
  useFrame(() => {
    const pressed = left?.gamepad["xr-standard-squeeze"]?.state === "pressed";
    if (pressed && !held.current) voice.start();
    if (!pressed && held.current) voice.stop();
    held.current = !!pressed;
  });
  return null;
}

/** The voice card: themed like the website's cards (header with a status dot, hairline, wrapped text), as tall as its text. */
function texture(lines: { text: string; color: string; font: string; dot?: string }[], w: number, maxH: number, border: string) {
  const PXR = 2;
  const pad = 28;
  const draw = (g: CanvasRenderingContext2D | null) => {
    let y = 22;
    lines.forEach((l, i) => {
      if (g) {
        g.font = l.font;
        g.fillStyle = l.color;
      }
      const m = g ?? measureCtx;
      m.font = l.font;
      let x = pad;
      if (l.dot) {
        if (g) {
          g.save();
          g.fillStyle = l.dot;
          g.beginPath();
          g.arc(pad + 6, y + 14, 6, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
        x += 22;
      }
      const words = l.text.split(" ");
      let line = "";
      for (const w0 of words) {
        const next = line ? `${line} ${w0}` : w0;
        if (m.measureText(next).width > w - pad - x && line) {
          g?.fillText(line, x, y);
          y += 34;
          line = w0;
        } else line = next;
        if (y > maxH - 44) break;
      }
      if (line && y <= maxH - 44) {
        g?.fillText(line, x, y);
        y += 36;
      }
      if (i === 0 && lines.length > 1) {
        if (g) {
          g.fillStyle = THEME.line;
          g.fillRect(pad, y, w - pad * 2, 1.5);
        }
        y += 16;
      }
    });
    return y + 10;
  };
  const h = Math.min(maxH, Math.max(76, draw(null)));
  const c = document.createElement("canvas");
  c.width = w * PXR;
  c.height = h * PXR;
  const g = c.getContext("2d")!;
  g.scale(PXR, PXR);
  g.fillStyle = "rgba(17,26,46,0.97)";
  g.beginPath();
  g.roundRect(1, 1, w - 2, h - 2, 18);
  g.fill();
  g.strokeStyle = border;
  g.lineWidth = border === THEME.lineStrong ? 1.5 : 3;
  g.stroke();
  g.textBaseline = "top";
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { t, aspect: h / w };
}
const measureCtx = (typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null) as CanvasRenderingContext2D;

function HoldButton({ label, color, position, width, onDown, onUp, onClick, active }: { label: string; color: string; position: [number, number, number]; width: number; onDown?: () => void; onUp?: () => void; onClick?: () => void; active?: boolean }) {
  const [hover, setHover] = useState(false);
  const tex = useMemo(() => controlTexture(label, color, { hover, active }, 384, 110), [label, color, hover, active]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh
      position={position}
      onPointerOver={(e) => (e.stopPropagation(), setHover(true))}
      onPointerOut={() => (setHover(false), onUp?.())}
      onPointerDown={(e) => (e.stopPropagation(), onDown?.())}
      onPointerUp={(e) => (e.stopPropagation(), onUp?.())}
      onClick={(e) => (e.stopPropagation(), onClick?.())}
    >
      <planeGeometry args={[width, width * (110 / 384)]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

/** Talk / mute / mic buttons at waist height and the voice board in front of you (children of the XR origin). */
/** `compact`: smaller and lower, below the website panel when it is open. */
type Vec3 = [number, number, number];
/** `minimal`: only the talk button (at `talkAt`) and the answer card (at `boardAt`), for the folded table-view controls. */
export function VoiceRig3D({ voice, compact, minimal, talkAt, boardAt, boardYaw = -0.3 }: { voice: VrVoice; compact?: boolean; minimal?: boolean; talkAt?: Vec3; boardAt?: Vec3; boardYaw?: number }) {
  const { muted, micOff, setMuted, setMicOff } = useVoiceSettings();
  // The card shows while you talk and for a while after the answer, then gets out of the way.
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    setFresh(true);
    if (voice.status !== "idle") return;
    const t = window.setTimeout(() => setFresh(false), 10_000);
    return () => window.clearTimeout(t);
  }, [voice.status, voice.heard, voice.reply]);
  const boardTex = useMemo(() => {
    if (voice.status === "idle" && !voice.heard && !voice.reply) return null;
    const head = voice.status === "listening" ? "Listening… release to send" : voice.status === "thinking" ? "Thinking…" : "Twin";
    const lines = [
      { text: head, color: voice.status === "listening" ? THEME.criticalInk : THEME.ink, font: `600 26px ${FONT}`, dot: voice.status === "listening" ? THEME.critical : THEME.agent },
      ...(voice.heard ? [{ text: `“${voice.heard}”`, color: THEME.ink2, font: `italic 400 24px ${FONT}` }] : []),
      ...(voice.reply ? [{ text: voice.reply.length > 230 ? `${voice.reply.slice(0, 228).replace(/\s+\S*$/, "")}…` : voice.reply, color: THEME.ink, font: `400 25px ${FONT}` }] : []),
    ];
    return texture(lines, 900, 420, voice.status === "listening" ? THEME.critical : THEME.lineStrong);
  }, [voice.status, voice.heard, voice.reply]);
  useEffect(() => () => boardTex?.t.dispose(), [boardTex]);
  return (
    <>
      <HoldButton label={micOff ? "Mic is off" : voice.status === "listening" ? "Listening…" : "Hold to talk"} color="#ef4444" width={minimal ? 0.36 : 0.5} position={talkAt ?? [-0.3, 0.7, -0.7]} active={voice.status === "listening"} onDown={micOff ? undefined : voice.start} onUp={voice.stop} />
      {!minimal && <HoldButton label={muted ? "Sound off" : "Sound on"} color="#64748b" width={0.28} position={[0.07, 0.7, -0.7]} onClick={() => setMuted(!muted)} active={muted} />}
      {!minimal && <HoldButton label={micOff ? "Mic off" : "Mic on"} color="#64748b" width={0.28} position={[0.38, 0.7, -0.7]} onClick={() => setMicOff(!micOff)} active={micOff} />}
      {boardTex && (fresh || voice.status !== "idle") && (
        // Low and to the right of the view, so it never covers what you are looking at.
        <mesh position={boardAt ?? (compact ? [0.6, 1.06, -1.05] : [0.6, 1.2, -1.1])} rotation={[0, boardYaw, 0]}>
          <planeGeometry args={compact ? [0.46, 0.46 * boardTex.aspect] : [0.56, 0.56 * boardTex.aspect]} />
          <meshBasicMaterial map={boardTex.t} transparent toneMapped={false} depthTest={false} />
        </mesh>
      )}
    </>
  );
}

/* ───────────────────────────── on screen ───────────────────────────── */

/** Hold-to-talk (button or the V key), mute and mic toggles, and the voice bubble. */
export function VoiceDock({ voice }: { voice: VrVoice }) {
  const { muted, micOff, setMuted, setMicOff } = useVoiceSettings();
  const listening = voice.status === "listening";
  return (
    <div className="absolute bottom-4 left-3 z-10 flex max-w-[360px] flex-col items-start gap-2" data-testid="voice-dock">
      {(voice.heard || voice.reply || voice.status !== "idle") && (
        <div className="rounded-lg border border-line bg-surface/95 px-3 py-2 text-[12px] shadow-xl backdrop-blur" data-testid="voice-bubble" aria-live="polite">
          <p className={cn("font-medium", listening ? "text-critical-ink" : "text-accent-ink")}>{listening ? "Listening… release to send" : voice.status === "thinking" ? "Thinking…" : "Twin"}</p>
          {voice.heard && <p className="mt-0.5 text-muted">You: “{voice.heard}”</p>}
          {voice.reply && <p className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap text-ink">{voice.reply}</p>}
        </div>
      )}
      <div className="flex gap-1.5">
        <button
          disabled={micOff}
          onPointerDown={(e) => (e.preventDefault(), voice.start())}
          onPointerUp={() => voice.stop()}
          onPointerLeave={() => listening && voice.stop()}
          className={cn("flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium shadow-lg select-none disabled:opacity-40", listening ? "border-critical bg-critical text-white" : "border-line bg-surface text-ink hover:bg-surface-2")}
          title="Hold to talk (or hold V)"
          data-testid="hold-to-talk"
        >
          <Mic className="h-4 w-4" /> {listening ? "Listening…" : "Hold to talk (V)"}
        </button>
        <button onClick={() => setMuted(!muted)} aria-pressed={muted} aria-label={muted ? "Unmute voice" : "Mute voice"} title={muted ? "Unmute voice" : "Mute voice"} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-ink shadow-lg hover:bg-surface-2" data-testid="mute-voice">
          {muted ? <VolumeX className="h-4 w-4 text-critical-ink" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button onClick={() => setMicOff(!micOff)} aria-pressed={micOff} aria-label={micOff ? "Turn microphone on" : "Turn microphone off"} title={micOff ? "Turn microphone on" : "Turn microphone off"} className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-ink shadow-lg hover:bg-surface-2" data-testid="mic-toggle">
          {micOff ? <MicOff className="h-4 w-4 text-critical-ink" /> : <Mic className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
