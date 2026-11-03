"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileVideo, Image as ImageIcon, ScanEye, ScanSearch, Sparkles, Upload, X } from "lucide-react";
import { aiShortName, useAiInfo } from "@/client/ai";
import { contactSheet } from "@/client/frames";
import { useIntegrations } from "@/client/integrations";
import { useFactory } from "@/client/store";
import type { FactoryState, VisionFinding, VisionReview } from "@/domain/types";
import type { InspectionResult } from "@/domain/vision";
import { cn } from "@/lib/cn";
import { fmtSimTime } from "@/lib/format";
import { Badge, Button, EmptyState, Input, Label, Select } from "../ui/primitives";

const SEVERITY_TONE: Record<VisionFinding["severity"], "neutral" | "warning" | "critical" | "accent"> = { info: "accent", minor: "neutral", major: "warning", critical: "critical" };
const ACCEPT = "video/mp4,video/webm,video/quicktime,image/jpeg,image/png,image/webp";

type Status = { state: string; detail: string } | null;

/** Reads the honest integration status so an uploader never pretends a service is available. */
function useIntegrationStatus(ids: string[], refresh = 0): Record<string, Status> {
  const { data, error } = useIntegrations({ refresh });
  if (error) return Object.fromEntries(ids.map((id) => [id, { state: "error", detail: "Could not read integration status." }]));
  if (!data) return {};
  return Object.fromEntries(
    ids.map((id) => {
      const v = data.integrations.find((i) => i.id === id);
      return [id, v ? { state: v.state, detail: v.detail } : { state: "not-configured", detail: "" }];
    }),
  );
}

function StatusBadge({ status }: { status: Status | undefined }) {
  return (
    <Badge tone={status?.state === "connected" ? "healthy" : status?.state === "not-configured" ? "neutral" : status?.state === "error" ? "critical" : "accent"} className="ml-auto">
      {!status ? "checking…" : status.state === "not-configured" ? "not configured" : status.state.replace(/-/g, " ")}
    </Badge>
  );
}

