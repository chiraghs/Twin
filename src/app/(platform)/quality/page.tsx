"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BadgeCheck, Cctv, Info, Network, Play, ScanEye, ShieldCheck, Waves } from "lucide-react";
import { useFactory, useUi } from "@/client/store";
import { KeyValue, PageHeader, StatTile } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/primitives";
import { CAMERA_KIND_META, useCameraModal } from "@/components/vision/camera-panel";
import { CameraFeed } from "@/components/vision/feeds";
import { CorrelationChart, ParetoChart, RejectTrendChart } from "@/components/vision/quality-charts";
import { ReviewList, ReviewTools } from "@/components/vision/reviews";
import { cameraView, computeQuality, usesIpc } from "@/domain/quality";
import type { FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtInt } from "@/lib/format";

const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;

const STANDARDS = [
  { code: "IPC-A-610J, Class 2", scope: "Acceptance criteria for assembled boards: placement, solder joints, press-fit pins, damage. Class 2 = dedicated-service electronics (industrial controllers)." },
  { code: "IPC J-STD-001", scope: "Soldering process requirements that the AOI classes trace back to." },
  { code: "ISO/IEC 15416 / 15415", scope: "Barcode print-quality grading (1D / 2D) at pack-out. Grade below C fails." },
  { code: "ISO 18434-1", scope: "Condition-monitoring thermography: radiometric camera on the Line A robot cell." },
  { code: "ONVIF Profile S / T", scope: "Interoperable camera streaming and control. Area CCTV uses Profile S; inspection cameras use Profile T (H.264/H.265, metadata)." },
  { code: "AIAG MSA, attribute agreement", scope: "Validate the inspection system against certified inspectors before trusting or tuning its reject limits." },
];

