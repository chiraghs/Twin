"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { create } from "zustand";
import { Cctv, Eye, Lock, Play, ScanEye, ScanSearch, Settings2, ShieldCheck, ThermometerSun, Truck, X } from "lucide-react";
import { useAdmin } from "@/client/admin";
import { useFactory, useUi } from "@/client/store";
import { clipsFor, getClip } from "@/domain/footage";
import { cameraView, type Detection } from "@/domain/quality";
import type { Camera, CameraKind, CameraStreamKind, FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtSimTime } from "@/lib/format";
import { KeyValue, SectionLabel } from "../page";
import { Badge, Button, Dialog, Input, Label, Meter, Select } from "../ui/primitives";
import { CameraFeed } from "./feeds";

export const CAMERA_KIND_META: Record<CameraKind, { label: string; Icon: typeof Cctv }> = {
  area: { label: "Area CCTV", Icon: Cctv },
  inspection: { label: "Inspection camera", Icon: ScanEye },
  thermal: { label: "Thermal camera", Icon: ThermometerSun },
  dock: { label: "Dock CCTV", Icon: Truck },
};

const ANALYTIC_LABEL: Record<string, string> = {
  defects: "Defect detection",
  "ocr-barcode": "Label OCR + barcode grade",
  counting: "Unit counting",
  "line-state": "Line state",
  zone: "Zone monitoring",
  thermal: "Radiometric temperature",
  occupancy: "Occupancy",
};

const TONE_DOT: Record<Detection["tone"], string> = { ok: "bg-healthy", warn: "bg-warning", bad: "bg-critical", info: "bg-accent" };

/* ───────────────────────────── live-view modal (global) ───────────────────────────── */

export const useCameraModal = create<{ openId: string | null; open: (id: string) => void; close: () => void }>((set) => ({
  openId: null,
  open: (id) => set({ openId: id }),
  close: () => set({ openId: null }),
}));

/** Mounted once in the platform shell so any page can open a camera's live view. */
export function CameraDialogHost() {
  const state = useFactory((s) => s.state);
  const openId = useCameraModal((s) => s.openId);
  const close = useCameraModal((s) => s.close);
  const camera = state?.cameras.find((c) => c.id === openId) ?? null;
  if (!state || !camera) return null;
  return <LiveCameraDialog state={state} camera={camera} onClose={close} />;
}

