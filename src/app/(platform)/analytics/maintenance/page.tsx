"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, Clock, DollarSign } from "lucide-react";
import { proposeFromInsight } from "@/client/intelligence";
import { useFactory } from "@/client/store";
import { AnalyticsShell, fmtHours, RISK_TONE } from "@/components/analytics/shell";
import { AXIS_TICK, ChartTooltip, GRID, Legend, REFERENCE, SERIES } from "@/components/charts/kit";
import { StatTile } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/primitives";
import type { MaintenanceAssetInsight, MaintenanceInsights } from "@/domain/intelligence";
import { fmtInt } from "@/lib/format";

const RISK_COLOR = { high: "var(--color-critical)", medium: "var(--color-warning)", low: "var(--color-healthy)", "n/a": "var(--color-muted)" } as const;
const ZONES = [
  ["ZONE_A_GOOD", "A · good"],
  ["ZONE_B_ACCEPTABLE", "B · acceptable"],
  ["ZONE_C_UNSATISFACTORY", "C · unsatisfactory"],
  ["ZONE_D_UNACCEPTABLE", "D · unacceptable"],
] as const;

type Row = { sim_hour: number; asset_id: string; health: number; vibration: number; hours_to_trip: number; risk: string };

export default function MaintenanceAnalyticsPage() {
  return (
    <AnalyticsShell<MaintenanceInsights>
      feature="maintenance"
      title="Maintenance analytics"
      description="Remaining useful life, ISO 10816-3 condition and health for every machine in this plant, from the intelligence backend. Propose preventive maintenance here; a person approves it in Approvals."
    >
      {(d) => <Body m={d.insights} series={(d.series ?? []) as Row[]} />}
    </AnalyticsShell>
  );
}

