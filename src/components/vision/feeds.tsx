"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AlertTriangle, Repeat } from "lucide-react";
import { getClip, type FootageClip } from "@/domain/footage";
import { cameraView, type InspectionFrame } from "@/domain/quality";
import type { Camera, FactoryState } from "@/domain/types";
import { hashString } from "@/domain/math";
import { cn } from "@/lib/cn";
import { fmtSimTime } from "@/lib/format";
import { IsoScene } from "../iso/iso-scene";
import { isoModelFromState } from "../iso/model";

/** Camera footage is always rendered dark, regardless of the UI theme. */
const DARK_ISO = {
  "--iso-floor": "#0a1120",
  "--iso-floor-edge": "#1e2a44",
  "--iso-grid": "#131d33",
  "--iso-bay": "#0e182c",
  "--iso-top": "#3c5078",
  "--iso-right": "#2b3c60",
  "--iso-left": "#1f2d4a",
  "--iso-trim-top": "#61779f",
  "--iso-trim-right": "#4a5f86",
  "--iso-trim-left": "#3a4d72",
  "--iso-dark": "#070c18",
  "--iso-belt": "#1b263f",
  "--iso-belt-side": "#121b30",
  "--iso-edge": "rgba(0,0,0,0.35)",
  "--iso-arm": "#d3dcec",
  "--iso-arm-shadow": "#1a2440",
  "--iso-label-bg": "rgba(10,16,32,0.9)",
  "--iso-label-border": "#2b3b5e",
  "--iso-label-ink": "#e6ebf5",
  "--iso-label-muted": "#8a97b3",
  "--color-accent": "#4c8dff",
} as CSSProperties;

function useNow(ms: number, active: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setN((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
  return n;
}

/* ───────────────────────────── AOI frame ───────────────────────────── */

function PcbFrame({ frame, cameraId }: { frame: InspectionFrame; cameraId: string }) {
  const seed = hashString(cameraId);
  const jitter = ((frame.unit * 7) % 9) - 4;
  const comps = useMemo(() => {
    const out: { x: number; y: number; w: number; h: number; kind: "ic" | "chip" | "conn" }[] = [];
    let k = seed;
    const rnd = () => ((k = (k * 1103515245 + 12345) >>> 0) % 1000) / 1000;
    out.push({ x: 0.12, y: 0.62, w: 0.5, h: 0.1, kind: "conn" });
    for (let i = 0; i < 3; i++) out.push({ x: 0.14 + i * 0.25, y: 0.18 + (i % 2) * 0.05, w: 0.16, h: 0.18, kind: "ic" });
    for (let i = 0; i < 18; i++) out.push({ x: 0.08 + rnd() * 0.78, y: 0.12 + rnd() * 0.72, w: 0.035, h: 0.02, kind: "chip" });
    return out;
  }, [seed]);
  const B = { x: 120 + jitter, y: 40, w: 400, h: 280 };
  const px = (fx: number) => B.x + fx * B.w;
  const py = (fy: number) => B.y + fy * B.h;
  const d = frame.defect;
  return (
    <g>
      <rect x={B.x} y={B.y} width={B.w} height={B.h} rx={10} fill="#0d4a2e" stroke="#16613d" strokeWidth={2} />
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={B.x + 10} x2={B.x + B.w - 10} y1={py(f)} y2={py(f)} stroke="#1a7348" strokeWidth={1} opacity={0.4} />
      ))}
      <circle cx={B.x + 14} cy={B.y + 14} r={5} fill="#c9cfd6" />
      <circle cx={B.x + B.w - 14} cy={B.y + B.h - 14} r={5} fill="#c9cfd6" />
      {comps.map((c, i) => {
        const x = px(c.x);
        const y = py(c.y);
        const w = c.w * B.w;
        const h = c.h * B.h;
        if (c.kind === "ic")
          return (
            <g key={i}>
              {Array.from({ length: 8 }).map((_, p) => (
                <g key={p}>
                  <rect x={x + 6 + p * ((w - 12) / 8)} y={y - 5} width={3} height={6} fill="#c0c6cd" />
                  <rect x={x + 6 + p * ((w - 12) / 8)} y={y + h - 1} width={3} height={6} fill="#c0c6cd" />
                </g>
              ))}
              <rect x={x} y={y} width={w} height={h} rx={2} fill="#1b1d22" />
              <circle cx={x + 6} cy={y + 6} r={2} fill="#3a3d45" />
            </g>
          );
        if (c.kind === "conn")
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} rx={2} fill="#e8e3d6" />
              {Array.from({ length: 12 }).map((_, p) => (
                <rect key={p} x={x + 8 + p * ((w - 16) / 12)} y={y + h / 2 - 3} width={4} height={6} fill="#b48a2c" />
              ))}
            </g>
          );
        return (
          <g key={i}>
            <rect x={x - 2} y={y} width={w + 4} height={h} rx={1} fill="#c9cfd6" />
            <rect x={x + 3} y={y} width={w - 6} height={h} fill="#6b4f2a" />
          </g>
        );
      })}
      {d && (
        <g>
          <rect x={px(d.x)} y={py(d.y)} width={d.w * B.w} height={d.h * B.h} fill="none" stroke="#ef4444" strokeWidth={2.5} rx={3} />
          <rect x={px(d.x)} y={py(d.y) - 22} width={Math.min(260, d.type.length * 7.2 + 16)} height={18} rx={3} fill="#ef4444" />
          <text x={px(d.x) + 8} y={py(d.y) - 9} fontSize={11.5} fontWeight={700} fill="#fff">
            {d.type}
          </text>
        </g>
      )}
    </g>
  );
}

