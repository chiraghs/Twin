"use client";

import { useMemo, useState } from "react";
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge, PackageCheck, Target, TrendingUp } from "lucide-react";
import { AnalyticsShell } from "@/components/analytics/shell";
import { AXIS_TICK, ChartTooltip, GRID, Legend, REFERENCE, SERIES } from "@/components/charts/kit";
import { StatTile } from "@/components/page";
import { Badge, Card, CardBody, CardHeader, Select } from "@/components/ui/primitives";
import type { DemandInsights, DemandProductInsight } from "@/domain/intelligence";
import { fmtInt } from "@/lib/format";

export default function DemandAnalyticsPage() {
  return (
    <AnalyticsShell<DemandInsights>
      feature="demand"
      title="Demand analytics"
      description="Probabilistic forecasts per product against this plant's capacity and order book, from the intelligence backend. The history is generated from the plant's capacity and product mix and labelled simulated."
    >
      {(d) => <Body d={d.insights} />}
    </AnalyticsShell>
  );
}

function Body({ d }: { d: DemandInsights }) {
  const [pid, setPid] = useState(d.products[0]?.productId ?? "");
  const p = d.products.find((x) => x.productId === pid) ?? d.products[0];
  if (!p) return <p className="text-[12.5px] text-muted">No products with enough history to forecast.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {d.products.length > 1 && (
          <Select aria-label="Product" value={p.productId} onChange={(e) => setPid(e.target.value)}>
            {d.products.map((x) => (
              <option key={x.productId} value={x.productId}>
                {x.name} ({x.sku})
              </option>
            ))}
          </Select>
        )}
        <Badge tone="warning">Simulated history</Badge>
        <span className="text-[11.5px] text-muted">{d.provenance} · forecast as of {d.asOf}, {d.horizonDays}-day horizon</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Forecast (P50)" value={`${fmtInt(p.dailyP50)}/day`} sub={`P90 ${fmtInt(p.dailyP90)}/day · ${fmtInt(p.totalP50)} units over ${d.horizonDays} days`} icon={<TrendingUp className="h-4 w-4" />} />
        <StatTile
          label="Capacity used by P50"
          value={p.utilizationPct != null ? `${p.utilizationPct.toFixed(0)}%` : "—"}
          sub={`${fmtInt(p.capacityPerDay)}/day at the current allocation${p.p90ExceedsCapacity ? " · P90 exceeds it" : ""}`}
          icon={<Gauge className="h-4 w-4" />}
          tone={p.capacityWarning || p.p90ExceedsCapacity ? "warning" : "healthy"}
        />
        <StatTile label="Order book coverage" value={p.orderCoveragePct != null ? `${p.orderCoveragePct}%` : "—"} sub={`${fmtInt(p.openOrderUnits)} units on open orders in the horizon`} icon={<PackageCheck className="h-4 w-4" />} />
        <StatTile
          label="Forecast error (WAPE)"
          value={`${(p.metrics.wape * 100).toFixed(1)}%`}
          sub={p.challenger ? `${p.model} won; ${p.challenger.model} scored ${(p.challenger.wape * 100).toFixed(1)}%` : `${p.model} vs baseline ${(p.metrics.baselineWape * 100).toFixed(1)}%`}
          icon={<Target className="h-4 w-4" />}
        />
      </div>
      <FanChart p={p} />
      <Headroom d={d} />
    </div>
  );
}

function FanChart({ p }: { p: DemandProductInsight }) {
  const data = useMemo(
    () => [
      ...p.history.slice(-60).map((h) => ({ date: h.date, actual: h.actual_units })),
      ...p.forecast.map((f) => ({ date: f.date, p50: f.p50_units, band: [f.p10_units, f.p90_units] as [number, number], baseline: f.baseline_units })),
    ],
    [p],
  );
  const BAND = "color-mix(in oklab, var(--color-series-1) 22%, transparent)";
  const baselineIsChampion = p.model.startsWith("Seasonal-Naive");
  return (
    <Card>
      <CardHeader title={`${p.name}: daily demand and forecast`} description={`Last 60 days of history, then the ${p.model} forecast: P50 line with the P10–P90 band. Dashed line: capacity at the current line allocation.`} />
      <CardBody>
        <div className="h-80">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={36} tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmtInt(v)} domain={[0, (max: number) => Math.ceil(Math.max(max, p.capacityPerDay * 1.05) / 100) * 100]} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as { actual?: number; p50?: number; band?: [number, number]; baseline?: number };
                  const items = row.actual != null
                    ? [{ name: "Actual", value: row.actual, color: SERIES[1] }]
                    : [
                        { name: "P90", value: row.band?.[1], color: BAND },
                        { name: "P50", value: row.p50, color: SERIES[0] },
                        { name: "P10", value: row.band?.[0], color: BAND },
                        { name: "Seasonal-naive", value: row.baseline, color: REFERENCE },
                      ];
                  return <ChartTooltip active payload={items.map((i) => ({ ...i, dataKey: i.name, value: i.value ?? 0 }))} label={label} valueFormatter={(v) => fmtInt(v)} />;
                }}
              />
              <Area dataKey="band" name="P10–P90" fill={BAND} stroke="none" isAnimationActive={false} />
              <Line dataKey="actual" name="Actual" stroke={SERIES[1]} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="p50" name="P50" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
              {!baselineIsChampion && <Line dataKey="baseline" name="Seasonal-naive" stroke={REFERENCE} strokeWidth={1.5} strokeDasharray="3 3" dot={false} isAnimationActive={false} />}
              {p.capacityPerDay > 0 && <ReferenceLine y={p.capacityPerDay} stroke="var(--color-warning)" strokeDasharray="6 4" label={{ value: "capacity", position: "insideTopRight", fill: "var(--color-muted)", fontSize: 11 }} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Legend
          className="mt-2"
          items={[
            { label: "Actual (simulated)", color: SERIES[1], kind: "line" },
            { label: "Forecast P50", color: SERIES[0], kind: "line" },
            { label: "P10–P90", color: BAND },
            ...(baselineIsChampion ? [] : [{ label: "Seasonal-naive baseline", color: REFERENCE, kind: "line" as const, dashed: true }]),
            { label: "Capacity", color: "var(--color-warning)", kind: "line", dashed: true },
          ]}
        />
      </CardBody>
    </Card>
  );
}

function Headroom({ d }: { d: DemandInsights }) {
  const data = d.products.map((p) => ({ id: p.sku, p50: p.utilizationPct ?? 0, warn: p.capacityWarning || p.p90ExceedsCapacity }));
  return (
    <Card>
      <CardHeader title="Capacity used by the P50 forecast" description={`Share of each product's capacity at the current line allocation. Dashed line: the ${d.capacityWarningPct}% warning threshold (Admin → Features → Demand settings).`} />
      <CardBody>
        <div className="h-48">
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" domain={[0, (max: number) => Math.max(110, Math.ceil(max / 10) * 10)]} tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%" />
              <YAxis type="category" dataKey="id" tick={AXIS_TICK} tickLine={false} axisLine={false} width={104} />
              <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(0)}%`} />} />
              <ReferenceLine x={d.capacityWarningPct} stroke="var(--color-warning)" strokeDasharray="4 4" />
              <Bar dataKey="p50" name="Capacity used" radius={[0, 4, 4, 0]} maxBarSize={16}>
                {data.map((x) => (
                  <Cell key={x.id} fill={x.warn ? "var(--color-warning)" : SERIES[0]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