function LiveCameraDialog({ state, camera, onClose }: { state: FactoryState; camera: Camera; onClose: () => void }) {
  const logView = useFactory((s) => s.logCameraView);
  const operator = useUi((s) => s.operator);
  const [openedAt] = useState(() => fmtSimTime(state, state.clock.hour));
  const [source, setSource] = useState<"stream" | "twin">(camera.stream.kind === "simulated" ? "twin" : "stream");
  const [showSettings, setShowSettings] = useState(false);
  const view = useMemo(() => cameraView(state, camera), [state, camera]);
  const meta = CAMERA_KIND_META[camera.kind];

  useEffect(() => {
    void logView(camera.id);
  }, [camera.id, logView]);
  useEffect(() => setSource(camera.stream.kind === "simulated" ? "twin" : "stream"), [camera.stream.kind]);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      className="max-h-[calc(100vh-32px)] max-w-5xl overflow-y-auto"
      title={
        <span className="flex items-center gap-2">
          <meta.Icon className="h-4 w-4 text-accent" />
          <span className="font-mono text-[13px] text-muted">{camera.id}</span> {camera.name}
        </span>
      }
      description={camera.purpose}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0 space-y-2">
          <div className="aspect-video overflow-hidden rounded-xl border border-line-strong bg-black" data-testid="live-feed">
            <CameraFeed state={state} camera={source === "twin" ? { ...camera, stream: { kind: "simulated", url: null } } : camera} live />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
            {camera.stream.kind !== "simulated" ? (
              <div className="inline-flex rounded-lg border border-line bg-shell p-0.5">
                <button onClick={() => setSource("stream")} aria-pressed={source === "stream"} className={cn("h-6 rounded-md px-2", source === "stream" ? "bg-surface-3 text-ink" : "hover:text-ink")}>
                  {camera.stream.kind === "footage" ? "Reference footage" : `${camera.stream.kind.toUpperCase()} stream`}
                </button>
                <button onClick={() => setSource("twin")} aria-pressed={source === "twin"} className={cn("h-6 rounded-md px-2", source === "twin" ? "bg-surface-3 text-ink" : "hover:text-ink")}>
                  Twin feed
                </button>
              </div>
            ) : (
              <span>
                Twin feed, rendered from the live twin. An admin can switch it to reference footage or a camera gateway in the{" "}
                <Link href="/control-room" className="text-accent-ink hover:underline">
                  CCTV control room
                </Link>
                .
              </span>
            )}
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setShowSettings(!showSettings)} aria-expanded={showSettings}>
              <Settings2 className="h-3 w-3" /> Stream source
            </Button>
          </div>
          {camera.stream.kind === "footage" && source === "stream" && <FootageCredit clipId={camera.stream.clipId ?? null} />}
          {showSettings && <StreamSettings camera={camera} />}
        </div>
        <div className="space-y-4">
          <div>
            <SectionLabel className="mb-1.5">Analytics now</SectionLabel>
            <p className="mb-2 text-[13px] font-medium text-ink">{view.headline}</p>
            <Detections items={view.detections} />
          </div>
          {view.occupancy.length > 0 && <Occupancy items={view.occupancy} />}
          <div>
            <SectionLabel className="mb-1">Camera</SectionLabel>
            <KeyValue k="Type" v={meta.label} />
            <KeyValue k="Resolution" v={`${camera.resolution} · ${camera.fps} fps`} />
            <KeyValue k="ONVIF" v={`Profile ${camera.onvifProfile}`} />
            {camera.standard && <p className="mt-1 text-[11.5px] leading-snug text-ink-2">{camera.standard}</p>}
          </div>
          <div className="rounded-lg border border-line bg-shell p-2.5 text-[11.5px] leading-relaxed text-ink-2">
            <p className="mb-1 flex items-center gap-1.5 font-medium text-ink">
              <Lock className="h-3.5 w-3.5 text-accent" /> Access logged
            </p>
            Opened by {operator} at {openedAt}. Recorded in the audit trail. {camera.privacy.faceBlur ? "Faces are blurred. " : ""}Footage kept {camera.privacy.retentionDays} days.
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** Credit line for reference footage: whose video it is, under which license, and that it is not this plant. */
export function FootageCredit({ clipId, className }: { clipId: string | null; className?: string }) {
  const clip = clipId ? getClip(clipId) : null;
  if (!clip) return null;
  return (
    <p className={cn("rounded-lg border border-sky-500/30 bg-sky-500/5 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink-2", className)}>
      <span className="font-medium text-ink">Reference footage, not this plant.</span> {clip.title} — video by{" "}
      <a href={clip.source.pageUrl} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
        {clip.source.author} ({clip.source.site})
      </a>
      ,{" "}
      <a href={clip.source.licenseUrl} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
        {clip.source.license}
      </a>
      . {clip.edits}
    </p>
  );
}