function InspectionFeed({ state, camera, live }: { state: FactoryState; camera: Camera; live: boolean }) {
  const view = useMemo(() => cameraView(state, camera), [state, camera]);
  const step = useNow(1500, live);
  const frames = view.frames;
  const frame = frames.length ? frames[live ? (frames.length - 1 + step) % frames.length : frames.length - 1] : null;
  return (
    <FeedChrome
      camera={camera}
      state={state}
      footer={
        frame ? (
          <span className={cn("rounded px-1.5 py-0.5 font-semibold", frame.pass ? "bg-emerald-500/90 text-white" : "bg-red-500/95 text-white")}>
            Unit #{frame.unit} · {frame.pass ? "PASS" : "FAIL"}
          </span>
        ) : null
      }
      caption={live ? "Replaying the most recent inspected units" : undefined}
    >
      <svg viewBox="0 0 640 360" className="h-full w-full">
        <rect width={640} height={360} fill="#05070c" />
        {frame ? <PcbFrame frame={frame} cameraId={camera.id} /> : <text x={320} y={180} textAnchor="middle" fill="#64748b" fontSize={14}>No units at station</text>}
        <g stroke="#38bdf8" strokeOpacity={0.35} strokeWidth={1}>
          <line x1={320} y1={20} x2={320} y2={34} />
          <line x1={320} y1={326} x2={320} y2={340} />
          <line x1={92} y1={180} x2={106} y2={180} />
          <line x1={534} y1={180} x2={548} y2={180} />
        </g>
      </svg>
    </FeedChrome>
  );
}

/* ───────────────────────────── thermal ───────────────────────────── */

