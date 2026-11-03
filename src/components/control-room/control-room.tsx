"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clapperboard, Columns2, Film, LayoutGrid, Lock, MonitorPlay, Radio, ScanSearch, Sparkles, Video } from "lucide-react";
import { useAdmin } from "@/client/admin";
import { aiShortName, useAiInfo } from "@/client/ai";
import { contactSheet } from "@/client/frames";
import { integrationState, useIntegrations } from "@/client/integrations";
import { useFactory } from "@/client/store";
import { AdminAccess } from "@/components/admin/admin-access";
import { PageHeader, SectionLabel } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Select, type Tone } from "@/components/ui/primitives";
import { CAMERA_KIND_META, FootageCredit } from "@/components/vision/camera-panel";
import { CameraFeed } from "@/components/vision/feeds";
import { clipsFor, FOOTAGE, getClip, suggestedClip } from "@/domain/footage";
import { cameraView } from "@/domain/quality";
import type { Camera, CameraStreamKind, FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";

type Availability = { aiReview: { ok: boolean; why: string }; opencv: { ok: boolean; why: string } };

const SOURCE: Record<CameraStreamKind, { label: string; tone: Tone }> = {
  simulated: { label: "Twin feed", tone: "warning" },
  footage: { label: "Reference footage", tone: "accent" },
  hls: { label: "HLS gateway", tone: "healthy" },
  mp4: { label: "MP4 gateway", tone: "healthy" },
  mjpeg: { label: "MJPEG gateway", tone: "healthy" },
};

/** Which visual-QA engines this server can run, from the honest integration status. */
function useAvailability(): Availability | null {
  const { data } = useIntegrations();
  if (!data) return null;
  return {
    aiReview: integrationState(data, "meta-ai") === "not-configured" ? { ok: false, why: "AI review is turned off. An admin can turn it on in Integrations." } : { ok: true, why: "" },
    opencv: integrationState(data, "vision-service") === "not-configured" ? { ok: false, why: "The vision service isn't connected yet. An admin can connect it in Integrations." } : { ok: true, why: "" },
  };
}

export function ControlRoom() {
  const state = useFactory((s) => s.state)!;
  const admin = useAdmin((s) => s.admin);
  const setStreams = useFactory((s) => s.setCameraStreams);
  const busy = useFactory((s) => s.busy.cameraStream);
  const [selectedId, setSelectedId] = useState<string>(state.cameras[0]?.id ?? "");
  const [layout, setLayout] = useState<"wall" | "focus">("wall");
  const selected = state.cameras.find((c) => c.id === selectedId) ?? state.cameras[0];

  const counts = useMemo(() => {
    const c = { simulated: 0, footage: 0, gateway: 0 };
    for (const cam of state.cameras) {
      if (cam.stream.kind === "simulated") c.simulated++;
      else if (cam.stream.kind === "footage") c.footage++;
      else c.gateway++;
    }
    return c;
  }, [state.cameras]);

  const allFootage = () =>
    setStreams(
      state.cameras.flatMap((c) => {
        const clip = suggestedClip(c);
        return clip ? [{ id: c.id, kind: "footage" as const, clipId: clip.id }] : [];
      }),
      "Cameras switched to reference footage",
    );
  const allTwin = () => setStreams(state.cameras.map((c) => ({ id: c.id, kind: "simulated" as const })), "All cameras back on the twin feed");

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader
        title="CCTV Control Room"
        eyebrow={
          <span className="flex flex-wrap gap-1.5">
            <Badge tone="neutral">Admin</Badge>
            <Badge tone="warning">{counts.simulated} twin feed</Badge>
            <Badge tone="accent">{counts.footage} reference footage</Badge>
            <Badge tone="healthy">{counts.gateway} gateway</Badge>
          </span>
        }
        description="Every camera in the plant on one wall. Switch each camera between the twin feed, reference footage of real factories, or a live stream from the plant network."
        actions={<AdminAccess />}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="inline-flex rounded-lg border border-line bg-shell p-0.5 text-[12px]" role="group" aria-label="Layout">
            <button onClick={() => setLayout("wall")} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5", layout === "wall" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")} aria-pressed={layout === "wall"}>
              <LayoutGrid className="h-3.5 w-3.5" /> Wall
            </button>
            <button onClick={() => setLayout("focus")} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5", layout === "focus" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")} aria-pressed={layout === "focus"}>
              <Columns2 className="h-3.5 w-3.5" /> Focus
            </button>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!admin && (
              <span className="flex items-center gap-1 text-[11.5px] text-muted">
                <Lock className="h-3 w-3" /> Unlock admin to switch sources
              </span>
            )}
            <Button size="sm" variant="secondary" disabled={!admin || !FOOTAGE.length} loading={busy} onClick={() => void allFootage()} data-testid="all-footage">
              <Film className="h-3.5 w-3.5" /> All to reference footage
            </Button>
            <Button size="sm" variant="secondary" disabled={!admin} loading={busy} onClick={() => void allTwin()} data-testid="all-twin">
              <MonitorPlay className="h-3.5 w-3.5" /> All to twin feed
            </Button>
          </div>
        </div>
        <div className="grid gap-0 xl:grid-cols-[1fr_360px]">
          <div className="min-w-0 bg-[#05070c] p-2.5">
            {layout === "wall" ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="video-wall">
                {state.cameras.map((c) => (
                  <Tile key={c.id} state={state} camera={c} selected={c.id === selected?.id} onSelect={() => setSelectedId(c.id)} />
                ))}
              </div>
            ) : (
              selected && (
                <div className="space-y-2" data-testid="video-wall">
                  <Tile state={state} camera={selected} selected onSelect={() => undefined} large />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {state.cameras
                      .filter((c) => c.id !== selected.id)
                      .map((c) => (
                        <Tile key={c.id} state={state} camera={c} selected={false} onSelect={() => setSelectedId(c.id)} compact />
                      ))}
                  </div>
                </div>
              )
            )}
          </div>
          {selected && <Inspector key={`${selected.id}:${selected.stream.kind}:${selected.stream.clipId ?? selected.stream.url ?? ""}`} state={state} camera={selected} />}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <FootageLibrary selected={selected ?? null} />
        <SwitchLog state={state} />
      </div>
    </div>
  );
}

