"use client";

import { Fragment } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertOctagon, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDot, PackageCheck, PackageX, Repeat, Truck, Wrench, Zap, Award, Workflow } from "lucide-react";
import type { FactoryState, ScenarioResult, TimelineEvent } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtHours, fmtInt, fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { AXIS_TICK, ChartTooltip, GRID, Legend, REFERENCE, SERIES } from "../charts/kit";
import { Badge } from "../ui/primitives";

/** Colour follows the scenario identity (fixed), never its rank. */
export function scenarioColor(id: string) {
  switch (id) {
    case "baseline":
      return REFERENCE;
    case "reroute":
      return SERIES[0];
    case "continue":
      return SERIES[1];
    case "preventive":
      return SERIES[2];
    default:
      return SERIES[3];
  }
}

export function ScenarioCards({ results, selectedId, recommendedId, onSelect }: { results: ScenarioResult[]; selectedId: string; recommendedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
      {results.map((r) => {
        const m = r.metrics;
        const id = r.definition.id;
        const sel = id === selectedId;
        const rec = id === recommendedId;
        const isRef = r.definition.kind === "baseline";
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={cn(
              "relative flex flex-col rounded-xl border p-3.5 text-left transition-colors",
              sel ? "border-accent/70 bg-surface-2 shadow-[0_0_0_3px_rgba(76,141,255,0.15)]" : "border-line bg-surface hover:border-line-strong",
            )}
          >
            <span className="absolute inset-x-3 top-0 h-[3px] rounded-b" style={{ background: scenarioColor(id) }} />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-ink">{r.definition.name}</p>
                <p className="text-[11px] text-muted capitalize">{isRef ? "reference · not an option" : r.definition.kind}</p>
              </div>
              {rec && (
                <Badge tone="healthy">
                  <Award className="h-3 w-3" /> Recommended
                </Badge>
              )}
              {!r.feasible && <Badge tone="critical">Infeasible</Badge>}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-[26px] leading-none font-semibold tracking-tight text-ink">{r.feasible ? m.score.toFixed(1) : "—"}</span>
              <span className="text-[11px] text-muted">/ 100 score</span>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${r.feasible ? m.score : 0}%`, background: scenarioColor(id) }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11.5px]">
              <Stat label="Late units" value={fmtInt(m.lateUnits)} bad={m.lateUnits > 0} />
              <Stat label="Est. cost" value={fmtMoney(m.operatingCost)} />
              <Stat label="Unplanned stop" value={m.failureOccurs ? `h+${m.failureHour?.toFixed(1)}` : "None"} bad={m.failureOccurs} />
              <Stat label="Output" value={fmtInt(m.totalOutput)} />
            </div>
            <p className="tabular mt-2.5 text-[10.5px] text-muted">
              D {m.scoreBreakdown.delivery} · C {m.scoreBreakdown.cost} · R {m.scoreBreakdown.risk} · S {m.scoreBreakdown.sustainability}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-muted">{label}</p>
      <p className={cn("tabular truncate font-semibold", bad ? "text-critical-ink" : "text-ink")}>{value}</p>
    </div>
  );
}

type Row = { label: string; get: (r: ScenarioResult) => number | null; fmt: (v: number | null) => string; better: "higher" | "lower" | null; group?: string };

const ROWS: Row[] = [
  { group: "Outcome", label: "Scenario score", get: (r) => r.metrics.score, fmt: (v) => (v === null ? "—" : v.toFixed(1)), better: "higher" },
  { label: "Packaged output", get: (r) => r.metrics.totalOutput, fmt: fmtInt, better: "higher" },
  { label: "Orders on time (due in horizon)", get: (r) => r.metrics.ordersOnTime, fmt: (v) => fmtInt(v), better: "higher" },
  { label: "Late units", get: (r) => r.metrics.lateUnits, fmt: fmtInt, better: "lower" },
  { group: "Asset", label: "Predicted trip", get: (r) => r.metrics.failureHour, fmt: (v) => (v === null ? "None" : `h+${v.toFixed(1)}`), better: null },
  { label: "Unplanned downtime (target)", get: (r) => r.metrics.targetUnplannedDowntimeHours, fmt: (v) => fmtHours(v), better: "lower" },
  { label: "Planned downtime (target)", get: (r) => r.metrics.targetPlannedDowntimeHours, fmt: (v) => fmtHours(v), better: "lower" },
  { label: "Peak failure risk", get: (r) => r.metrics.peakRisk, fmt: (v) => fmtPct(v, 0), better: "lower" },
  { label: "End-of-horizon health", get: (r) => r.metrics.endHealth, fmt: (v) => fmtNum(v, 0), better: "higher" },
  { group: "Resources", label: "Energy", get: (r) => r.metrics.energyKwh, fmt: (v) => `${fmtInt(v)} kWh`, better: "lower" },
  { label: "Idle energy", get: (r) => r.metrics.idleEnergyKwh, fmt: (v) => `${fmtInt(v)} kWh`, better: "lower" },
  { label: "Energy per unit", get: (r) => r.metrics.energyPerUnit, fmt: (v) => `${fmtNum(v, 3)} kWh`, better: "lower" },
  { label: "Scrap", get: (r) => r.metrics.scrapUnits, fmt: (v) => `${fmtInt(v)} u`, better: "lower" },
  { group: "Cost (estimated)", label: "Maintenance", get: (r) => r.metrics.maintenanceCost, fmt: fmtMoney, better: "lower" },
  { label: "Emergency repair", get: (r) => r.metrics.repairCost, fmt: fmtMoney, better: "lower" },
  { label: "Changeovers", get: (r) => r.metrics.changeoverCost, fmt: fmtMoney, better: "lower" },
  { label: "Late-delivery penalties", get: (r) => r.metrics.latePenaltyCost, fmt: fmtMoney, better: "lower" },
  { label: "Scrap material", get: (r) => r.metrics.scrapCost, fmt: fmtMoney, better: "lower" },
  { label: "Energy cost", get: (r) => r.metrics.energyCost, fmt: fmtMoney, better: "lower" },
  { label: "Expediting", get: (r) => r.metrics.expediteCost, fmt: fmtMoney, better: "lower" },
  { label: "Total operating cost", get: (r) => r.metrics.operatingCost, fmt: fmtMoney, better: "lower" },
];

export function ComparisonTable({ results, selectedId }: { results: ScenarioResult[]; selectedId: string }) {
  const ref = results.find((r) => r.definition.kind === "baseline") ?? results[0];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[12px]">
        <thead>
          <tr className="border-b border-line">
            <th className="sticky left-0 bg-surface py-2 pr-3 font-medium text-muted">Metric</th>
            {results.map((r) => (
              <th key={r.definition.id} className={cn("py-2 pr-3 text-right font-semibold", r.definition.id === selectedId ? "text-ink" : "text-ink-2")}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-[2px]" style={{ background: scenarioColor(r.definition.id) }} />
                  {r.definition.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <Fragment key={`${row.group ?? ""}${row.label}`}>
              {row.group && (
                <tr key={`g-${row.group}`}>
                  <td colSpan={results.length + 1} className="pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-muted uppercase">
                    {row.group}
                  </td>
                </tr>
              )}
              <tr key={row.label} className={cn("border-b border-line/50", row.label === "Total operating cost" || row.label === "Scenario score" ? "font-semibold" : "")}>
                <td className="sticky left-0 bg-surface py-1.5 pr-3 text-ink-2">{row.label}</td>
                {results.map((r) => {
                  const v = row.get(r);
                  const base = row.get(ref);
                  const isRef = r === ref;
                  let delta: number | null = null;
                  if (!isRef && v !== null && base !== null && row.better) delta = v - base;
                  const good = delta !== null && delta !== 0 && ((row.better === "higher" && delta > 0) || (row.better === "lower" && delta < 0));
                  return (
                    <td key={r.definition.id} className={cn("tabular py-1.5 pr-3 text-right", r.definition.id === selectedId ? "bg-accent/5 text-ink" : "text-ink-2")}>
                      {r.feasible || row.label !== "Scenario score" ? row.fmt(v) : "—"}
                      {delta !== null && Math.abs(delta) > 1e-9 && (
                        <span className={cn("ml-1.5 text-[10.5px]", good ? "text-healthy-ink" : "text-critical-ink")}>
                          {delta > 0 ? "+" : "−"}
                          {row.fmt(Math.abs(delta)).replace(/^h\+/, "")}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">Deltas compare each plan with the reference plan (healthy-asset assumption). Green = better, red = worse.</p>
    </div>
  );
}

export function OutputChart({ state, results, productId, orderQty, orderDue }: { state: FactoryState; results: ScenarioResult[]; productId: string; orderQty: number | null; orderDue: number | null }) {
  const hours = results[0]?.hourly.map((h) => h.hour) ?? [];
  const data = hours.map((h, i) => {
    const row: Record<string, number> = { hour: h };
    for (const r of results) row[r.definition.id] = r.hourly[i]?.cumulativeByProduct[productId] ?? 0;
    return row;
  });
  const product = state.products.find((p) => p.id === productId)?.name ?? productId;
  return (
    <div>
      <Legend
        className="mb-2"
        items={[
          ...results.map((r) => ({ label: r.definition.name, color: scenarioColor(r.definition.id), kind: "line" as const })),
          ...(orderQty ? [{ label: "Critical order requirement", color: "#ef4444", kind: "line" as const }] : []),
        ]}
      />
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -4 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="hour" tick={AXIS_TICK} tickFormatter={(h) => `h+${h}`} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : `${v}`)} />
            {orderQty && orderDue !== null && <ReferenceLine y={orderQty} stroke="#ef4444" strokeOpacity={0.6} label={{ value: `${fmtInt(orderQty)} needed`, position: "insideTopLeft", fill: "var(--color-critical-ink)", fontSize: 10 }} />}
            {orderDue !== null && <ReferenceLine x={Math.round(orderDue)} stroke="#ef4444" strokeOpacity={0.6} label={{ value: "due", position: "insideTopRight", fill: "var(--color-critical-ink)", fontSize: 10 }} />}
            <Tooltip content={<ChartTooltip labelFormatter={(h) => `h+${h} · cumulative ${product}`} valueFormatter={(v) => `${fmtInt(v)} units`} />} />
            {results.map((r) => (
              <Line key={r.definition.id} dataKey={r.definition.id} name={r.definition.name} stroke={scenarioColor(r.definition.id)} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function ConditionChart({ results, alarm, trip }: { results: ScenarioResult[]; alarm: number; trip: number }) {
  const hours = results[0]?.hourly.map((h) => h.hour) ?? [];
  const data = hours.map((h, i) => {
    const row: Record<string, number | null> = { hour: h };
    for (const r of results) {
      const p = r.hourly[i];
      row[r.definition.id] = p ? (p.targetMode === "running" ? p.targetVibration : null) : null;
    }
    return row;
  });
  return (
    <div>
      <Legend className="mb-2" items={results.map((r) => ({ label: r.definition.name, color: scenarioColor(r.definition.id), kind: "line" as const }))} />
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="hour" tick={AXIS_TICK} tickFormatter={(h) => `h+${h}`} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={24} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} domain={[0, Math.ceil(trip + 1)]} />
            <ReferenceLine y={alarm} stroke="#f59e0b" strokeOpacity={0.7} label={{ value: "alarm", position: "insideTopLeft", fill: "var(--color-warning-ink)", fontSize: 10 }} />
            <ReferenceLine y={trip} stroke="#ef4444" strokeOpacity={0.8} label={{ value: "trip", position: "insideTopLeft", fill: "var(--color-critical-ink)", fontSize: 10 }} />
            <Tooltip content={<ChartTooltip labelFormatter={(h) => `h+${h} · vibration while running`} valueFormatter={(v) => `${v.toFixed(2)} mm/s`} />} />
            {results.map((r) => (
              <Line key={r.definition.id} dataKey={r.definition.id} name={r.definition.name} stroke={scenarioColor(r.definition.id)} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[11px] text-muted">Gaps = machine stopped (maintenance or unplanned repair).</p>
    </div>
  );
}

const EVENT_ICON: Record<TimelineEvent["kind"], typeof Wrench> = {
  rule: Workflow,
  "maintenance-start": Wrench,
  "maintenance-end": CheckCircle2,
  failure: AlertOctagon,
  "repair-complete": CheckCircle2,
  changeover: Repeat,
  "reroute-start": ArrowUpRight,
  "reroute-end": ArrowDownRight,
  "order-complete": PackageCheck,
  "order-late": PackageX,
  inbound: Truck,
  stockout: PackageX,
  alarm: Zap,
};

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="text-[12px] text-muted">No events in the horizon.</p>;
  return (
    <ol className="relative space-y-2.5 border-l border-line pl-5">
      {events.slice(0, 24).map((e, i) => {
        const Icon = EVENT_ICON[e.kind] ?? CircleDot;
        return (
          <li key={i} className="relative">
            <span
              className={cn(
                "absolute top-0.5 -left-[29px] flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-shell",
                e.severity === "critical" ? "border-critical/60 text-critical" : e.severity === "warning" ? "border-warning/60 text-warning" : e.severity === "success" ? "border-healthy/60 text-healthy" : "border-line-strong text-ink-2",
              )}
            >
              <Icon className="h-2.5 w-2.5" />
            </span>
            <p className="text-[12px] text-ink">
              <span className="tabular mr-2 font-mono text-[11px] text-muted">h+{e.hour.toFixed(2)}</span>
              {e.label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