/** Ironbow-like palette: black → purple → red → orange → yellow → white. */
function ironbow(t: number) {
  const stops: [number, [number, number, number]][] = [
    [0, [10, 6, 30]],
    [0.25, [86, 20, 120]],
    [0.5, [200, 40, 70]],
    [0.7, [240, 110, 30]],
    [0.88, [252, 210, 60]],
    [1, [255, 252, 230]],
  ];
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const f = (x - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * f)).join(",")})`;
    }
  }
  return "rgb(255,252,230)";
}

function ThermalFeed({ state, camera }: { state: FactoryState; camera: Camera }) {
  const view = useMemo(() => cameraView(state, camera), [state, camera]);
  const lo = 20;
  const hi = 100;
  const norm = (t: number) => (t - lo) / (hi - lo);
  const hottest = [...view.thermal].sort((a, b) => b.temperature - a.temperature)[0];
  return (
    <FeedChrome camera={camera} state={state} footer={hottest ? <span className="truncate rounded bg-black/60 px-1.5 py-0.5 font-semibold text-white @max-lg:hidden">Max {hottest.temperature.toFixed(1)} °C · {hottest.assetId}</span> : null}>
      <svg viewBox="0 0 640 360" className="h-full w-full">
        <defs>
          {view.thermal.map((t) => (
            <radialGradient key={t.assetId} id={`hot-${t.assetId}`}>
              <stop offset="0%" stopColor={ironbow(norm(t.temperature))} />
              <stop offset="55%" stopColor={ironbow(norm(t.temperature) * 0.7)} />
              <stop offset="100%" stopColor={ironbow(0.18)} stopOpacity={0} />
            </radialGradient>
          ))}
          <linearGradient id="thermal-scale" x1="0" x2="0" y1="1" y2="0">
            {[0, 0.25, 0.5, 0.7, 0.88, 1].map((o) => (
              <stop key={o} offset={`${o * 100}%`} stopColor={ironbow(o)} />
            ))}
          </linearGradient>
        </defs>
        <rect width={640} height={360} fill={ironbow(0.12)} />
        <rect x={0} y={250} width={640} height={110} fill={ironbow(0.16)} />
        {view.thermal.map((t, i) => {
          const cx = 190 + i * 230;
          const robot = state.assets.find((a) => a.id === t.assetId)?.kind === "robot";
          const body = ironbow(norm(t.temperature) * 0.62);
          return (
            <g key={t.assetId}>
              <ellipse cx={cx} cy={185} rx={120} ry={110} fill={`url(#hot-${t.assetId})`} opacity={0.75} />
              {robot ? (
                <g fill={body}>
                  <rect x={cx - 55} y={250} width={110} height={30} rx={4} />
                  <rect x={cx - 22} y={210} width={44} height={42} rx={6} />
                  <path d={`M${cx} 215 L${cx - 18} 120 L${cx + 60} 105 L${cx + 78} 150`} stroke={body} strokeWidth={22} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx={cx - 18} cy={120} r={17} fill={ironbow(norm(t.temperature))} />
                </g>
              ) : (
                <g fill={body}>
                  <rect x={cx - 60} y={200} width={120} height={80} rx={4} />
                  <rect x={cx - 22} y={110} width={44} height={92} rx={4} />
                  <rect x={cx - 40} y={96} width={80} height={24} rx={4} />
                </g>
              )}
              <text x={cx} y={310} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700}>
                {t.assetId} · {t.temperature.toFixed(1)} °C
              </text>
              <text x={cx} y={327} textAnchor="middle" fill="#e2e8f0" fontSize={10.5} opacity={0.8}>
                alarm {t.alarm} °C · trip {t.trip} °C
              </text>
            </g>
          );
        })}
        {hottest && (
          <g stroke="#fff" strokeWidth={1.5} opacity={0.9}>
            {(() => {
              const i = view.thermal.indexOf(hottest);
              const cx = 190 + i * 230 - 18;
              return (
                <>
                  <circle cx={cx} cy={120} r={14} fill="none" />
                  <line x1={cx - 24} x2={cx - 8} y1={120} y2={120} />
                  <line x1={cx + 8} x2={cx + 24} y1={120} y2={120} />
                  <line x1={cx} x2={cx} y1={96} y2={112} />
                  <line x1={cx} x2={cx} y1={128} y2={144} />
                </>
              );
            })()}
          </g>
        )}
        <rect x={604} y={40} width={14} height={260} fill="url(#thermal-scale)" rx={3} />
        <text x={598} y={46} textAnchor="end" fill="#fff" fontSize={10}>{hi} °C</text>
        <text x={598} y={300} textAnchor="end" fill="#fff" fontSize={10}>{lo} °C</text>
      </svg>
    </FeedChrome>
  );
}