function StreamSettings({ camera }: { camera: Camera }) {
  const setStream = useFactory((s) => s.setCameraStream);
  const busy = useFactory((s) => s.busy.cameraStream);
  const admin = useAdmin((s) => s.admin);
  const loaded = useAdmin((s) => s.loaded);
  const loadAdmin = useAdmin((s) => s.load);
  const [kind, setKind] = useState<CameraStreamKind>(camera.stream.kind);
  const [url, setUrl] = useState(camera.stream.kind === "footage" ? "" : (camera.stream.url ?? ""));
  const clips = useMemo(() => clipsFor(camera), [camera]);
  const [clipId, setClipId] = useState(camera.stream.clipId ?? clips[0]?.id ?? "");
  useEffect(() => {
    if (!loaded) void loadAdmin();
  }, [loaded, loadAdmin]);
  if (!admin)
    return (
      <div className="rounded-xl border border-line bg-shell p-3 text-[12px] text-ink-2">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <Lock className="h-3.5 w-3.5 text-accent" /> Camera sources are managed by an admin
        </p>
        <p className="mt-1">
          Unlock admin in the{" "}
          <Link href="/control-room" className="text-accent-ink hover:underline">
            CCTV control room
          </Link>{" "}
          to switch this camera between the twin feed, reference footage and a plant gateway stream.
        </p>
      </div>
    );
  const gateway = kind === "hls" || kind === "mp4" || kind === "mjpeg";
  return (
    <div className="rounded-xl border border-line bg-shell p-3">
      <div className="grid gap-2 sm:grid-cols-[170px_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="stream-kind">Source</Label>
          <Select id="stream-kind" className="w-full" value={kind} onChange={(e) => setKind(e.target.value as CameraStreamKind)}>
            <option value="simulated">Twin feed</option>
            <option value="footage" disabled={!clips.length}>
              Reference footage
            </option>
            <option value="hls">HLS (.m3u8)</option>
            <option value="mp4">MP4 / WebM</option>
            <option value="mjpeg">MJPEG</option>
          </Select>
        </div>
        {kind === "footage" ? (
          <div className="space-y-1">
            <Label htmlFor="stream-clip">Clip</Label>
            <Select id="stream-clip" className="w-full" value={clipId} onChange={(e) => setClipId(e.target.value)}>
              {clips.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="stream-url">Gateway URL</Label>
            <Input id="stream-url" placeholder="https://gateway.plant.local/cam/stream.m3u8" value={gateway ? url : ""} disabled={!gateway} onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          onClick={() => void setStream(camera.id, kind, gateway ? url.trim() : null, kind === "footage" ? clipId : null)}
        >
          Save
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Paste the HLS, MP4 or MJPEG address your camera gateway publishes over HTTPS.
      </p>
    </div>
  );
}

/* ───────────────────────────── shared bits ───────────────────────────── */

function Detections({ items }: { items: Detection[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((d) => (
        <li key={d.label} className="flex items-start gap-2 text-[12px]">
          <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[d.tone])} />
          <span className="min-w-0 text-ink-2">
            {d.label}
            {d.detail && <span className="text-muted"> · {d.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Occupancy({ items }: { items: { label: string; value: number; of: number; tone: Detection["tone"] }[] }) {
  return (
    <div className="space-y-1.5">
      {items.slice(0, 7).map((o) => (
        <div key={o.label} className="grid grid-cols-[64px_1fr_36px] items-center gap-2 text-[11.5px]">
          <span className="truncate font-mono text-ink-2">{o.label}</span>
          <Meter value={o.value} tone={o.tone === "bad" ? "critical" : o.tone === "warn" ? "warning" : o.tone === "ok" ? "healthy" : "accent"} />
          <span className="tabular text-right text-ink">{o.value}%</span>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────── side card in the twin ───────────────────────────── */

export function CameraPanel({ state, camera, onClose }: { state: FactoryState; camera: Camera; onClose?: () => void }) {
  const openLive = useCameraModal((s) => s.open);
  const reviewLog = useFactory((s) => s.reviewInspectionLog);
  const busy = useFactory((s) => s.busy.visionReview);
  const selectAsset = useUi((s) => s.selectAsset);
  const view = useMemo(() => cameraView(state, camera), [state, camera]);
  const meta = CAMERA_KIND_META[camera.kind];
  const latest = state.visionReviews.find((r) => r.cameraId === camera.id);
  return (
    <div className="flex h-full flex-col" data-testid="camera-panel">
      <div className="border-b border-line px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-lg border border-line bg-surface-2 p-2 text-ink-2">
              <meta.Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[11.5px] text-muted">{camera.id}</p>
              <p className="truncate text-[15px] font-semibold text-ink">{camera.name}</p>
              <p className="truncate text-[11.5px] text-muted">
                {meta.label} · {camera.zone}
              </p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close panel">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {camera.stream.kind === "simulated" ? (
            <Badge tone="accent">Twin feed</Badge>
          ) : camera.stream.kind === "footage" ? (
            <Badge tone="accent">Reference footage</Badge>
          ) : (
            <Badge tone="healthy">{camera.stream.kind.toUpperCase()} gateway</Badge>
          )}
          <Badge tone="neutral">ONVIF {camera.onvifProfile}</Badge>
          {camera.privacy.faceBlur && <Badge tone="neutral">Face blur</Badge>}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <button
          onClick={() => openLive(camera.id)}
          className="group relative block aspect-video w-full overflow-hidden rounded-xl border border-line-strong bg-black text-left"
          aria-label={`Open live view of ${camera.id}`}
        >
          <CameraFeed state={state} camera={camera} />
          <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/35">
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Play className="h-3.5 w-3.5" /> Watch live
            </span>
          </span>
        </button>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => openLive(camera.id)}>
            <Eye className="h-3.5 w-3.5" /> Watch live stream
          </Button>
          {camera.kind === "inspection" && (
            <Button size="sm" variant="secondary" loading={busy} onClick={() => void reviewLog(camera.id)}>
              <ScanSearch className="h-3.5 w-3.5" /> Review last 60 units
            </Button>
          )}
        </div>
        <div>
          <SectionLabel className="mb-1.5">What the camera sees</SectionLabel>
          <p className="mb-2 text-[13px] font-medium text-ink">{view.headline}</p>
          <Detections items={view.detections} />
        </div>
        {view.thermal.length > 0 && (
          <div className="space-y-2">
            <SectionLabel>Thermal targets</SectionLabel>
            {view.thermal.map((t) => (
              <div key={t.assetId} className="space-y-1">
                <div className="flex justify-between text-[12px]">
                  <button className="font-mono text-ink-2 hover:text-accent-ink" onClick={() => selectAsset(t.assetId)}>
                    {t.assetId}
                  </button>
                  <span className="tabular text-ink">
                    {t.temperature.toFixed(1)} °C <span className="text-muted">/ alarm {t.alarm}</span>
                  </span>
                </div>
                <Meter value={(t.temperature / t.trip) * 100} tone={t.temperature >= t.alarm ? "critical" : t.temperature >= t.alarm * 0.85 ? "warning" : "healthy"} />
              </div>
            ))}
          </div>
        )}
        {view.occupancy.length > 0 && (
          <div>
            <SectionLabel className="mb-1.5">{camera.kind === "dock" ? "Trailer loading" : "Rack fill"}</SectionLabel>
            <Occupancy items={view.occupancy} />
          </div>
        )}
        {latest && (
          <div className="rounded-lg border border-line bg-shell p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-ink">
                Latest review <span className="font-mono text-muted">{latest.id}</span>
              </p>
              <Badge tone={latest.disposition === "pending-human-review" ? "warning" : latest.disposition === "confirmed" ? "healthy" : "neutral"}>{latest.disposition.replace(/-/g, " ")}</Badge>
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-ink-2">{latest.summary}</p>
            <Link href="/quality#reviews" className="mt-1.5 inline-block text-[11.5px] text-accent-ink hover:underline">
              Open in Visual Quality →
            </Link>
          </div>
        )}
        <div>
          <SectionLabel className="mb-1">Purpose &amp; standard</SectionLabel>
          <p className="text-[12px] leading-relaxed text-ink-2">{camera.purpose}</p>
          {camera.standard && <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{camera.standard}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {camera.analytics.map((a) => (
              <Badge key={a} tone="accent">
                {ANALYTIC_LABEL[a] ?? a}
              </Badge>
            ))}
          </div>
        </div>
        {camera.covers.length > 0 && (
          <div>
            <SectionLabel className="mb-1.5">Covers</SectionLabel>
            <div className="flex flex-wrap gap-1">
              {camera.covers.map((id) => (
                <button key={id} onClick={() => selectAsset(id)} className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:border-accent/50 hover:text-ink">
                  {id}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <SectionLabel className="mb-1">Device</SectionLabel>
          <KeyValue k="Resolution" v={`${camera.resolution} · ${camera.fps} fps`} />
          <KeyValue k="Retention" v={`${camera.privacy.retentionDays} days`} />
          <KeyValue k="Face blur" v={camera.privacy.faceBlur ? "On" : "Off (no people in frame)"} />
        </div>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Video analytics are advisory. They never replace light curtains, interlocks or other safety functions, and every live view is logged.
        </p>
      </div>
    </div>
  );
}

/** Compact list of the cameras that watch an asset (used in the asset panel). */
export function CamerasWatching({ state, assetId }: { state: FactoryState; assetId: string }) {
  const openLive = useCameraModal((s) => s.open);
  const cams = state.cameras.filter((c) => c.covers.includes(assetId) || c.assetId === assetId);
  if (!cams.length) return null;
  return (
    <div>
      <SectionLabel className="mb-1.5">Cameras on this asset</SectionLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        {cams.map((c) => {
          const M = CAMERA_KIND_META[c.kind];
          return (
            <button
              key={c.id}
              onClick={() => openLive(c.id)}
              className="group overflow-hidden rounded-lg border border-line bg-shell text-left hover:border-accent/50"
              aria-label={`Open live view of ${c.id}`}
            >
              <div className="pointer-events-none aspect-video bg-black">
                <CameraFeed state={state} camera={c} />
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11.5px]">
                <M.Icon className="h-3.5 w-3.5 text-muted" />
                <span className="font-mono text-ink">{c.id}</span>
                <Play className="ml-auto h-3 w-3 text-muted group-hover:text-accent" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
