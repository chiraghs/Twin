"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, ClipboardList, ScanEye, Target, Upload } from "lucide-react";
import { inspectWithAoi } from "@/client/intelligence";
import { useFactory } from "@/client/store";
import { AnalyticsShell } from "@/components/analytics/shell";
import { AXIS_TICK, ChartTooltip, GRID, SERIES } from "@/components/charts/kit";
import { StatTile } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Label, Select } from "@/components/ui/primitives";
import type { VisionInsights } from "@/domain/intelligence";

const VERDICT_TONE: Record<string, "healthy" | "critical" | "warning" | "neutral"> = { PASS: "healthy", FAIL: "critical", REVIEW_REQUIRED: "warning" };

export default function QualityAnalyticsPage() {
  return (
    <AnalyticsShell<VisionInsights>
      feature="vision"
      title="Quality analytics"
      description="AOI inspections of this plant's products on the intelligence backend: yield by line, defect Pareto and how often people confirm what the detector flags. Each inspection waits for a person's decision in Visual Quality."
    >
      {(d, reload) => <Body v={d.insights} reload={reload} />}
    </AnalyticsShell>
  );
}

function Body({ v, reload }: { v: VisionInsights; reload: () => Promise<void> }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Inspected" value={v.counts.inspected} sub={`${v.counts.failed} failed`} icon={<ScanEye className="h-4 w-4" />} />
        <StatTile
          label="First-pass yield"
          value={v.lines.length ? `${(v.lines.reduce((s, l) => s + (l.inspected - l.failed - l.review), 0) / Math.max(1, v.counts.inspected) * 100).toFixed(1)}%` : "—"}
          sub="passed without a defect or review"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <StatTile label="Detector precision" value={v.detectorPrecisionPct != null ? `${v.detectorPrecisionPct}%` : "—"} sub={`${v.dispositions.confirmed} confirmed · ${v.dispositions.dismissed} dismissed by people`} icon={<Target className="h-4 w-4" />} />
        <StatTile label="Awaiting a decision" value={v.dispositions.pending} sub="flagged inspections in Visual Quality" icon={<ClipboardList className="h-4 w-4" />} tone={v.dispositions.pending ? "warning" : "neutral"} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[2fr_3fr]">
        <InspectPanel onDone={reload} />
        <Charts v={v} />
      </div>
      <Recent v={v} />
    </div>
  );
}

function InspectPanel({ onDone }: { onDone: () => Promise<void> }) {
  const state = useFactory((s) => s.state);
  const toast = useFactory((s) => s.toast);
  const cams = state?.cameras.filter((c) => c.kind === "inspection") ?? [];
  const [cameraId, setCameraId] = useState(cams[0]?.id ?? "");
  const [productId, setProductId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = async () => {
    if (!file || !cameraId) return;
    setBusy(true);
    try {
      const review = await inspectWithAoi(file, cameraId, productId || undefined);
      toast({ tone: "success", title: `Inspection stored as ${review.id}`, detail: review.summary.slice(0, 160) });
      setFile(null);
      if (input.current) input.current.value = "";
      await onDone();
    } catch (e) {
      toast({ tone: "error", title: "Inspection failed", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  if (!state) return null;
  return (
    <Card>
      <CardHeader title="Inspect a product image" description="Muse Spark + SAM 3.1 find defects, OpenCV compares against the golden board and IPC-A-610 rules decide. Without MODEL_API_KEY the reference detector runs." />
      <CardBody className="space-y-2.5">
        {cams.length === 0 ? (
          <EmptyState title="No inspection cameras" description="This plant has no AOI or inspection camera." />
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="aoi-cam">Inspection camera</Label>
                <Select id="aoi-cam" className="w-full" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
                  {cams.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="aoi-product">Product</Label>
                <Select id="aoi-product" className="w-full" value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">The line's main product</option>
                  {state.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="aoi-file">Image (JPEG, PNG, WebP or BMP, up to 15 MB)</Label>
              <input id="aoi-file" ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/bmp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[12px] text-ink-2 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-ink" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Link href="/quality" className="text-[12px] text-accent-ink hover:underline">
                Decide in Visual Quality
              </Link>
              <Button size="sm" variant="primary" disabled={!file} loading={busy} onClick={run}>
                <Upload className="h-3.5 w-3.5" /> Inspect
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Charts({ v }: { v: VisionInsights }) {
  if (!v.counts.inspected) {
    return (
      <Card>
        <CardBody>
          <EmptyState title="No inspections yet" description="Inspect a product image to see yield by line and the defect Pareto." />
        </CardBody>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <CardHeader title="First-pass yield by line" />
        <CardBody>
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={v.lines.map((l) => ({ id: l.lineId, fpy: l.fpyPct ?? 0 }))} margin={{ left: 0, right: 8 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="id" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
                <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<ChartTooltip valueFormatter={(x) => `${x}%`} />} />
                <Bar dataKey="fpy" name="First-pass yield" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Defect Pareto" />
        <CardBody>
          {v.pareto.length === 0 ? (
            <EmptyState title="No defects found" description="Every inspection so far passed." />
          ) : (
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={v.pareto.map((p) => ({ id: p.defectClass.replace(/_/g, " ").toLowerCase(), n: p.count }))} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="id" tick={AXIS_TICK} tickLine={false} axisLine={false} width={110} />
                  <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<ChartTooltip />} />
                  <Bar dataKey="n" name="Defects" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Recent({ v }: { v: VisionInsights }) {
  return (
    <Card>
      <CardHeader title="Recent inspections" description="Newest first. The detector and verdict come from the backend; the decision comes from a person in Visual Quality." />
      <CardBody className="overflow-x-auto">
        {v.recent.length === 0 ? (
          <EmptyState title="No inspections yet" />
        ) : (
          <table className="w-full text-[12px]">
            <thead className="text-left text-muted">
              <tr>
                {["Inspection", "Camera", "Line", "Product", "Verdict", "Defects", "Detector", "Decision"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.recent.map((r) => (
                <tr key={r.inspection_id} className="border-t border-line align-top">
                  <td className="px-2 py-1.5 font-mono text-[11.5px] text-ink">{r.inspection_id}</td>
                  <td className="px-2 py-1.5 text-ink-2">{r.camera_id}</td>
                  <td className="px-2 py-1.5 text-ink-2">{r.line_id ?? "—"}</td>
                  <td className="px-2 py-1.5 text-ink-2">{r.product_id ?? "—"}</td>
                  <td className="px-2 py-1.5"><Badge tone={VERDICT_TONE[r.verdict] ?? "neutral"}>{r.verdict.replace("_", " ").toLowerCase()}</Badge></td>
                  <td className="px-2 py-1.5 text-ink-2">{r.defects.length ? r.defects.map((d) => `${d.class.replace(/_/g, " ").toLowerCase()} (${Math.round(d.confidence * 100)}%)`).join(", ") : "none"}</td>
                  <td className="px-2 py-1.5 text-muted">{r.detector ?? "—"}</td>
                  <td className="px-2 py-1.5 text-ink-2">{r.disposition}{r.auditor ? ` · ${r.auditor}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