/* ───────────────────────────── area / dock / stores ───────────────────────────── */

function AreaFeed({ state, camera }: { state: FactoryState; camera: Camera }) {
  const tick = state.clock.tick;
  const model = useMemo(() => isoModelFromState(state), [state, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = useMemo(() => cameraView(state, camera), [state, camera]);
  const focusId = camera.kind === "dock" ? "zone:dock" : camera.id === "CCTV-STORES" ? "zone:stores" : camera.lineId ? `line:${camera.lineId}` : null;
  const zoom = camera.kind === "dock" ? 1.9 : camera.id === "CCTV-STORES" ? 2.2 : 1.55;
  const highlight = useMemo(() => (camera.covers.length ? { assetIds: camera.covers, lineIds: [], targetAssetId: null, rerouteLineId: null } : null), [camera.covers]);
  return (
    <FeedChrome
      camera={camera}
      state={state}
      footer={<span className="truncate rounded bg-black/60 px-1.5 py-0.5 font-medium text-white @max-lg:hidden">{view.headline}</span>}
      overlay={
        <div className="absolute top-9 left-2 space-y-1 @max-lg:hidden">
          {view.detections.slice(0, 3).map((d) => (
            <div key={d.label} className="flex items-center gap-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] text-white">
              <span className={cn("h-1.5 w-1.5 rounded-full", d.tone === "bad" ? "bg-red-500" : d.tone === "warn" ? "bg-amber-400" : d.tone === "ok" ? "bg-emerald-400" : "bg-sky-400")} />
              {d.label}
            </div>
          ))}
        </div>
      }
    >
      <div className="h-full w-full" style={{ ...DARK_ISO, background: "#060a14", filter: "saturate(0.7) contrast(1.05)" }}>
        <IsoScene model={model} labels="none" camera={{ focusId, zoom }} highlight={camera.kind === "area" && camera.lineId ? highlight : null} className="h-full w-full" />
      </div>
    </FeedChrome>
  );
}

/* ───────────────────────────── real stream ───────────────────────────── */

export function RealStream({ kind, url }: { kind: GatewayKind; url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    const video = ref.current;
    if (!video || kind === "mjpeg") return;
    if (kind === "mp4") {
      video.src = url;
      return;
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      return;
    }
    let destroyed = false;
    let hls: { destroy: () => void } | null = null;
    import("hls.js").then(({ default: Hls }) => {
      if (destroyed) return;
      if (!Hls.isSupported()) {
        setError("HLS playback is not supported in this browser.");
        return;
      }
      const h = new Hls({ lowLatencyMode: true });
      h.on(Hls.Events.ERROR, (_e: unknown, data: { fatal?: boolean; details?: string }) => {
        if (data?.fatal) setError(`Stream error: ${data.details ?? "unknown"}`);
      });
      h.loadSource(url);
      h.attachMedia(video);
      hls = h;
    });
    return () => {
      destroyed = true;
      hls?.destroy();
    };
  }, [kind, url]);
  return (
    <div className="relative h-full w-full bg-black">
      {kind === "mjpeg" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Live camera stream" className="h-full w-full object-contain" onError={() => setError("Could not load the MJPEG stream.")} />
      ) : (
        <video ref={ref} className="h-full w-full object-contain" autoPlay muted playsInline controls onError={() => setError("Could not play this stream. Check the gateway address.")} />
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center text-[13px] text-white">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> {error}
          </span>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── chrome ───────────────────────────── */

function FeedChrome({
  camera,
  state,
  children,
  footer,
  overlay,
  caption,
  source = "twin",
  stamp,
}: {
  camera: Camera;
  state: FactoryState;
  children: ReactNode;
  footer?: ReactNode;
  overlay?: ReactNode;
  caption?: string;
  source?: "twin" | "footage";
  /** Replaces the plant-time stamp (reference footage is not from this plant's clock). */
  stamp?: ReactNode;
}) {
  // Container queries: the same feed is a small tile on the camera wall and a large live view.
  return (
    <div className="@container relative h-full w-full overflow-hidden bg-black font-mono text-[11px] whitespace-nowrap text-white @max-lg:text-[9.5px]">
      {children}
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.03)_0px,rgba(255,255,255,0.03)_1px,transparent_1px,transparent_3px)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.55))]" />
      <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-2 @max-lg:inset-x-1.5 @max-lg:top-1.5">
        <span className="truncate rounded bg-black/60 px-1.5 py-0.5">
          {camera.id}
          <span className="@max-lg:hidden"> · {camera.resolution}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {source === "twin" && (
            <span className="rounded bg-amber-500/90 px-1.5 py-0.5 font-semibold text-black">
              <span className="@max-lg:hidden">TWIN FEED</span>
              <span className="@lg:hidden">TWIN</span>
            </span>
          )}
          {source === "footage" && (
            <span className="rounded bg-sky-400/95 px-1.5 py-0.5 font-semibold text-black">
              <span className="@max-lg:hidden">REFERENCE FOOTAGE</span>
              <span className="@lg:hidden">REF</span>
            </span>
          )}
          <span className="flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5">
            {source === "footage" ? (
              <>
                <Repeat className="h-2.5 w-2.5" /> LOOP
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> REC
              </>
            )}
          </span>
        </span>
      </div>
      {overlay}
      <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2 @max-lg:inset-x-1.5 @max-lg:bottom-1.5">
        {stamp ?? <span className="shrink-0 rounded bg-black/60 px-1.5 py-0.5">{fmtSimTime(state, state.clock.hour)}</span>}
        {footer}
      </div>
      {caption && <div className="absolute inset-x-0 top-9 text-center text-[10px] text-white/70 @max-lg:hidden">{caption}</div>}
    </div>
  );
}

