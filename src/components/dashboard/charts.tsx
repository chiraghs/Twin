"use client";

import { Area, AreaChart, Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HourlyKpiPoint } from "@/domain/kpis";
import type { FactoryState } from "@/domain/types";
import { fmtSimTime } from "@/lib/format";
import { AXIS_TICK, ChartTooltip, GRID, Legend, REFERENCE, SERIES, lineColor } from "../charts/kit";

export function ProductionChart({ state, data }: { state: FactoryState; data: HourlyKpiPoint[] }) {
  const label = (h: string | number) => fmtSimTime(state, Number(h), false);
  return (
    <div>
      <Legend
        className="mb-2"
        items={[
          { label: "Packaged output (units/h)", color: SERIES[0] },
          { label: "Planned target (units/h)", color: REFERENCE, kind: "line" },
        ]}
      />
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="hour" tickFormatter={label} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<ChartTooltip labelFormatter={(h) => `${label(h)} (hourly rate)`} />} />
            <Bar dataKey="actual" name="Packaged output" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            <Line dataKey="target" name="Planned target" stroke={REFERENCE} strokeWidth={2} dot={false} type="stepAfter" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function OeeTrendChart({ state, data }: { state: FactoryState; data: HourlyKpiPoint[] }) {
  const label = (h: string | number) => fmtSimTime(state, Number(h), false);
  return (
    <div className="h-36">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="hour" tickFormatter={label} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
          <YAxis domain={[50, 100]} ticks={[50, 70, 85, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `${v}%`} />
          <ReferenceLine y={85} stroke="var(--color-line-strong)" label={{ value: "World-class 85%", position: "insideTopRight", fill: "var(--color-muted)", fontSize: 10 }} />
          <Tooltip content={<ChartTooltip labelFormatter={label} valueFormatter={(v) => `${v.toFixed(1)}%`} />} />
          <Line dataKey="oee" name="Assembly OEE" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EnergyByLineChart({ state, data }: { state: FactoryState; data: HourlyKpiPoint[] }) {
  const label = (h: string | number) => fmtSimTime(state, Number(h), false);
  const rows = data.map((d) => ({ hour: d.hour, ...d.energy }));
  return (
    <div>
      <Legend className="mb-2" items={state.lines.map((l) => ({ label: l.name.replace("Assembly ", "").replace("Packaging ", "Pkg "), color: lineColor(state, l.id) }))} />
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="hour" tickFormatter={label} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={28} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<ChartTooltip labelFormatter={(h) => `${label(h)} · kWh`} valueFormatter={(v) => `${v.toFixed(1)} kWh`} />} />
            {state.lines.map((l) => (
              <Area
                key={l.id}
                dataKey={l.id}
                name={l.name}
                stackId="e"
                stroke={lineColor(state, l.id)}
                fill={lineColor(state, l.id)}
                fillOpacity={0.12}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