export function ReviewTools({ state }: { state: FactoryState }) {
  const analyze = useFactory((s) => s.analyzeMedia);
  const reviewLog = useFactory((s) => s.reviewInspectionLog);
  const busyAnalyze = useFactory((s) => s.busy.visionAnalyze);
  const busyLog = useFactory((s) => s.busy.visionReview);
  const [refresh, setRefresh] = useState(0);
  const status = useIntegrationStatus(["meta-ai", "vision-service"], refresh);
  const aiReview = status["meta-ai"];
  const ai = useAiInfo(refresh);
  const name = aiShortName(ai);
  const [capturing, setCapturing] = useState(false);
  const inspection = state.cameras.filter((c) => c.kind === "inspection");
  const [cameraId, setCameraId] = useState(inspection[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const available = aiReview && aiReview.state !== "not-configured";
  const tooBig = !!file && file.size > 15 * 1024 * 1024;
  const [lastAi, setLastAi] = useState<{ review: VisionReview; url: string } | null>(null);
  const [defect, setDefect] = useState("solder bridge");
  const [generating, setGenerating] = useState(false);
  const toast = useFactory((s) => s.toast);
  const samplePhoto = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/vision/sample", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ defect }) });
      const data = (await res.json().catch(() => ({}))) as { image?: string; mimeType?: string; error?: string };
      if (!res.ok || !data.image) throw new Error(data.error ?? `Generation failed (${res.status})`);
      const blob = await (await fetch(data.image)).blob();
      setFile(new File([blob], `synthetic-${(defect || "good-part").replace(/\W+/g, "-")}.png`, { type: data.mimeType ?? "image/png" }));
    } catch (e) {
      toast({ tone: "error", title: "Test photo failed", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setGenerating(false);
    }
  };
  useEffect(() => () => void (lastAi && URL.revokeObjectURL(lastAi.url)), [lastAi]);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-line bg-shell p-3.5">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <ScanSearch className="h-4 w-4 text-accent" /> Review an inspection station&apos;s log
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Replays the last 60 units the selected station inspected and lists every reject with its acceptance criterion.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="log-cam">Station</Label>
            <Select id="log-cam" className="w-full" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
              {inspection.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {c.zone}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" variant="secondary" loading={busyLog} disabled={!cameraId} onClick={() => void reviewLog(cameraId)}>
            Review last 60 units
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-shell p-3.5">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Sparkles className="h-4 w-4 text-agent" /> Review footage with {name}
          <StatusBadge status={aiReview} />
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Upload a short clip or photo (MP4, WebM, MOV, JPEG, PNG, WebP; up to 15 MB). {ai?.model ?? "The AI model"} reports what it can see using fixed defect categories.
          {ai && !ai.capabilities.video && ai.capabilities.available ? " This provider reads images, so a clip is sent as a sheet of four frames captured in your browser." : ""} Results are advisory and wait for your decision.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="vision-file" />
          <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={!available}>
            <Upload className="h-3.5 w-3.5" /> {file ? "Change file" : "Choose file"}
          </Button>
          <Select aria-label="Station for uploaded footage" className="min-w-0 flex-1" value={cameraId} onChange={(e) => setCameraId(e.target.value)} disabled={!available}>
            {state.cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.zone}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            variant="agent"
            loading={busyAnalyze || capturing}
            disabled={!available || !file || tooBig}
            onClick={async () => {
              if (!file) return;
              let r;
              if (file.type.startsWith("video/") && ai && !ai.capabilities.video) {
                setCapturing(true);
                try {
                  const sheet = await contactSheet(file);
                  r = await analyze(sheet.blob, cameraId || null, sheet.times, `${file.name} (frames).jpg`);
                } finally {
                  setCapturing(false);
                }
              } else r = await analyze(file, cameraId || null);
              if (r && file.type.startsWith("image/")) setLastAi({ review: r, url: URL.createObjectURL(file) });
              if (r) {
                setFile(null);
                if (input.current) input.current.value = "";
              }
            }}
          >
            Analyze
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select aria-label="Synthetic defect" className="w-40" value={defect} onChange={(e) => setDefect(e.target.value)} disabled={!available}>
            {["solder bridge", "missing component", "scratch", "burn mark", ""].map((d) => (
              <option key={d} value={d}>
                {d || "no defect (good part)"}
              </option>
            ))}
          </Select>
          <Button size="sm" variant="outline" loading={generating} disabled={!available} onClick={samplePhoto} data-testid="vision-sample">
            <ImageIcon className="h-3.5 w-3.5" /> Generate a synthetic test photo (Muse Image)
          </Button>
        </div>
        {file && (
          <p className={cn("mt-2 flex items-center gap-1.5 text-[11.5px]", tooBig ? "text-critical-ink" : "text-ink-2")}>
            <FileVideo className="h-3.5 w-3.5" /> {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB{tooBig ? " — over the 15 MB limit" : ""}
          </p>
        )}
        {lastAi && <AiPreview review={lastAi.review} url={lastAi.url} />}
        {aiReview?.state === "not-configured" && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-warning-ink">
            {ai?.disabled ? "AI review is turned off" : "AI review isn't set up"}. An admin can turn it on in Integrations. The station-log review and the machine-vision check still work.
          </p>
        )}
      </div>

      <MachineVisionCard state={state} status={status["vision-service"]} defaultCameraId={cameraId} onDone={() => setRefresh((n) => n + 1)} />
    </div>
  );
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/bmp";
const MV_ACCEPT = `${IMAGE_ACCEPT},video/mp4,video/webm,video/quicktime,video/x-msvideo,.avi`;
const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function MachineVisionCard({ state, status, defaultCameraId, onDone }: { state: FactoryState; status: Status | undefined; defaultCameraId: string; onDone: () => void }) {
  const inspect = useFactory((s) => s.inspectWithService);
  const busy = useFactory((s) => s.busy.visionInspect);
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [cameraId, setCameraId] = useState(defaultCameraId);
  const [last, setLast] = useState<{ result: InspectionResult; url: string; reviewId: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const available = !!status && status.state !== "not-configured";
  const isVideo = !!file && (file.type.startsWith("video/") || /\.(mp4|m4v|webm|mov|avi)$/i.test(file.name));
  const tooBig = !!file && file.size > (isVideo ? 30 : 15) * 1024 * 1024;
  useEffect(() => () => void (last && URL.revokeObjectURL(last.url)), [last]);

  return (
    <div className="rounded-xl border border-line bg-shell p-3.5 lg:col-span-2" data-testid="machine-vision">
      <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <ScanEye className="h-4 w-4 text-accent" /> Machine-vision check
        <StatusBadge status={status} />
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        Repeatable checks: the same input always gives the same result. For an <strong className="font-medium text-ink-2">image</strong>: is it sharp and well lit enough to judge, which barcodes and QR codes are on it, and, with a
        photo of a known-good part as the golden reference, which regions differ from it. For a <strong className="font-medium text-ink-2">video</strong>: when the scene stops moving (possible line stoppage). Findings
        are measurements for you to judge, not verdicts.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <input ref={fileInput} type="file" accept={MV_ACCEPT} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="mv-file" />
        <input ref={refInput} type="file" accept={IMAGE_ACCEPT} className="hidden" onChange={(e) => setReference(e.target.files?.[0] ?? null)} data-testid="mv-reference" />
        <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={!available}>
          <Upload className="h-3.5 w-3.5" /> {file ? "Change part image / clip" : "Part image or clip"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => refInput.current?.click()} disabled={!available || isVideo}>
          <ImageIcon className="h-3.5 w-3.5" /> {reference ? "Change golden reference" : "Golden reference (optional)"}
        </Button>
        <Select aria-label="Station for the machine-vision check" className="min-w-0 flex-1" value={cameraId} onChange={(e) => setCameraId(e.target.value)} disabled={!available}>
          {state.cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} · {c.zone}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={!available || !file || tooBig}
          onClick={async () => {
            if (!file) return;
            const r = await inspect(file, isVideo ? null : reference, cameraId || null);
            if (r) setLast({ result: r.result, url: URL.createObjectURL(file), reviewId: r.review.id });
            onDone();
          }}
        >
          Inspect
        </Button>
      </div>
      {(file || reference) && (
        <p className={cn("mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]", tooBig ? "text-critical-ink" : "text-ink-2")}>
          {file && (
            <span className="flex items-center gap-1.5">
              <FileVideo className="h-3.5 w-3.5" /> {file.name} · {sizeText(file.size)}{tooBig ? ` — over the ${isVideo ? 30 : 15} MB limit` : ""}
            </span>
          )}
          {reference && !isVideo && (
            <span className="flex items-center gap-1.5 text-muted">
              golden: {reference.name}
              <button className="hover:text-ink" onClick={() => setReference(null)} aria-label="Remove golden reference">
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </p>
      )}
      {status?.state === "not-configured" && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-warning-ink">
          The vision service isn&apos;t connected yet. An admin can connect it in Integrations.
        </p>
      )}
      {last && <InspectionPreview result={last.result} url={last.url} reviewId={last.reviewId} />}
    </div>
  );
}

/** The reviewed photo with the regions SAM 3.1 located for each finding. */
function AiPreview({ review, url }: { review: VisionReview; url: string }) {
  const located = review.findings.filter((f) => f.box);
  return (
    <div className="mt-3 space-y-1.5" data-testid="ai-preview">
      <div className="relative w-fit max-w-full overflow-hidden rounded-lg border border-line bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Reviewed photo" className="block max-h-64 max-w-full" />
        {located.map((f, i) => (
          <span key={i} className="absolute border-2 border-violet-400" style={{ left: `${f.box!.x * 100}%`, top: `${f.box!.y * 100}%`, width: `${f.box!.w * 100}%`, height: `${f.box!.h * 100}%` }} title={f.description}>
            <span className="absolute -top-4 left-0 rounded-sm bg-violet-500 px-1 text-[9.5px] leading-4 font-semibold whitespace-nowrap text-white">{f.category}</span>
          </span>
        ))}
      </div>
      <p className="text-[11.5px] text-muted">
        {review.id} · {review.model} · {located.length ? `${located.length} finding(s) located on the image` : "no regions located"} · pending your review below.
      </p>
    </div>
  );
}

function InspectionPreview({ result, url, reviewId }: { result: InspectionResult; url: string; reviewId: string }) {
  if (result.kind === "image") {
    const defects = result.comparison?.defects ?? [];
    return (
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_260px]" data-testid="mv-preview">
        <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-lg border border-line bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Inspected part" className="block max-h-80 max-w-full" />
          {defects.map((d, i) => (
            <span key={`d${i}`} className="absolute border-2 border-red-500" style={{ left: `${d.box.x * 100}%`, top: `${d.box.y * 100}%`, width: `${d.box.w * 100}%`, height: `${d.box.h * 100}%` }}>
              <span className="absolute -top-4 left-0 rounded-sm bg-red-500 px-1 text-[9.5px] leading-4 font-semibold text-white">{i + 1}</span>
            </span>
          ))}
          {result.codes.map((c, i) =>
            c.box ? (
              <span key={`c${i}`} className="absolute border-2 border-sky-400" style={{ left: `${c.box.x * 100}%`, top: `${c.box.y * 100}%`, width: `${c.box.w * 100}%`, height: `${c.box.h * 100}%` }} />
            ) : null,
          )}
        </div>
        <div className="space-y-1.5 text-[12px]">
          <p className="font-medium text-ink">
            {reviewId} · {result.engine}
          </p>
          <p className={result.quality.usable ? "text-healthy-ink" : "text-warning-ink"}>
            {result.quality.usable ? "Image usable for inspection" : `Not usable: ${result.quality.issues.join(", ")}`}
          </p>
          <p className="text-ink-2">
            Sharpness {result.quality.sharpness} · brightness {result.quality.brightness} · contrast {result.quality.contrast}
          </p>
          {result.comparison ? (
            <p className="text-ink-2">
              <span className="font-medium text-ink">{defects.length}</span> region{defects.length === 1 ? " differs" : "s differ"} from the golden reference
              <span className="text-muted"> · {result.comparison.alignment === "homography" ? `aligned (${result.comparison.inliers} matches)` : "not aligned"}</span>
            </p>
          ) : (
            <p className="text-muted">No golden reference, so parts were not compared.</p>
          )}
          {result.codes.map((c) => (
            <p key={`${c.format}${c.data}`} className="text-ink-2">
              <span className="text-sky-500">■</span> {c.format} <span className="font-mono text-ink">{c.data}</span> · grade {c.contrastGrade ?? "—"} (indicative)
            </p>
          ))}
          <p className="text-[11px] text-muted">{result.durationMs} ms · findings added below, awaiting your decision.</p>
        </div>
      </div>
    );
  }
  const total = Math.max(result.analysedSec, 0.001);
  return (
    <div className="mt-3 space-y-2" data-testid="mv-preview">
      <div className="flex h-5 overflow-hidden rounded-md border border-line" role="img" aria-label="Motion timeline">
        {result.segments.map((s, i) => (
          <span
            key={i}
            title={`${s.state} ${s.startSec}–${s.endSec} s`}
            className={s.state === "moving" ? "bg-healthy/70" : "bg-warning/80"}
            style={{ width: `${((s.endSec - s.startSec) / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted">
        <span>0 s</span>
        <span>
          <span className="text-healthy-ink">■</span> moving {result.movingPct}% · <span className="text-warning-ink">■</span> still
        </span>
        <span>{result.analysedSec.toFixed(1)} s</span>
      </div>
      <p className="text-[12px] text-ink-2">
        {reviewId} · {result.stillPeriods.length ? result.stillPeriods.map((p) => `still ${p.startSec.toFixed(1)}–${p.endSec.toFixed(1)} s`).join(" · ") : "no still periods"} · {result.framesAnalysed} frames ·{" "}
        {result.durationMs} ms
      </p>
    </div>
  );
}

export function ReviewList({ state }: { state: FactoryState }) {
  const reviews = state.visionReviews;
  if (!reviews.length) {
    return (
      <EmptyState
        icon={<ScanSearch className="h-5 w-5" />}
        title="No visual reviews yet"
        description="Review a station's inspection log or upload footage. Every review waits for a person to confirm or dismiss it."
      />
    );
  }
  return (
    <div className="space-y-3">
      {reviews.map((r) => (
        <ReviewCard key={r.id} state={state} review={r} />
      ))}
    </div>
  );
}

function ReviewCard({ state, review }: { state: FactoryState; review: VisionReview }) {
  const decide = useFactory((s) => s.dispositionReview);
  const busy = useFactory((s) => s.busy.visionDisposition);
  const [note, setNote] = useState("");
  const [expanded, setExpanded] = useState(review.disposition === "pending-human-review");
  const pending = review.disposition === "pending-human-review";
  const real = review.findings.filter((f) => f.category !== "No defect visible");
  const shown = expanded ? review.findings : review.findings.slice(0, 3);
  return (
    <div className={cn("rounded-xl border bg-surface p-3.5", pending ? "border-warning/40" : "border-line")} data-testid="vision-review">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] text-ink">{review.id}</span>
        <Badge tone={review.source === "ai" ? "agent" : review.source === "opencv" ? "accent" : "neutral"}>
          {review.source === "ai" ? `AI · ${review.model ?? "model"}` : review.source === "opencv" ? (review.model ?? "OpenCV · vision service") : "Station inspection log"}
        </Badge>
        {review.cameraId && <Badge tone="accent">{review.cameraId}</Badge>}
        <span className="text-[11.5px] text-muted">{fmtSimTime(state, review.hour)}</span>
        <Badge tone={pending ? "warning" : review.disposition === "confirmed" ? "healthy" : "neutral"} className="ml-auto">
          {pending ? "Awaiting human review" : review.disposition}
        </Badge>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">{review.summary}</p>
      {review.fileName && <p className="mt-1 text-[11px] text-muted">File: {review.fileName}</p>}
      {review.findings.length > 0 && (
        <div className="mt-2.5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] tracking-wide text-muted uppercase">
                <th className="py-1.5 pr-3 font-medium">{review.source === "simulated-inspection-log" ? "Offset" : "Time"}</th>
                <th className="py-1.5 pr-3 font-medium">Category</th>
                <th className="py-1.5 pr-3 font-medium">Detail</th>
                <th className="py-1.5 pr-3 font-medium">Severity</th>
                <th className="py-1.5 text-right font-medium">Conf.</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="tabular py-1.5 pr-3 text-muted">{f.timestampSec === null ? "—" : `${Math.floor(f.timestampSec / 60)}:${String(Math.round(f.timestampSec % 60)).padStart(2, "0")}`}</td>
                  <td className="py-1.5 pr-3 text-ink">{f.category}</td>
                  <td className="py-1.5 pr-3 text-ink-2">{f.description}</td>
                  <td className="py-1.5 pr-3">
                    <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                  </td>
                  <td className="tabular py-1.5 text-right text-ink-2">{review.source === "ai" ? `${Math.round(f.confidence * 100)}%` : review.source === "opencv" ? "measured" : "logged"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {review.findings.length > 3 && (
            <button className="mt-1 text-[11.5px] text-accent-ink hover:underline" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Show fewer" : `Show all ${review.findings.length} findings`}
            </button>
          )}
        </div>
      )}
      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input className="h-8 min-w-0 flex-1 text-[12.5px]" placeholder="Note (optional), e.g. 'Confirmed at rework bench'" value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Note for ${review.id}`} />
          <Button size="sm" variant="success" loading={busy} onClick={() => void decide(review.id, "confirmed", note)}>
            <Check className="h-3.5 w-3.5" /> Confirm {real.length ? `${real.length} finding${real.length > 1 ? "s" : ""}` : ""}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(review.id, "dismissed", note)}>
            <X className="h-3.5 w-3.5" /> Dismiss
          </Button>
        </div>
      ) : (
        review.note && <p className="mt-2 text-[11.5px] text-muted">Note: “{review.note}”</p>
      )}
    </div>
  );
}