/* ───────────────────────────── reference footage ───────────────────────────── */

function FootageFeed({ state, camera, clip, live }: { state: FactoryState; camera: Camera; clip: FootageClip; live: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <FeedChrome
      camera={camera}
      state={state}
      source="footage"
      stamp={
        <span className="truncate rounded bg-black/60 px-1.5 py-0.5 @max-lg:hidden">
          Not this plant · {clip.source.author} / {clip.source.site} · {clip.source.license}
        </span>
      }
      caption={live ? `Reference footage, looped: ${clip.title}` : undefined}
    >
      <video
        key={clip.src}
        src={clip.src}
        poster={clip.poster}
        className="h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        preload={live ? "auto" : "metadata"}
        onError={() => setFailed(true)}
        aria-label={`Reference footage: ${clip.title}`}
      />
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center text-[12px] whitespace-normal text-white">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" /> Could not play {clip.src}
          </span>
        </div>
      )}
    </FeedChrome>
  );
}

type GatewayKind = "hls" | "mp4" | "mjpeg";

/**
 * Renders a camera. Reference footage plays wherever the camera appears (it is a small local clip);
 * a gateway stream plays in live views only; otherwise the feed is rendered from the twin.
 */
export function CameraFeed({ state, camera, live = false }: { state: FactoryState; camera: Camera; live?: boolean }) {
  if (camera.stream.kind === "footage") {
    const clip = camera.stream.clipId ? getClip(camera.stream.clipId) : null;
    if (clip) return <FootageFeed state={state} camera={camera} clip={clip} live={live} />;
  }
  if (live && camera.stream.kind !== "simulated" && camera.stream.kind !== "footage" && camera.stream.url) return <RealStream kind={camera.stream.kind} url={camera.stream.url} />;
  const twin = camera.stream.kind === "simulated" ? camera : { ...camera, stream: { kind: "simulated" as const, url: null } };
  if (camera.kind === "inspection") return <InspectionFeed state={state} camera={twin} live={live} />;
  if (camera.kind === "thermal") return <ThermalFeed state={state} camera={twin} />;
  return <AreaFeed state={state} camera={twin} />;
}
