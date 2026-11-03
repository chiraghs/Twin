"use client";

import { Bar, BarChart, CartesianGrid, ComposedChart, LabelList, Line, LineChart, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { linearFit } from "@/domain/math";
import type { Correlation, QualityReport } from "@/domain/quality";
import type { FactoryState } from "@/domain/types";
import { fmtSimTime } from "@/lib/format";
import { AXIS_TICK, ChartTooltip, GRID, Legend, REFERENCE, SERIES, lineColor } from "../charts/kit";

/** Defect Pareto: classes by count (one hue), cumulative share as a text label — no second axis. */
export function ParetoChart({ report }: { report: QualityReport }) {
  const top = report.pareto.slice(0, 7);
  const rest = report.pareto.slice(7);
  const rows = [
    ...top.map((p) => ({ type: p.type, count: p.count, cum: `${Math.round(p.cumulative * 100)}%` })),
    ...(rest.length ? [{ type: `Other (${rest.length} classes)`, count: rest.reduce((s, p) => s + p.count, 0), cum: "100%" }] : []),
  ];
  return (
    <div style={{ height: Math.max(160, rows.length * 34 + 20) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} />
          <YAxis type="category" dataKey="type" tick={{ ...AXIS_TICK, fill: "var(--color-ink-2)" }} tickLine={false} axisLine={false} width={176} interval={0} />
          <Tooltip
            cursor={{ fill: "color-mix(in oklab, var(--color-muted) 10%, transparent)" }}
            content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(0)} defects`} />}
          />
          <Bar dataKey="count" name="Defects (24 h)" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false}>
            <LabelList dataKey="cum" position="right" style={{ fill: "var(--color-muted)", fontSize: 10.5 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Hourly defect rate per inspection station; colour follows the line. */
export function RejectTrendChart({ state, report }: { state: FactoryState; report: QualityReport }) {
  const hours = [...new Set(report.stations.flatMap((s) => s.hourly.map((h) => h.hour)))].sort((a, b) => a - b);
  const rows = hours.map((hour) => {
    const row: Record<string, number | null> = { hour };
    for (const s of report.stations) {
      const h = s.hourly.find((x) => x.hour === hour);
      row[s.lineId] = h && h.inspected > 5 ? Math.round(h.rate * 10000) / 100 : null;
    }
    return row;
  });
  const label = (h: string | number) => fmtSimTime(state, Number(h), false);
  return (
    <div>
      <Legend className="mb-2" items={report.stations.map((s) => ({ label: `${s.camera.id} · ${s.lineName}`, color: lineColor(state, s.lineId), kind: "line" as const }))} />
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="hour" tickFormatter={label} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={28} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={<ChartTooltip labelFormatter={(h) => `${label(h)} · reject rate`} valueFormatter={(v) => `${v.toFixed(2)}%`} />} />
            {report.stations.map((s) => (
              <Line key={s.lineId} dataKey={s.lineId} name={s.lineName} stroke={lineColor(state, s.lineId)} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Machine vibration vs. its line's AOI reject rate, one point per hour, with the OLS fit. */
export function CorrelationChart({ correlation }: { correlation: Correlation }) {
  const pts = correlation.points.map((p) => ({ vibration: Math.round(p.vibration * 100) / 100, rate: Math.round(p.defectRate * 10000) / 100, hour: p.hour }));
  const fit = linearFit(
    pts.map((p) => p.vibration),
    pts.map((p) => p.rate),
  );
  const xs = pts.map((p) => p.vibration);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const line = [
    { vibration: x0, fit: Math.round((fit.intercept + fit.slope * x0) * 100) / 100 },
    { vibration: x1, fit: Math.round((fit.intercept + fit.slope * x1) * 100) / 100 },
  ];
  return (
    <div>
      <Legend
        className="mb-2"
        items={[
          { label: "One hour of production", color: SERIES[1] },
          { label: `Least-squares fit (r = ${correlation.r.toFixed(2)})`, color: REFERENCE, kind: "line", dashed: true },
        ]}
      />
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 6, right: 8, bottom: 14, left: -8 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis
              type="number"
              dataKey="vibration"
              domain={["dataMin - 0.2", "dataMax + 0.2"]}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={(v: number) => v.toFixed(1)}
              label={{ value: `${correlation.assetId} vibration (mm/s)`, position: "insideBottom", offset: -8, fill: "var(--color-muted)", fontSize: 11 }}
            />
            <YAxis type="number" dataKey="rate" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as { vibration: number; rate?: number } | undefined;
                if (!active || !p || p.rate === undefined) return null;
                return (
                  <div className="rounded-lg border border-line-strong bg-shell/95 px-2.5 py-2 text-[12px] shadow-xl">
                    <p className="text-ink">
                      {p.vibration.toFixed(2)} mm/s → <span className="font-semibold">{p.rate.toFixed(2)}%</span> rejects
                    </p>
                  </div>
                );
              }}
            />
            <Line data={line} dataKey="fit" stroke={REFERENCE} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} legendType="none" />
            <Scatter data={pts} dataKey="rate" fill={SERIES[1]} stroke="var(--color-surface)" strokeWidth={2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