function Tile({ state, camera, selected, onSelect, large, compact }: { state: FactoryState; camera: Camera; selected: boolean; onSelect: () => void; large?: boolean; compact?: boolean }) {
  const M = CAMERA_KIND_META[camera.kind];
  const src = SOURCE[camera.stream.kind];
  return (
    <div
      className={cn("overflow-hidden rounded-lg border bg-black", selected ? "border-accent ring-1 ring-accent" : "border-white/10 hover:border-white/30")}
      data-testid="control-tile"
      data-camera={camera.id}
      data-source={camera.stream.kind}
    >
      <button className="block aspect-video w-full" onClick={onSelect} aria-label={`Select ${camera.id}`} aria-pressed={selected}>
        <div className="pointer-events-none h-full w-full">
          <CameraFeed state={state} camera={camera} live={!compact} />
        </div>
      </button>
      {!compact && (
        <div className={cn("flex items-center gap-2 border-t border-white/10 bg-[#0b111d] px-2.5 py-1.5 text-white", large && "py-2")}>
          <M.Icon className="h-3.5 w-3.5 shrink-0 text-white/60" />
          <p className="min-w-0 flex-1 truncate text-[12px]">
            <span className="font-mono text-white/60">{camera.id}</span> {camera.name}
          </p>
          <Badge tone={src.tone} className="shrink-0">
            {src.label}
          </Badge>
        </div>
      )}
    </div>
  );
}

