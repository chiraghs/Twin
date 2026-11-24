"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Factory, Gauge, PackageCheck, Trash2, Zap } from "lucide-react";
import { useFactory } from "@/client/store";
import { AXIS_TICK, ChartTooltip, GRID, SERIES } from "@/components/charts/kit";
import { PageHeader, StatTile } from "@/components/page";
import { Badge, Card, CardBody, CardHeader, Meter, Select } from "@/components/ui/primitives";
import { hourlySeries } from "@/domain/kpis";
import { plantProduction } from "@/domain/production";
import { cn } from "@/lib/cn";
import { fmtInt, fmtNum, fmtPct, fmtSimTime } from "@/lib/format";

const LINE_TONE: Record<string, "healthy" | "warning" | "critical" | "neutral"> = { running: "healthy", idle: "neutral", starved: "warning", changeover: "neutral", maintenance: "neutral", down: "critical" };
const STATE_TONE: Record<string, "healthy" | "warning" | "critical" | "neutral"> = { running: "healthy", idle: "neutral", starved: "warning", blocked: "warning", changeover: "neutral", fault: "critical", maintenance: "neutral" };

/** Plant-wide production: output against target, OEE, losses, every line and machine, and open orders. */
export default function ProductionAnalyticsPage() {
  const state = useFactory((s) => s.state)!;
  const [hours, setHours] = useState(8);
  const p = useMemo(() => plantProduction(state, hours), [state, hours]);
  const series = useMemo(() => hourlySeries(state, 24), [state]);
  const k = p.kpis;
  const label = (t: string | number) => fmtSimTime(state, Number(t), false);
  const losses = p.lines.map((l) => ({ name: l.name, Run: l.losses.run, "Unplanned down": l.losses.unplannedDown, "Planned down": l.losses.plannedDown, Changeover: l.losses.changeover, Starved: l.losses.starved }));
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Analytics"
        title="Production"
        description="What the plant is producing: output against target, OEE and where time is lost, line by line and machine by machine, from the plant model's hourly production records."
        actions={
          <Select value={String(hours)} onChange={(e) => setHours(Number(e.target.value))} aria-label="Time window">
            <option value="8">Last 8 h (shift)</option>
            <option value="24">Last 24 h</option>
          </Select>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Packaged output" value={fmtInt(k.output.actual)} sub={`target ${fmtInt(k.output.target)} · ${fmtPct(k.output.attainment, 0)} attained`} icon={<PackageCheck className="h-4 w-4" />} tone={k.output.attainment < 0.9 ? "warning" : "neutral"} />
        <StatTile label="OEE (assembly)" value={fmtPct(k.oee.oee, 1)} sub={`A ${fmtPct(k.oee.availability, 0)} · P ${fmtPct(k.oee.performance, 0)} · Q ${fmtPct(k.oee.quality, 1)}`} icon={<Gauge className="h-4 w-4" />} />
        <StatTile label="Scrap" value={`${fmtNum(k.scrap.rate * 100, 2)}%`} sub={`${fmtInt(k.scrap.units)} units rejected`} icon={<Trash2 className="h-4 w-4" />} tone={k.scrap.rate > 0.03 ? "warning" : "neutral"} />
        <StatTile label="Energy per unit" value={`${fmtNum(k.energy.kwhPerUnit, 3)} kWh`} sub={`${fmtInt(k.energy.kwh)} kWh · ${fmtInt(k.energy.idleKwh)} idle`} icon={<Zap className="h-4 w-4" />} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title="Output per hour" description="Packaged good units against the assembly target, with OEE (last 24 h)." />
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer>
                <ComposedChart data={series} margin={{ left: 0, right: 8 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="hour" tickFormatter={label} tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis yAxisId="u" tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                  <YAxis yAxisId="o" orientation="right" domain={[0, 100]} unit="%" tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
                  <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<ChartTooltip labelFormatter={label} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="u" dataKey="actual" name="Output (units)" fill={SERIES[0]} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  <Line yAxisId="u" dataKey="target" name="Target (units)" stroke="#f59e0b" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  <Line yAxisId="o" dataKey="oee" name="OEE %" stroke={SERIES[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Where the time went" description={`Hours per line, last ${hours} h.`} />
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={losses} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" unit=" h" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={96} />
                  <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<ChartTooltip valueFormatter={(v) => `${fmtNum(v, 2)} h`} />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Run" stackId="t" fill={SERIES[0]} isAnimationActive={false} />
                  <Bar dataKey="Unplanned down" stackId="t" fill="#ef4444" isAnimationActive={false} />
                  <Bar dataKey="Planned down" stackId="t" fill="#64748b" isAnimationActive={false} />
                  <Bar dataKey="Changeover" stackId="t" fill={SERIES[3]} isAnimationActive={false} />
                  <Bar dataKey="Starved" stackId="t" fill="#f59e0b" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Lines" description={`Last ${hours} h. Rate now against the allocated products' rated speed.`} />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-[12.5px]">
            <thead className="border-b border-line text-left text-[11.5px] text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Line</th>
                <th className="py-2.5 pr-3 font-medium">State</th>
                <th className="py-2.5 pr-3 font-medium">Good / target</th>
                <th className="py-2.5 pr-3 font-medium">Rejects</th>
                <th className="py-2.5 pr-3 font-medium">OEE (A · P · Q)</th>
                <th className="py-2.5 pr-3 font-medium">Rate now / rated</th>
                <th className="py-2.5 pr-4 font-medium">Bottleneck</th>
              </tr>
            </thead>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink">{l.name}</span> <span className="text-muted">· {l.kind}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={LINE_TONE[l.state] ?? "neutral"}>{l.state}</Badge>
                  </td>
                  <td className="tabular py-2.5 pr-3">
                    {fmtInt(l.good)} / {fmtInt(l.target)}
                    {l.target > 0 && <Meter value={Math.min(100, (l.good / l.target) * 100)} tone={l.good / l.target < 0.9 ? "warning" : "accent"} className="mt-1 w-28" />}
                  </td>
                  <td className="tabular py-2.5 pr-3">
                    {fmtInt(l.reject)} <span className="text-muted">· {fmtNum(l.rejectPct, 2)}%</span>
                  </td>
                  <td className="tabular py-2.5 pr-3">
                    <span className="font-semibold text-ink">{fmtPct(l.oee.oee, 1)}</span>{" "}
                    <span className="text-muted">
                      {fmtPct(l.oee.availability, 0)} · {fmtPct(l.oee.performance, 0)} · {fmtPct(l.oee.quality, 1)}
                    </span>
                  </td>
                  <td className="tabular py-2.5 pr-3">
                    {fmtInt(l.rate)} / {fmtInt(l.ratedRate)} u/h
                  </td>
                  <td className="py-2.5 pr-4">
                    {l.bottleneckId ? (
                      <Link href={`/assets/${l.bottleneckId}?tab=production`} className="font-mono text-accent-ink hover:underline">
                        {l.bottleneckId}
                      </Link>
                    ) : (
                      <span className="text-muted">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <div className="grid gap-3 xl:grid-cols-[3fr_2fr]">
        <Card>
          <CardHeader title="Machines" description="Units each machine produced, its rate against nameplate, cycle time against ideal, and the rejects it caused." />
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead className="border-b border-line text-left text-[11.5px] text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Machine</th>
                  <th className="py-2.5 pr-3 font-medium">State</th>
                  <th className="py-2.5 pr-3 font-medium">Units ({hours} h)</th>
                  <th className="py-2.5 pr-3 font-medium">Rate / nameplate</th>
                  <th className="py-2.5 pr-3 font-medium">Cycle (ideal)</th>
                  <th className="py-2.5 pr-4 font-medium">Rejects caused</th>
                </tr>
              </thead>
              <tbody>
                {p.machines.map((m) => {
                  const a = state.assets.find((x) => x.id === m.assetId)!;
                  return (
                    <tr key={m.assetId} className="border-b border-line/60 last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/assets/${m.assetId}?tab=production`} className="font-mono text-ink hover:text-accent-ink hover:underline">
                          {m.assetId}
                        </Link>{" "}
                        <span className="text-muted">· {a.name}</span>
                      </td>
                      <td className="py-2 pr-3">
                        {m.state && <Badge tone={STATE_TONE[m.state.state] ?? "neutral"}>{m.state.state}</Badge>}
                        {m.state?.bottleneck && (
                          <Badge tone="agent" className="ml-1">
                            bottleneck
                          </Badge>
                        )}
                      </td>
                      <td className="tabular py-2 pr-3 font-semibold text-ink">{fmtInt(m.units)}</td>
                      <td className="tabular whitespace-nowrap py-2 pr-3">
                        {fmtInt(m.throughput)} / {fmtInt(m.nameplate)} u/h <span className={cn("text-muted", m.pace < 0.6 && a.mode === "running" && "text-warning-ink")}>· {fmtPct(m.pace, 0)}</span>
                      </td>
                      <td className="tabular whitespace-nowrap py-2 pr-3">
                        {m.cycle.actualS === null ? <span className="text-muted">not producing</span> : `${fmtNum(m.cycle.actualS, 1)} s`} <span className="text-muted">({fmtNum(m.cycle.idealS, 1)} s)</span>
                      </td>
                      <td className={cn("tabular py-2 pr-4", m.rejectsCaused > 20 && "text-warning-ink")}>{fmtInt(m.rejectsCaused)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Open orders" description="What the output is for: progress and time to due date." />
          <CardBody className="space-y-2.5">
            {p.orders.length === 0 && <p className="text-[12px] text-muted">No open orders.</p>}
            {p.orders.map((o) => (
              <div key={o.id} className="rounded-lg border border-line bg-shell/60 px-3 py-2 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    <span className="font-mono text-ink">{o.id}</span> <span className="text-muted">· {o.customer}</span>
                  </span>
                  <Badge tone={o.dueIn < 0 ? "critical" : o.priority === "critical" ? "warning" : "neutral"}>{o.dueIn < 0 ? "overdue" : `due in ${fmtNum(o.dueIn, 1)} h`}</Badge>
                </div>
                <p className="mt-0.5 text-muted">
                  {o.product} · {fmtInt(o.fulfilled)} / {fmtInt(o.quantity)}
                </p>
                <Meter value={o.progress * 100} tone={o.dueIn < 0 ? "critical" : "accent"} className="mt-1.5" />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted">
        <Factory className="h-3.5 w-3.5" /> Simulated plant data from the deterministic plant model. Open a machine for its own Production tab.
      </p>
    </div>
  );
}