function Body({ m, series }: { m: MaintenanceInsights; series: Row[] }) {
  const running = m.assets.filter((a) => a.status === "running");
  const trending = running.filter((a) => a.hoursToTrip != null).sort((a, b) => a.hoursToTrip! - b.hoursToTrip!);
  const earliest = trending[0];
  const avoidable = running.reduce((s, a) => s + (a.avoidableCost ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="High risk" value={m.counts.high} sub={`${m.counts.medium} medium · ${m.counts.low} low`} icon={<AlertTriangle className="h-4 w-4" />} tone={m.counts.high ? "critical" : m.counts.medium ? "warning" : "healthy"} />
        <StatTile label="Earliest predicted trip" value={earliest ? fmtHours(earliest.hoursToTrip) : "none trending"} sub={earliest ? `${earliest.assetId} · ${earliest.name}` : "no machine is degrading"} icon={<Clock className="h-4 w-4" />} tone={earliest && earliest.hoursToTrip! <= m.imminentHours ? "critical" : "neutral"} />
        <StatTile label="Avoidable repair cost" value={`$${fmtInt(avoidable)}`} sub={`unplanned $${fmtInt(m.unplannedCost)} vs preventive $${fmtInt(m.preventiveCost)} each`} icon={<DollarSign className="h-4 w-4" />} />
        <StatTile label="Machines monitored" value={running.length} sub={`${m.assets.length - running.length} stopped or in maintenance`} icon={<Activity className="h-4 w-4" />} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <RulChart assets={trending.slice(0, 10)} imminent={m.imminentHours} />
        <TrendChart series={series} assets={m.assets} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[2fr_1fr]">
        <HealthHeatmap series={series} assets={running} />
        <ZoneMix mix={m.zoneMix} total={running.length} />
      </div>
      <AssetTable assets={m.assets} />
    </div>
  );
}

function RulChart({ assets, imminent }: { assets: MaintenanceAssetInsight[]; imminent: number }) {
  const data = assets.map((a) => ({ id: a.assetId, hours: Math.min(a.hoursToTrip ?? 0, 500), risk: a.risk, name: a.name }));
  return (
    <Card>
      <CardHeader title="Hours to trip" description={`Machines with a degradation trend, earliest first. Dashed line: the ${imminent} h "imminent" threshold.`} />
      <CardBody>
        {data.length === 0 ? (
          <EmptyState title="No machine is degrading" description="Every running machine's vibration is flat or improving." />
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap={4}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} unit=" h" />
                  <YAxis type="category" dataKey="id" tick={AXIS_TICK} tickLine={false} axisLine={false} width={78} />
                  <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<ChartTooltip valueFormatter={(v) => fmtHours(v)} />} />
                  <ReferenceLine x={imminent} stroke={REFERENCE} strokeDasharray="4 4" />
                  <Bar dataKey="hours" name="Hours to trip" radius={[0, 4, 4, 0]} maxBarSize={16}>
                    {data.map((d) => (
                      <Cell key={d.id} fill={RISK_COLOR[d.risk as keyof typeof RISK_COLOR]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend className="mt-2" items={[{ label: "High risk", color: RISK_COLOR.high }, { label: "Medium", color: RISK_COLOR.medium }, { label: "Low", color: RISK_COLOR.low }]} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Vibration as % of each machine's own trip limit, so machines with different limits share one axis. */
function TrendChart({ series, assets }: { series: Row[]; assets: MaintenanceAssetInsight[] }) {
  const top = assets.filter((a) => a.status === "running" && a.risk !== "low").slice(0, 4);
  const ids = top.length ? top : assets.filter((a) => a.status === "running").slice(0, 3);
  const trip = Object.fromEntries(assets.map((a) => [a.assetId, a.limits?.trip ?? 1]));
  const data = useMemo(() => {
    const byHour = new Map<number, Record<string, number>>();
    for (const r of series) {
      if (!ids.some((a) => a.assetId === r.asset_id)) continue;
      const row = byHour.get(r.sim_hour) ?? { h: r.sim_hour };
      row[r.asset_id] = Math.round((r.vibration / trip[r.asset_id]) * 1000) / 10;
      byHour.set(r.sim_hour, row);
    }
    return [...byHour.values()].sort((a, b) => a.h - b.h);
  }, [series, ids, trip]);
  return (
    <Card>
      <CardHeader title="Vibration vs trip limit" description="Highest-risk machines over the synced history, as a share of each machine's own trip limit (100%)." />
      <CardBody>
        {data.length < 2 ? (
          <EmptyState title="Building history" description="A point is added every sync (15 s). Come back in a minute." />
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ left: 0, right: 16, top: 8 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="h" type="number" domain={["dataMin", "dataMax"]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => `h${Number(v).toFixed(1)}`} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%" domain={[0, (max: number) => Math.max(110, Math.ceil(max / 10) * 10)]} width={44} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `Plant hour ${Number(l).toFixed(1)}`} valueFormatter={(v) => `${v}% of trip`} />} />
                  <ReferenceLine y={100} stroke="var(--color-critical)" strokeDasharray="4 4" label={{ value: "trip", position: "insideTopRight", fill: "var(--color-muted)", fontSize: 11 }} />
                  {ids.map((a, i) => (
                    <Line key={a.assetId} dataKey={a.assetId} name={a.assetId} stroke={SERIES[i % SERIES.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend className="mt-2" items={ids.map((a, i) => ({ label: `${a.assetId} · ${a.name}`, color: SERIES[i % SERIES.length], kind: "line" as const }))} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

/** Health per machine over time: one hue, darker = worse. */
function HealthHeatmap({ series, assets }: { series: Row[]; assets: MaintenanceAssetInsight[] }) {
  // Bucket size adapts to the history: 6-minute cells for a short history, plant hours for a long one.
  const step = useMemo(() => {
    const hs = series.map((r) => r.sim_hour);
    const span = hs.length ? Math.max(...hs) - Math.min(...hs) : 0;
    return span > 12 ? 1 : 0.1;
  }, [series]);
  const bucket = (h: number) => Math.round(Math.floor(h / step) * step * 10) / 10;
  const hours = useMemo(() => [...new Set(series.map((r) => bucket(r.sim_hour)))].sort((a, b) => a - b).slice(-24), [series, step]); // eslint-disable-line react-hooks/exhaustive-deps
  const cell = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of series) m.set(`${r.asset_id}|${bucket(r.sim_hour)}`, r.health);
    return m;
  }, [series, step]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = assets.slice(0, 16);
  return (
    <Card>
      <CardHeader title="Health by machine and hour" description="Darker means lower health score (latest reading in each time bucket). Hover a cell for the value." />
      <CardBody className="overflow-x-auto">
        {hours.length === 0 ? (
          <EmptyState title="Building history" description="Cells appear as the plant is synced." />
        ) : (
          <table className="text-[11px]">
            <tbody>
              {rows.map((a) => (
                <tr key={a.assetId}>
                  <th className="pr-2 text-left font-mono font-normal whitespace-nowrap text-muted">{a.assetId}</th>
                  {hours.map((h) => {
                    const v = cell.get(`${a.assetId}|${h}`);
                    return (
                      <td key={h} className="p-[1px]">
                        <div
                          title={v == null ? `${a.assetId} · h${h}: no reading` : `${a.assetId} · h${h}: health ${Math.round(v * 100)}/100`}
                          className="h-4 w-5 rounded-[3px]"
                          style={{ background: v == null ? "var(--color-surface-2)" : `color-mix(in oklab, var(--color-series-1) ${Math.round(15 + (1 - v) * 85)}%, var(--color-surface-2))` }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td />
                {hours.map((h, i) => (
                  <td key={h} className="pt-1 text-center text-muted">
                    {i % 4 === 0 ? `h${h}` : ""}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}

function ZoneMix({ mix, total }: { mix: Record<string, number>; total: number }) {
  return (
    <Card>
      <CardHeader title="ISO 10816-3 zones" description="Running machines by vibration zone, from each machine's own alarm and trip limits." />
      <CardBody className="space-y-2">
        {ZONES.map(([z, label], i) => {
          const n = mix[z] ?? 0;
          return (
            <div key={z} className="text-[12px]">
              <div className="mb-0.5 flex justify-between">
                <span className="text-ink-2">{label}</span>
                <span className="tabular text-ink">{n}</span>
              </div>
              <div className="h-2 rounded-full bg-surface-2">
                <div className="h-2 rounded-full" style={{ width: `${total ? (n / total) * 100 : 0}%`, background: `color-mix(in oklab, var(--color-series-1) ${35 + i * 21}%, var(--color-surface-2))` }} />
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

function AssetTable({ assets }: { assets: MaintenanceAssetInsight[] }) {
  const toast = useFactory((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const propose = async (a: MaintenanceAssetInsight) => {
    setBusy(a.assetId);
    try {
      const rec = await proposeFromInsight({ kind: "maintenance", assetId: a.assetId });
      toast({ tone: "success", title: `${rec.id} proposed`, detail: `${rec.title}. A person approves it in Approvals.` });
    } catch (e) {
      toast({ tone: "error", title: "Could not propose maintenance", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader title="All machines" description="Backend diagnosis per machine. Proposing creates a pending recommendation simulated on the twin's own scenario engine." actions={<Link href="/approvals" className="text-[12px] text-accent-ink hover:underline">Open Approvals</Link>} />
      <CardBody className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="text-left text-muted">
            <tr>
              {["Machine", "Line", "Zone", "Vibration", "Health", "Hours to trip", "Risk", ""].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.assetId} className="border-t border-line">
                <td className="px-2 py-1.5"><span className="font-mono text-[11.5px] text-ink">{a.assetId}</span> <span className="text-muted">{a.name}</span></td>
                <td className="px-2 py-1.5 text-ink-2">{a.lineId}</td>
                <td className="px-2 py-1.5 text-ink-2">{a.isoZone ? a.isoZone.split("_")[1] : a.status}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{a.vibration != null ? `${a.vibration.toFixed(2)} / ${a.limits?.trip} mm/s` : "—"}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{a.healthScore != null ? Math.round(a.healthScore * 100) : "—"}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{a.status !== "running" ? "—" : a.hoursToTrip == null ? "not trending" : fmtHours(a.hoursToTrip)}</td>
                <td className="px-2 py-1.5"><Badge tone={RISK_TONE[a.risk]}>{a.risk}</Badge></td>
                <td className="px-2 py-1.5 text-right">
                  {(a.risk === "high" || a.risk === "medium") && (
                    <Button size="sm" variant="secondary" loading={busy === a.assetId} onClick={() => propose(a)}>
                      Propose maintenance
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