function Inspector({ state, camera }: { state: FactoryState; camera: Camera }) {
  const admin = useAdmin((s) => s.admin);
  const setStream = useFactory((s) => s.setCameraStream);
  const analyze = useFactory((s) => s.analyzeCameraFeed);
  const busy = useFactory((s) => s.busy);
  const availability = useAvailability();
  const ai = useAiInfo();
  const [capturing, setCapturing] = useState(false);
  const runAi = async () => {
    const clip = camera.stream.clipId ? getClip(camera.stream.clipId) : null;
    if (ai && !ai.capabilities.video && clip) {
      // This provider reads images, not video: send a sheet of frames captured in the browser.
      setCapturing(true);
      try {
        const sheet = await contactSheet(clip.src);
        await analyze(camera.id, "ai", sheet);
      } finally {
        setCapturing(false);
      }
    } else await analyze(camera.id, "ai");
  };
  const clips = useMemo(() => clipsFor(camera), [camera]);
  const [kind, setKind] = useState<CameraStreamKind>(camera.stream.kind);
  const [clipId, setClipId] = useState(camera.stream.clipId ?? clips[0]?.id ?? "");
  const [url, setUrl] = useState(camera.stream.kind === "footage" || camera.stream.kind === "simulated" ? "" : (camera.stream.url ?? ""));
  const gateway = kind === "hls" || kind === "mp4" || kind === "mjpeg";
  const dirty = kind !== camera.stream.kind || (kind === "footage" && clipId !== camera.stream.clipId) || (gateway && url.trim() !== (camera.stream.url ?? ""));
  const view = useMemo(() => cameraView(state, camera), [state, camera]);
  const reviews = state.visionReviews.filter((r) => r.cameraId === camera.id).slice(0, 3);
  const M = CAMERA_KIND_META[camera.kind];
  const onFootage = camera.stream.kind === "footage";

  const options: { value: CameraStreamKind; label: string; Icon: typeof Video; hint: string; disabled?: boolean }[] = [
    { value: "simulated", label: "Twin feed", Icon: MonitorPlay, hint: "Rendered from the twin's live state" },
    { value: "footage", label: "Reference footage", Icon: Clapperboard, hint: clips.length ? "Real video of a comparable facility, looped" : "No clip suits this camera", disabled: !clips.length },
    { value: "hls", label: "Plant gateway", Icon: Radio, hint: "HLS / MP4 / MJPEG over HTTPS from the plant network" },
  ];

  return (
    <aside className="border-t border-line p-4 xl:border-t-0 xl:border-l" data-testid="camera-inspector">
      <div className="flex items-start gap-2.5">
        <span className="rounded-lg border border-line bg-shell p-2 text-ink-2">
          <M.Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[11.5px] text-muted">{camera.id}</p>
          <p className="truncate text-[14px] font-semibold text-ink">{camera.name}</p>
          <p className="truncate text-[11.5px] text-muted">
            {M.label} · {camera.zone}
          </p>
        </div>
      </div>

      <SectionLabel className="mt-4 mb-1.5">Source</SectionLabel>
      <div className="space-y-1.5" role="radiogroup" aria-label="Camera source">
        {options.map((o) => {
          const active = o.value === "hls" ? gateway : kind === o.value;
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={active}
              disabled={!admin || o.disabled}
              onClick={() => setKind(o.value === "hls" ? (gateway ? kind : "hls") : o.value)}
              className={cn(
                "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                active ? "border-accent/60 bg-accent/5" : "border-line hover:border-line-strong",
              )}
            >
              <o.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-accent" : "text-muted")} />
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-ink">{o.label}</span>
                <span className="block text-[11.5px] text-muted">{o.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {kind === "footage" && clips.length > 0 && (
        <div className="mt-2 space-y-1">
          <Label htmlFor="cr-clip">Clip</Label>
          <Select id="cr-clip" className="w-full" value={clipId} disabled={!admin} onChange={(e) => setClipId(e.target.value)}>
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} ({c.durationSec}s)
              </option>
            ))}
          </Select>
        </div>
      )}
      {gateway && (
        <div className="mt-2 grid grid-cols-[96px_1fr] gap-2">
          <div className="space-y-1">
            <Label htmlFor="cr-kind">Format</Label>
            <Select id="cr-kind" className="w-full" value={kind} disabled={!admin} onChange={(e) => setKind(e.target.value as CameraStreamKind)}>
              <option value="hls">HLS</option>
              <option value="mp4">MP4</option>
              <option value="mjpeg">MJPEG</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cr-url">Gateway URL</Label>
            <Input id="cr-url" placeholder="https://gateway.plant.example/cam/index.m3u8" value={url} disabled={!admin} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <p className="col-span-2 text-[11px] leading-relaxed text-muted">
            Paste the HLS, MP4 or MJPEG address your camera gateway publishes over HTTPS.
          </p>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={!admin || !dirty || (kind === "footage" && !clipId) || (gateway && !url.trim())}
          loading={busy.cameraStream}
          onClick={() => void setStream(camera.id, kind, gateway ? url.trim() : null, kind === "footage" ? clipId : null)}
          data-testid="apply-source"
        >
          Switch source
        </Button>
        {!admin && <span className="text-[11.5px] text-muted">Admin only</span>}
      </div>
      {onFootage && <FootageCredit clipId={camera.stream.clipId ?? null} className="mt-3" />}

      <SectionLabel className="mt-5 mb-1.5">Visual QA on this feed</SectionLabel>
      {onFootage ? (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={busy.feedAi || capturing}
              disabled={availability ? !availability.aiReview.ok : false}
              title={availability?.aiReview.why}
              onClick={() => void runAi()}
              data-testid="qa-ai"
            >
              <Sparkles className="h-3.5 w-3.5" /> {aiShortName(ai)} review
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={busy.feedOpencv}
              disabled={availability ? !availability.opencv.ok : false}
              title={availability?.opencv.why}
              onClick={() => void analyze(camera.id, "opencv")}
              data-testid="qa-opencv"
            >
              <ScanSearch className="h-3.5 w-3.5" /> OpenCV motion check
            </Button>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
            {ai?.model ?? "The AI model"} describes what it sees in the plant&apos;s defect categories{ai && !ai.capabilities.video && ai.capabilities.available ? " (from four frames captured in your browser)" : ""}; OpenCV measures motion, still periods and codes. Both are advisory: results wait in{" "}
            <Link href="/quality#reviews" className="text-accent-ink hover:underline">
              Visual Quality
            </Link>{" "}
            for a person to confirm or dismiss.
            {availability && !availability.aiReview.ok && ` ${availability.aiReview.why}`}
            {availability && !availability.opencv.ok && ` ${availability.opencv.why}`}
          </p>
        </>
      ) : (
        <p className="text-[11.5px] leading-relaxed text-muted">
          {camera.stream.kind === "simulated"
            ? "Switch this camera to reference footage to run the AI review and OpenCV on real video. On the twin feed, inspection cameras can review their station log in Visual Quality."
            : "Gateway streams are analysed by the edge worker on the plant network, so frames never leave the site."}
        </p>
      )}
      {reviews.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-lg border border-line bg-shell p-2 text-[11.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-muted">
                  {r.id} · {r.source === "opencv" ? "OpenCV" : r.source === "ai" ? "AI review" : "Station log"}
                </span>
                <Badge tone={r.disposition === "pending-human-review" ? "warning" : r.disposition === "confirmed" ? "healthy" : "neutral"}>{r.disposition.replace(/-/g, " ")}</Badge>
              </div>
              <p className="mt-1 line-clamp-3 leading-snug text-ink-2">{r.summary}</p>
            </li>
          ))}
        </ul>
      )}

      <SectionLabel className="mt-5 mb-1">What the twin says</SectionLabel>
      <p className="text-[12px] text-ink-2">{view.headline}</p>
    </aside>
  );
}