export default function QualityPage() {
  const state = useFactory((s) => s.state)!;
  const tick = state.clock.tick;
  const report = useMemo(() => computeQuality(state, 24), [state, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const openLive = useCameraModal((s) => s.open);
  const pending = state.visionReviews.filter((r) => r.disposition === "pending-human-review").length;
  const worst = [...report.stations].sort((a, b) => b.recentRate / Math.max(1e-6, b.baselineRate) - a.recentRate / Math.max(1e-6, a.baselineRate))[0];
  const corr = report.correlations[0];
  const rising = (s: (typeof report.stations)[number]) => s.recentRate > s.baselineRate * 1.4 && s.recentRate - s.baselineRate > 0.005;

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader
        title="Visual Quality"
        description="Inspection cameras next to production: first-pass yield, DPMO and defect Pareto per station, cross-checked against machine condition. Every camera in the plant is one click away, and every visual finding waits for a person to confirm it."
        eyebrow={
          <span className="flex flex-wrap gap-1.5">
            {usesIpc(state) && (
              <Badge tone="accent">
                <BadgeCheck className="h-3 w-3" /> IPC-A-610J Class 2
              </Badge>
            )}
          </span>
        }
        actions={
          <Button size="sm" variant="secondary" asChild>
            <Link href="/twin">
              <Network className="h-3.5 w-3.5" /> Cameras in the twin
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Units inspected (24 h)" value={fmtInt(report.totalInspected)} sub={`${report.stations.length} stations · 100% inspection`} icon={<ScanEye className="h-4 w-4" />} />
        <StatTile
          label="Rolled throughput yield"
          value={pct(report.rty, 1)}
          sub="Assembly AOI × pack-out verification"
          tone={report.rty < 0.96 ? "warning" : "healthy"}
          icon={<BadgeCheck className="h-4 w-4" />}
        />
        {worst && (
          <StatTile
            label={`${worst.lineName} reject rate`}
            value={pct(worst.recentRate)}
            sub={
              <span className="flex items-center gap-1">
                {worst.recentRate > worst.baselineRate ? <ArrowUpRight className="h-3.5 w-3.5 text-critical-ink" /> : <ArrowDownRight className="h-3.5 w-3.5 text-healthy-ink" />}
                vs {pct(worst.baselineRate)} earlier in the window
              </span>
            }
            tone={rising(worst) ? "critical" : "neutral"}
            icon={<Cctv className="h-4 w-4" />}
          />
        )}
        <StatTile
          label="Strongest machine link"
          value={corr ? `r = ${corr.r.toFixed(2)}` : "—"}
          sub={corr ? `${corr.assetId} vibration ↔ ${state.lines.find((l) => l.id === corr.lineId)?.name ?? corr.lineId} rejects, ${corr.n} h` : "No machine tracks the reject rate"}
          tone={corr && corr.r >= 0.8 ? "warning" : "neutral"}
          icon={<Waves className="h-4 w-4" />}
        />
      </div>

      <Card>
        <CardHeader title="Inspection stations" description="Last 24 h of plant time. Recent = last 2 complete hours. Select a station to watch it." />
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] tracking-wide text-muted uppercase">
                <th className="py-2 pr-3 font-medium">Station</th>
                <th className="py-2 pr-3 font-medium">Criteria</th>
                <th className="py-2 pr-3 text-right font-medium">Inspected</th>
                <th className="py-2 pr-3 text-right font-medium">Rejects</th>
                <th className="py-2 pr-3 text-right font-medium">FPY</th>
                <th className="py-2 pr-3 text-right font-medium">DPMO</th>
                <th className="py-2 pr-3 text-right font-medium">Recent vs earlier</th>
                <th className="py-2 pr-3 font-medium">Top defect class</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {report.stations.map((s) => (
                <tr key={s.camera.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2.5 pr-3">
                    <p className="font-mono text-[12px] text-ink">{s.camera.id}</p>
                    <p className="text-[11.5px] text-muted">{s.lineName}</p>
                  </td>
                  <td className="max-w-[220px] py-2.5 pr-3 text-[11.5px] leading-snug text-ink-2">{s.camera.standard}</td>
                  <td className="tabular py-2.5 pr-3 text-right text-ink">{fmtInt(s.inspected)}</td>
                  <td className="tabular py-2.5 pr-3 text-right text-ink">{fmtInt(s.defects)}</td>
                  <td className="tabular py-2.5 pr-3 text-right text-ink">{pct(s.fpy)}</td>
                  <td className="tabular py-2.5 pr-3 text-right text-ink">{fmtInt(s.dpmo)}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <span className={cn("tabular", rising(s) ? "font-semibold text-critical-ink" : "text-ink-2")}>
                      {pct(s.recentRate)} <span className="text-muted">/ {pct(s.baselineRate)}</span>
                    </span>
                    {rising(s) && (
                      <Badge tone="critical" className="ml-1.5">
                        rising
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-[12px] text-ink-2">
                    {s.defectTypes[0] ? (
                      <>
                        {s.defectTypes[0].type} <span className="text-muted">· {pct(s.defectTypes[0].share, 0)}</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <Button size="xs" variant="ghost" onClick={() => openLive(s.camera.id)} aria-label={`Watch ${s.camera.id}`}>
                      <Play className="h-3 w-3" /> Watch
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            FPY = units passing first time ÷ units inspected. DPMO = defects ÷ (units × opportunities per unit) × 10⁶, using each product&apos;s inspection opportunities. Rolled throughput yield multiplies the station yields along the flow.
          </p>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Defect Pareto (24 h)" description="All stations. Labels show the cumulative share, so you can see which few classes cause most rejects." />
          <CardBody>{report.pareto.length ? <ParetoChart report={report} /> : <EmptyState title="No rejects in the window" />}</CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Is a machine behind the rejects?"
            description={corr ? `Each point is one hour: ${corr.assetId} vibration against the reject rate at ${state.lines.find((l) => l.id === corr.lineId)?.name}'s AOI.` : "Hourly machine vibration against the line's reject rate."}
          />
          <CardBody>
            {corr ? (
              <>
                <CorrelationChart correlation={corr} />
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-2">
                  About +{corr.slope.toFixed(2)} reject-rate points for every extra mm/s. The accelerometer and the camera are separate signals, so agreement between them is stronger evidence than
                  either one alone. Correlation alone does not prove cause; the maintenance agent&apos;s trend analysis supplies the mechanism.
                </p>
              </>
            ) : (
              <EmptyState title="No strong correlation" description="No machine's vibration tracks its line's reject rate (|r| ≥ 0.5) in this window." />
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Reject rate by station, hourly" />
        <CardBody>
          <RejectTrendChart state={state} report={report} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Camera wall" description="Snapshots of every camera in the twin. Select one to open its live view; each opening is written to the audit trail." />
        <CardBody>
          <CameraWall state={state} />
        </CardBody>
      </Card>

      <Card id="reviews">
        <CardHeader
          title="Visual reviews"
          description="Findings from station logs or uploaded footage. Nothing is accepted or rejected automatically; a person confirms or dismisses every review."
          actions={pending > 0 ? <Badge tone="warning">{pending} awaiting review</Badge> : undefined}
        />
        <CardBody className="space-y-4">
          <ReviewTools state={state} />
          <ReviewList state={state} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Standards used" description="What each criterion governs in this twin." />
          <CardBody className="space-y-2.5">
            {STANDARDS.filter((s) => usesIpc(state) || !s.code.startsWith("IPC")).map((s) => (
              <div key={s.code} className="grid gap-1 sm:grid-cols-[190px_1fr] sm:gap-3">
                <p className="text-[12.5px] font-semibold text-ink">{s.code}</p>
                <p className="text-[12px] leading-relaxed text-ink-2">{s.scope}</p>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Safety & privacy" />
          <CardBody className="space-y-3 text-[12px] leading-relaxed text-ink-2">
            <p className="flex gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-healthy" />
              <span>
                Video analytics are advisory. They are not safety functions under IEC 61496 or ISO 13849 and never replace light curtains, interlocks or guarding. Twin never sends commands to
                machines.
              </span>
            </p>
            <p className="flex gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <span>
                Workplace video is personal data under India&apos;s DPDP Act, 2023. Area cameras blur faces, footage is kept for a fixed period, analytics are limited to stated purposes, and every live
                view is logged with who opened it.
              </span>
            </p>
            <div className="rounded-lg border border-line bg-shell p-2.5">
              <KeyValue k="Cameras" v={state.cameras.length} />
              <KeyValue k="Face blur on" v={`${state.cameras.filter((c) => c.privacy.faceBlur).length} of ${state.cameras.length}`} />
              <KeyValue k="Retention" v={`${Math.min(...state.cameras.map((c) => c.privacy.retentionDays))}–${Math.max(...state.cameras.map((c) => c.privacy.retentionDays))} days`} />
              <KeyValue
                k="Live views logged"
                v={
                  <Link href="/audit" className="text-accent-ink hover:underline">
                    {state.audit.filter((e) => e.title.startsWith("Live view opened")).length} in audit trail
                  </Link>
                }
              />
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function CameraWall({ state }: { state: FactoryState }) {
  const openLive = useCameraModal((s) => s.open);
  const selectAsset = useUi((s) => s.selectAsset);
  const views = useMemo(() => Object.fromEntries(state.cameras.map((c) => [c.id, cameraView(state, c)])), [state]);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {state.cameras.map((c) => {
        const M = CAMERA_KIND_META[c.kind];
        const v = views[c.id];
        const alert = v.detections.some((d) => d.tone === "bad");
        return (
          <div key={c.id} className={cn("overflow-hidden rounded-xl border bg-shell", alert ? "border-critical/50" : "border-line")} data-testid="camera-tile">
            <button className="group relative block aspect-video w-full bg-black" onClick={() => openLive(c.id)} aria-label={`Open live view of ${c.id}`}>
              <div className="pointer-events-none h-full w-full">
                <CameraFeed state={state} camera={c} />
              </div>
              <span className="absolute inset-0 flex items-center justify-center transition-colors group-hover:bg-black/35">
                <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-3.5 w-3.5" /> Watch live
                </span>
              </span>
            </button>
            <div className="flex items-start gap-2 px-3 py-2">
              <M.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", alert ? "text-critical" : "text-muted")} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium text-ink">
                  <span className="font-mono text-muted">{c.id}</span> {c.name}
                </p>
                <p className="truncate text-[11.5px] text-ink-2">{v.headline}</p>
              </div>
              <Link
                href="/twin"
                onClick={() => selectAsset(`cam:${c.id}`)}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-ink"
                title="Show in the digital twin"
              >
                In twin
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
