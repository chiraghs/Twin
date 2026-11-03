"use client";

import Link from "next/link";
import { AlertOctagon, ArrowRight, BrainCircuit, CircleDot, ClipboardCheck, FlaskConical, Gauge, History, Network, Wrench, Zap } from "lucide-react";
import type { FactoryKpis } from "@/domain/kpis";
import { oeeOf } from "@/domain/kpis";
import type { AuditCategory, AuditEntry, FactoryState, Incident, LineState, ScenarioResult } from "@/domain/types";
import { describeAllocation } from "@/domain/world";
import { cn } from "@/lib/cn";
import { fmtInt, fmtPct, fmtRelHours, fmtSimTime } from "@/lib/format";
import { Badge, Button, Meter, type Tone } from "../ui/primitives";
import { STATUS_META, StatusDot, SEVERITY_TONE, healthTone } from "../ui/status";
import { lineColor } from "../charts/kit";

export function IncidentBanner({ state, incident, onAnalyze, analyzing }: { state: FactoryState; incident: Incident; onAnalyze: () => void; analyzing: boolean }) {
  const asset = state.assets.find((a) => a.id === incident.assetId);
  const critical = incident.severity === "critical";
  return (
    <div
      className={cn(
        "relative mb-5 overflow-hidden rounded-[var(--radius-card)] border p-4",
        critical ? "border-critical/45 bg-[linear-gradient(90deg,rgba(239,68,68,0.12),color-mix(in_oklab,var(--color-surface)_70%,transparent)_60%)]" : "border-warning/40 bg-[linear-gradient(90deg,rgba(245,158,11,0.1),color-mix(in_oklab,var(--color-surface)_70%,transparent)_60%)]",
      )}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <span className={cn("mt-0.5 rounded-lg p-2", critical ? "bg-critical/15 text-critical" : "bg-warning/15 text-warning")}>
            <AlertOctagon className="h-5 w-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-muted">{incident.id}</span>
              <Badge tone={critical ? "critical" : "warning"}>{critical ? "Critical" : "Warning"}</Badge>
              <Badge tone="neutral">{incident.status}</Badge>
              <span className="text-[11px] text-muted">opened {fmtRelHours(state, incident.openedHour)}</span>
            </div>
            <p className="mt-1 text-[15px] font-semibold text-ink">{incident.title}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-2">{incident.summary}</p>
            {asset && (
              <p className="mt-1 text-[11.5px] text-muted">
                {asset.id} · health {asset.healthScore.toFixed(0)} · {asset.signal.vibration.toFixed(2)} mm/s · {asset.signal.temperature.toFixed(1)} °C ·{" "}
                {state.lines.find((l) => l.id === asset.lineId)?.name}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/twin?asset=${incident.assetId}`}>
              <Network className="h-3.5 w-3.5" /> View in twin
            </Link>
          </Button>
          <Button variant="primary" size="sm" onClick={onAnalyze} loading={analyzing}>
            <BrainCircuit className="h-3.5 w-3.5" /> Analyze impact
          </Button>
        </div>
      </div>
    </div>
  );
}

const LINE_STATE: Record<LineState, { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "healthy" },
  starved: { label: "Waiting for input", tone: "neutral" },
  changeover: { label: "Changeover", tone: "accent" },
  maintenance: { label: "Planned maintenance", tone: "maint" },
  down: { label: "Down", tone: "critical" },
  idle: { label: "Idle", tone: "neutral" },
};

export function LineStatusList({ state }: { state: FactoryState }) {
  const recent = state.production.filter((r) => r.hour >= Math.floor(state.clock.hour) - 8);
  return (
    <div className="space-y-2.5">
      {state.lines.map((l) => {
        const assets = state.assets.filter((a) => a.lineId === l.id);
        const oee = oeeOf(recent.filter((r) => r.lineId === l.id));
        const throughput = assets.length ? Math.min(...assets.map((a) => a.signal.throughput)) : 0;
        const st = LINE_STATE[l.state];
        const worst = [...assets].sort((a, b) => a.healthScore - b.healthScore)[0];
        return (
          <div key={l.id} className="rounded-xl border border-line bg-shell/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: lineColor(state, l.id) }} />
                <p className="truncate text-[13px] font-semibold text-ink">{l.name}</p>
              </div>
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
              <div>
                <p className="text-muted">Throughput</p>
                <p className="tabular font-semibold text-ink">{fmtInt(throughput)} u/h</p>
              </div>
              <div>
                <p className="text-muted">OEE 8 h</p>
                <p className="tabular font-semibold text-ink">{fmtPct(oee.oee)}</p>
              </div>
              <div>
                <p className="text-muted">{l.kind === "packaging" ? "Mix" : "Product"}</p>
                <p className="truncate font-semibold text-ink" title={describeAllocation(l.allocation)}>
                  {l.kind === "packaging" ? "All SKUs" : describeAllocation(l.allocation)}
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5">
              {assets.map((a) => (
                <Link key={a.id} href={`/twin?asset=${a.id}`} title={`${a.id} · ${STATUS_META[a.status].label} · health ${a.healthScore.toFixed(0)}`} className="rounded p-0.5 hover:bg-surface-2">
                  <StatusDot status={a.status} pulse={a.status === "critical" || a.status === "offline"} />
                </Link>
              ))}
              {worst && worst.status !== "healthy" && (
                <span className="ml-auto truncate text-[11px] text-muted">
                  Watch: <span className="text-ink-2">{worst.id}</span>
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function HealthDistribution({ state, kpis }: { state: FactoryState; kpis: FactoryKpis }) {
  const dist = kpis.health.distribution;
  const total = state.assets.length;
  const order = ["healthy", "warning", "critical", "offline", "maintenance"] as const;
  const worst = [...state.assets].sort((a, b) => a.healthScore - b.healthScore).slice(0, 4);
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-md">
        {order.map((s) =>
          dist[s] ? <div key={s} className="h-full first:rounded-l-md last:rounded-r-md" style={{ width: `${(dist[s] / total) * 100}%`, background: STATUS_META[s].color }} title={`${STATUS_META[s].label}: ${dist[s]}`} /> : null,
        )}
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-y-1.5 text-[11.5px]">
        {order.map((s) => {
          const M = STATUS_META[s];
          return (
            <span key={s} className="flex items-center gap-1.5 text-ink-2">
              <M.Icon className="h-3 w-3" style={{ color: M.color }} />
              {M.label}
              <span className="tabular font-semibold text-ink">{dist[s]}</span>
            </span>
          );
        })}
      </div>
      <div className="mt-3.5 space-y-2 border-t border-line pt-3">
        <p className="text-[11px] font-medium text-muted">Lowest health</p>
        {worst.map((a) => (
          <Link key={a.id} href={`/twin?asset=${a.id}`} className="flex items-center gap-2.5 rounded-lg px-1 py-0.5 hover:bg-surface-2">
            <span className="w-20 shrink-0 font-mono text-[11.5px] text-ink-2">{a.id}</span>
            <Meter value={a.healthScore} tone={healthTone(a.healthScore)} className="flex-1" />
            <span className="tabular w-8 text-right text-[12px] font-semibold text-ink">{a.healthScore.toFixed(0)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DeliveryOutlook({ state, forecast }: { state: FactoryState; forecast: ScenarioResult | null }) {
  const product = (id: string) => state.products.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-[11px] text-muted">
            <th className="py-2 pr-3 font-medium">Order</th>
            <th className="py-2 pr-3 font-medium">Product</th>
            <th className="py-2 pr-3 font-medium">Progress</th>
            <th className="py-2 pr-3 font-medium">Due</th>
            <th className="py-2 pr-3 font-medium">Projected</th>
            <th className="py-2 font-medium">Outlook</th>
          </tr>
        </thead>
        <tbody>
          {state.orders.map((o) => {
            const f = forecast?.orders.find((x) => x.orderId === o.id);
            const done = o.completedHour !== null;
            const projected = f?.completionHour != null ? state.clock.hour + f.completionHour : null;
            let tone: Tone = "healthy";
            let label = "On track";
            if (done) {
              tone = o.completedHour! <= o.dueHour ? "healthy" : "warning";
              label = o.completedHour! <= o.dueHour ? "Delivered" : "Delivered late";
            } else if (o.dueHour < state.clock.hour) {
              tone = "critical";
              label = "Overdue";
            } else if (f && f.dueInHorizon && !f.onTime) {
              tone = "critical";
              label = `At risk · ${fmtInt(f.lateUnits)} short`;
            } else if (!f?.dueInHorizon && projected === null) {
              tone = "neutral";
              label = "Beyond horizon";
            }
            return (
              <tr key={o.id} className="border-b border-line/60 last:border-0">
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-ink">{o.id}</span>
                    {o.priority !== "standard" && <Badge tone={o.priority === "critical" ? "critical" : "warning"}>{o.priority}</Badge>}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">{o.customer}</p>
                </td>
                <td className="py-2.5 pr-3 text-ink-2">{product(o.productId)}</td>
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-2">
                    <Meter value={(o.fulfilled / o.quantity) * 100} tone={done ? "healthy" : "accent"} className="w-20" />
                    <span className="tabular text-[11.5px] text-ink-2">
                      {fmtInt(o.fulfilled)}/{fmtInt(o.quantity)}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-ink-2">
                  <span className="tabular">{fmtSimTime(state, o.dueHour, false)}</span>
                  <span className="ml-1 text-[11px] text-muted">({fmtRelHours(state, o.dueHour)})</span>
                </td>
                <td className="tabular py-2.5 pr-3 text-ink-2">{done ? "—" : projected !== null ? fmtRelHours(state, projected) : "—"}</td>
                <td className="py-2.5">
                  <Badge tone={tone}>{label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CATEGORY_ICON: Record<AuditCategory, typeof History> = {
  "telemetry-alert": AlertOctagon,
  agent: BrainCircuit,
  recommendation: ClipboardCheck,
  scenario: FlaskConical,
  approval: ClipboardCheck,
  rejection: ClipboardCheck,
  action: Wrench,
  "state-change": CircleDot,
  asset: Network,
  system: Gauge,
};

export function EventFeed({ state, entries, compact = false }: { state: FactoryState; entries: AuditEntry[]; compact?: boolean }) {
  return (
    <ol className="space-y-0.5">
      {entries.map((e) => {
        const Icon = CATEGORY_ICON[e.category] ?? Zap;
        const tone = SEVERITY_TONE[e.severity];
        return (
          <li key={e.id} className="flex gap-2.5 rounded-lg px-1.5 py-2 hover:bg-surface-2/60">
            <span
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border",
                tone === "critical" ? "border-critical/40 bg-critical/10 text-critical" : tone === "warning" ? "border-warning/40 bg-warning/10 text-warning" : tone === "healthy" ? "border-healthy/40 bg-healthy/10 text-healthy" : "border-line bg-surface-2 text-ink-2",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-[12.5px] font-medium text-ink", compact && "truncate")}>{e.title}</p>
              {!compact && <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted">{e.detail}</p>}
              <p className="mt-0.5 text-[10.5px] text-muted">
                {fmtSimTime(state, e.hour, false)} · {e.actor}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function InventoryCoverage({ state, items }: { state: FactoryState; items: FactoryKpis["inventory"]["items"] }) {
  const max = 60;
  return (
    <div className="space-y-2.5">
      {items.map((i) => {
        const inv = state.inventory.find((x) => x.id === i.id)!;
        const next = [...inv.inbound].sort((a, b) => a.etaHour - b.etaHour)[0];
        const eta = next ? next.etaHour - state.clock.hour : null;
        const cover = Number.isFinite(i.coverageHours) ? i.coverageHours : max;
        const gap = eta !== null && cover < eta;
        const tone: Tone = cover < 24 && gap ? "critical" : cover < 30 || i.onHand < i.reorderPoint ? "warning" : "healthy";
        return (
          <div key={i.id}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
              <span className="truncate text-ink-2">
                <span className="font-mono text-ink">{i.id}</span> · {fmtInt(i.onHand)} on hand
              </span>
              <span className="tabular shrink-0 text-muted">{Number.isFinite(i.coverageHours) ? `${i.coverageHours.toFixed(0)} h cover` : "not consumed"}</span>
            </div>
            <div className="relative h-1.5 w-full rounded-full bg-surface-3">
              <div
                className={cn("absolute inset-y-0 left-0 rounded-full", tone === "critical" ? "bg-critical" : tone === "warning" ? "bg-warning" : "bg-healthy")}
                style={{ width: `${Math.min(100, (cover / max) * 100)}%` }}
              />
              {eta !== null && eta <= max && (
                <span className="absolute -top-1 h-3.5 w-[2px] rounded bg-ink" style={{ left: `${(eta / max) * 100}%` }} title={`${next!.poId} arrives in ${eta.toFixed(0)} h`} />
              )}
            </div>
            {gap && next && (
              <p className="mt-1 text-[11px] text-muted">
                Runs out ≈{cover.toFixed(0)} h before {next.poId} (h+{eta!.toFixed(0)}) at current allocation
              </p>
            )}
          </div>
        );
      })}
      <p className="pt-1 text-[10.5px] text-muted">Bar = hours of cover at current line allocation (0–60 h). Marker = next inbound PO.</p>
    </div>
  );
}

export function QuickActions() {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        { href: "/twin", label: "Digital twin", icon: Network },
        { href: "/agents", label: "AI operations", icon: BrainCircuit },
        { href: "/simulator", label: "What-if simulator", icon: FlaskConical },
        { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
      ].map((q) => (
        <Link key={q.href} href={q.href} className="flex items-center gap-2 rounded-lg border border-line bg-shell/60 px-3 py-2 text-[12.5px] text-ink-2 hover:border-line-strong hover:text-ink">
          <q.icon className="h-3.5 w-3.5 text-muted" /> {q.label}
          <ArrowRight className="ml-auto h-3 w-3 text-muted" />
        </Link>
      ))}
    </div>
  );
}