function FootageLibrary({ selected }: { selected: Camera | null }) {
  const admin = useAdmin((s) => s.admin);
  const setStream = useFactory((s) => s.setCameraStream);
  return (
    <Card>
      <CardHeader
        title="Reference footage library"
        description="Openly licensed clips of real factories, credited to their authors."
        icon={<Film className="h-4 w-4" />}
      />
      <CardBody>
        {FOOTAGE.length === 0 ? (
          <p className="text-[12.5px] text-muted">No footage is installed.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FOOTAGE.map((clip) => {
              const fits = selected ? clipsFor(selected).some((c) => c.id === clip.id) : false;
              return (
                <div key={clip.id} className="overflow-hidden rounded-xl border border-line bg-shell" data-testid="footage-clip">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={clip.poster} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                  <div className="space-y-1 p-2.5">
                    <p className="text-[12.5px] font-medium text-ink">{clip.title}</p>
                    <p className="text-[11.5px] leading-snug text-ink-2">{clip.shows}</p>
                    <p className="text-[11px] text-muted">
                      {clip.durationSec}s · {clip.width}×{clip.height} ·{" "}
                      <a href={clip.source.pageUrl} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
                        {clip.source.author} / {clip.source.site}
                      </a>{" "}
                      ·{" "}
                      <a href={clip.source.licenseUrl} target="_blank" rel="noreferrer" className="hover:underline">
                        {clip.source.license}
                      </a>
                    </p>
                    {admin && selected && fits && (
                      <Button size="xs" variant="ghost" className="-ml-1.5" onClick={() => void setStream(selected.id, "footage", null, clip.id)}>
                        Play on {selected.id}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SwitchLog({ state }: { state: FactoryState }) {
  const entries = state.audit.filter((e) => /^Camera .* switched to|^Live view opened|^Integration settings changed/.test(e.title)).slice(0, 8);
  return (
    <Card>
      <CardHeader title="Control room log" description="Source switches and live views, from the audit trail" icon={<Video className="h-4 w-4" />} />
      <CardBody>
        {entries.length === 0 ? (
          <p className="text-[12.5px] text-muted">No camera changes yet.</p>
        ) : (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="text-[12px]">
                <p className="text-ink">{e.title}</p>
                <p className="text-[11px] text-muted">
                  {new Date(e.at).toLocaleTimeString()} · {e.actor}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Link href="/audit" className="mt-3 inline-block text-[12px] text-accent-ink hover:underline">
          Full audit trail →
        </Link>
      </CardBody>
    </Card>
  );
}


