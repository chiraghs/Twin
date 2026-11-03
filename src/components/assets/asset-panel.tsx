"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, BrainCircuit, FileText, Flame, Network, PowerOff, RotateCcw, Save, Waves, Wrench, Boxes, Truck, Link2 } from "lucide-react";
import { diagnoseAsset } from "@/domain/anomaly";
import { healthBand, riskFromStatus } from "@/domain/health";
import { ASSET_KIND_LABEL } from "@/domain/archetypes";
import { readingsFor } from "@/domain/telemetry";
import type { Asset, FactoryState } from "@/domain/types";
import type { FaultMode } from "@/domain/commands";
import { api } from "@/client/api";
import { useFactory, useUi } from "@/client/store";
import { cn } from "@/lib/cn";
import { fmtHours, fmtInt, fmtNum, fmtPct, fmtRelHours, fmtSimTime } from "@/lib/format";
import { AXIS_TICK, ChartTooltip, GRID, SERIES } from "../charts/kit";
import { KeyValue, SectionLabel } from "../page";
import { Badge, Button, Dialog, Input, Label, Meter, Select, Slider, Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/primitives";
import { RiskBadge, StatusBadge, healthTone } from "../ui/status";
import { KIND_ICON } from "../ui/asset-kind";
import { STATUS_COLOR } from "../ui/labels";
import { CamerasWatching } from "../vision/camera-panel";

export function AssetPanel({ state, asset, compact = false, onClose }: { state: FactoryState; asset: Asset; compact?: boolean; onClose?: () => void }) {
  const Icon = KIND_ICON[asset.kind];
  const line = state.lines.find((l) => l.id === asset.lineId);
  const [tab, setTab] = useState("overview");
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-lg border border-line bg-surface-2 p-2 text-ink-2">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[11.5px] text-muted">{asset.id}</p>
              <p className="truncate text-[15px] font-semibold text-ink">{asset.name}</p>
              <p className="truncate text-[11.5px] text-muted">
                {ASSET_KIND_LABEL[asset.kind]} · {asset.manufacturer} {asset.model} · {line?.name}
              </p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close panel">
              ×
            </button>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <StatusBadge status={asset.status} />
          <RiskBadge risk={riskFromStatus(asset)} />
          <Badge tone="neutral">Criticality {asset.criticality}</Badge>
          {asset.custom && <Badge tone="agent">User-added</Badge>}
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="overflow-x-auto px-4 pt-3">
          <TabsList className="[&>button]:px-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="telemetry">Telemetry</TabsTrigger>
            <TabsTrigger value="maintenance">History</TabsTrigger>
            <TabsTrigger value="deps">Links</TabsTrigger>
            <TabsTrigger value="docs">Docs</TabsTrigger>
            <TabsTrigger value="config">Configure</TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <TabsContent value="overview">
            <Overview state={state} asset={asset} compact={compact} />
          </TabsContent>
          <TabsContent value="telemetry">
            <TelemetryCharts state={state} asset={asset} />
          </TabsContent>
          <TabsContent value="maintenance">
            <Maintenance state={state} asset={asset} />
          </TabsContent>
          <TabsContent value="deps">
            <Dependencies state={state} asset={asset} />
          </TabsContent>
          <TabsContent value="docs">
            <Documents asset={asset} />
          </TabsContent>
          <TabsContent value="config">
            <Configure state={state} asset={asset} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function Overview({ state, asset, compact }: { state: FactoryState; asset: Asset; compact: boolean }) {
  const router = useRouter();
  const analyze = useFactory((s) => s.analyze);
  const d = useMemo(() => diagnoseAsset(state, asset), [state, asset]);
  const incident = state.incidents.find((i) => i.assetId === asset.id && i.status !== "resolved");
  const wo = state.workOrders.find((w) => w.assetId === asset.id && (w.status === "scheduled" || w.status === "in-progress"));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5">
        <Metric label="Health score" value={asset.healthScore.toFixed(0)} tone={healthTone(asset.healthScore)} bar={asset.healthScore} />
        <Metric label="Utilization" value={fmtPct(asset.utilization, 0)} bar={asset.utilization * 100} />
        <Metric
          label="Vibration"
          value={`${asset.signal.vibration.toFixed(2)} mm/s`}
          sub={`alarm ${asset.thresholds.vibrationAlarm} · trip ${asset.thresholds.vibrationTrip}`}
          tone={asset.signal.vibration >= asset.thresholds.vibrationAlarm ? "critical" : asset.signal.vibration >= asset.thresholds.vibrationAlarm * 0.8 ? "warning" : undefined}
        />
        <Metric
          label="Temperature"
          value={`${asset.signal.temperature.toFixed(1)} °C`}
          sub={`alarm ${asset.thresholds.temperatureAlarm} · trip ${asset.thresholds.temperatureTrip}`}
          tone={asset.signal.temperature >= asset.thresholds.temperatureAlarm ? "critical" : undefined}
        />
        <Metric label="Power" value={`${asset.signal.powerKw.toFixed(1)} kW`} sub={`${d.powerDeviationPct > 0 ? "+" : ""}${d.powerDeviationPct.toFixed(0)}% vs expected`} />
        <Metric label="Throughput" value={`${fmtInt(asset.signal.throughput)} u/h`} sub={`nameplate ${asset.nominalRate} u/h · speed ${asset.speedPct}%`} />
      </div>

      {incident && (
        <div className="rounded-xl border border-critical/40 bg-critical/8 p-3">
          <p className="text-[12px] font-semibold text-critical-ink">
            {incident.id} · {incident.status}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-2">{incident.title}</p>
        </div>
      )}
      {wo && (
        <div className="rounded-xl border border-maint/40 bg-maint/8 p-3 text-[12px]">
          <p className="flex items-center gap-1.5 font-semibold text-maint-ink">
            <Wrench className="h-3.5 w-3.5" /> {wo.id} · {wo.status}
          </p>
          <p className="mt-0.5 text-ink-2">
            {wo.durationHours} h preventive maintenance {wo.status === "scheduled" ? `starts ${fmtRelHours(state, wo.startHour)}` : `ends ${fmtRelHours(state, wo.startHour + wo.durationHours)}`} · {wo.reason}
          </p>
        </div>
      )}

      <div className="rounded-xl border border-line bg-shell/60 p-3">
        <SectionLabel>Condition diagnostics</SectionLabel>
        <div className="mt-1.5">
          <KeyValue k="Vibration trend (6 h)" v={`${d.vib.slopePerHour >= 0 ? "+" : ""}${d.vib.slopePerHour.toFixed(3)} mm/s/h · R² ${d.vib.r2.toFixed(2)}`} />
          <KeyValue k="Temperature trend (6 h)" v={`${d.temp.slopePerHour >= 0 ? "+" : ""}${d.temp.slopePerHour.toFixed(2)} °C/h`} />
          {d.vib.stepChange.detected && <KeyValue k="Step change" v={<span className="text-critical-ink">+{d.vib.stepChange.size.toFixed(2)} mm/s</span>} />}
          <KeyValue k="Time to alarm / trip" v={`${fmtHours(d.hoursToAlarm)} / ${fmtHours(d.hoursToTrip)}`} />
          <KeyValue k="P(trip within 24 h)" v={`${(d.tripProbability24h * 100).toFixed(0)}%`} />
          <KeyValue k="Preventive maintenance" v={d.pmOverdueHours > 0 ? <span className="text-warning-ink">{d.pmOverdueHours} h overdue</span> : `due in ${fmtInt(-d.pmOverdueHours)} h`} />
          <KeyValue k="Readings analysed" v={fmtInt(d.readingsUsed)} />
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-muted">Trend on running telemetry with a change-point test.</p>
      </div>

      <CamerasWatching state={state} assetId={asset.id} />

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="agent"
          onClick={() => {
            router.push("/agents");
            void analyze();
          }}
        >
          <BrainCircuit className="h-3.5 w-3.5" /> Analyze impact
        </Button>
        {compact ? (
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/twin?asset=${asset.id}`}>
              <Network className="h-3.5 w-3.5" /> Open in twin
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="secondary" asChild>
            <Link href={`/simulator?asset=${asset.id}`}>Simulate options</Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, tone, bar }: { label: string; value: string; sub?: string; tone?: "healthy" | "warning" | "critical"; bar?: number }) {
  return (
    <div className="rounded-xl border border-line bg-shell/60 p-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={cn("tabular mt-0.5 text-[15px] font-semibold", tone === "critical" ? "text-critical-ink" : tone === "warning" ? "text-warning-ink" : "text-ink")}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[10.5px] text-muted">{sub}</p>}
      {bar !== undefined && <Meter value={bar} tone={tone ?? "accent"} className="mt-1.5" />}
    </div>
  );
}

export function TelemetryCharts({ state, asset }: { state: FactoryState; asset: Asset }) {
  const data = useMemo(() => readingsFor(state, asset.id).map((r) => ({ ...r, t: Math.round(r.t * 1000) / 1000 })), [state, asset.id]);
  const label = (t: string | number) => fmtSimTime(state, Number(t), false);
  const chart = (key: "vibration" | "temperature" | "powerKw", unit: string, color: string, alarm?: number, trip?: number) => (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[12px] font-medium text-ink-2">
          {key === "powerKw" ? "Power" : key[0].toUpperCase() + key.slice(1)} <span className="text-muted">({unit})</span>
        </p>
        <p className="tabular text-[12px] font-semibold text-ink">{fmtNum(data[data.length - 1]?.[key] ?? 0, key === "temperature" ? 1 : 2)}</p>
      </div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={label} tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={30} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} domain={["auto", trip ? Math.ceil(trip * 1.04) : "auto"]} />
            {alarm !== undefined && <ReferenceLine y={alarm} stroke="#f59e0b" strokeOpacity={0.7} label={{ value: "alarm", position: "insideTopRight", fill: "#f59e0b", fontSize: 10 }} />}
            {trip !== undefined && <ReferenceLine y={trip} stroke="#ef4444" strokeOpacity={0.8} label={{ value: "trip", position: "insideTopRight", fill: "#ef4444", fontSize: 10 }} />}
            <Tooltip content={<ChartTooltip labelFormatter={label} valueFormatter={(v) => `${v.toFixed(2)} ${unit}`} />} />
            <Line dataKey={key} name={key === "powerKw" ? "Power" : key} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted">
        {data.length} readings · 10-min history + latest live reading · sensors ({asset.sensors.map((s) => s.kind).join(", ")})
      </p>
      {chart("vibration", "mm/s", SERIES[0], asset.thresholds.vibrationAlarm, asset.thresholds.vibrationTrip)}
      {chart("temperature", "°C", SERIES[1], asset.thresholds.temperatureAlarm, asset.thresholds.temperatureTrip)}
      {chart("powerKw", "kW", SERIES[2])}
      <div>
        <p className="mb-1 text-[12px] font-medium text-ink-2">30-day health history</p>
        <div className="flex h-10 items-end gap-[2px]">
          {(state.healthHistory[asset.id] ?? []).map((h) => (
            <div
              key={h.day}
              className="flex-1 rounded-t-[2px]"
              style={{ height: `${Math.max(6, h.score)}%`, background: STATUS_COLOR[healthBand(h.score)], opacity: 0.85 }}
              title={`Day ${h.day}: ${h.score.toFixed(0)}`}
            />
          ))}
        </div>
        <p className="mt-1 text-[10.5px] text-muted">Daily health score (last bar = today).</p>
      </div>
    </div>
  );
}

function Maintenance({ state, asset }: { state: FactoryState; asset: Asset }) {
  const records = state.maintenanceHistory.filter((m) => m.assetId === asset.id).slice(0, 8);
  const wos = state.workOrders.filter((w) => w.assetId === asset.id);
  const sinceHours = state.clock.hour - asset.lastMaintenanceHour;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-shell/60 p-3">
        <KeyValue k="Last maintenance" v={`${fmtInt(sinceHours)} h ago`} />
        <KeyValue k="PM interval" v={`${fmtInt(asset.maintenanceIntervalHours)} h`} />
        <Meter value={(sinceHours / asset.maintenanceIntervalHours) * 100} tone={sinceHours > asset.maintenanceIntervalHours ? "warning" : "accent"} className="mt-2" />
        <p className="mt-1 text-[10.5px] text-muted">{fmtPct(sinceHours / asset.maintenanceIntervalHours, 0)} of interval elapsed</p>
      </div>
      {wos.length > 0 && (
        <div>
          <SectionLabel className="mb-1.5">Work orders</SectionLabel>
          {wos.map((w) => (
            <div key={w.id} className="mb-1.5 rounded-lg border border-maint/30 bg-maint/5 px-3 py-2 text-[12px]">
              <div className="flex justify-between">
                <span className="font-mono text-ink">{w.id}</span>
                <Badge tone={w.status === "completed" ? "healthy" : w.status === "cancelled" ? "neutral" : "maint"}>{w.status}</Badge>
              </div>
              <p className="mt-0.5 text-muted">
                {w.durationHours} h · starts {fmtSimTime(state, w.startHour)} · ${fmtInt(w.cost)}
              </p>
            </div>
          ))}
        </div>
      )}
      <div>
        <SectionLabel className="mb-1.5">History</SectionLabel>
        <ol className="relative space-y-3 border-l border-line pl-4">
          {records.map((m) => (
            <li key={m.id} className="text-[12px]">
              <span className={cn("absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full border-2 border-shell", m.type === "corrective" ? "bg-critical" : m.type === "inspection" ? "bg-accent" : "bg-healthy")} />
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink capitalize">{m.type}</span>
                <span className="text-[11px] text-muted">{m.hour >= -48 ? fmtRelHours(state, m.hour) : `${Math.round(-m.hour / 24)} days ago`}</span>
              </div>
              <p className="mt-0.5 text-ink-2">{m.notes}</p>
              <p className="text-[11px] text-muted">
                {m.durationHours} h · {m.technician} · ${fmtInt(m.cost)}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Dependencies({ state, asset }: { state: FactoryState; asset: Asset }) {
  const selectAsset = useUi((s) => s.selectAsset);
  const line = state.lines.find((l) => l.id === asset.lineId)!;
  const idx = line.assetIds.indexOf(asset.id);
  const up = idx > 0 ? state.assets.find((a) => a.id === line.assetIds[idx - 1]) : null;
  const down = idx < line.assetIds.length - 1 ? state.assets.find((a) => a.id === line.assetIds[idx + 1]) : null;
  const downstreamLine = line.downstreamLineId ? state.lines.find((l) => l.id === line.downstreamLineId) : null;
  const products = Object.keys(line.allocation).filter((p) => line.allocation[p] > 0);
  const items = [...new Set(line.capabilities.filter((c) => products.includes(c.productId)).flatMap((c) => c.bom.map((b) => b.itemId)))];
  const orders = state.orders.filter((o) => products.includes(o.productId) && o.completedHour === null);
  const custom = state.connections.filter((c) => c.source === asset.id || c.target === asset.id);
  const AssetLink = ({ a }: { a: Asset }) => (
    <button onClick={() => selectAsset(a.id)} className="flex w-full items-center justify-between rounded-lg border border-line bg-shell/60 px-3 py-2 text-left text-[12px] hover:border-line-strong">
      <span>
        <span className="font-mono text-ink">{a.id}</span> <span className="text-muted">· {a.name}</span>
      </span>
      <StatusBadge status={a.status} />
    </button>
  );
  return (
    <div className="space-y-4 text-[12px]">
      <div>
        <SectionLabel className="mb-1.5">
          <ArrowUpRight className="mr-1 inline h-3 w-3" />
          Upstream
        </SectionLabel>
        {up ? <AssetLink a={up} /> : <p className="text-muted">Line infeed (materials from stores)</p>}
      </div>
      <div>
        <SectionLabel className="mb-1.5">
          <ArrowDownRight className="mr-1 inline h-3 w-3" />
          Downstream
        </SectionLabel>
        {down ? <AssetLink a={down} /> : <p className="text-muted">{downstreamLine ? `${downstreamLine.name} (merge infeed)` : "Shipping dock — customer orders"}</p>}
      </div>
      <div>
        <SectionLabel className="mb-1.5">
          <Boxes className="mr-1 inline h-3 w-3" />
          Material dependencies ({line.name})
        </SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {items.map((i) => (
            <Badge key={i} tone="neutral">
              {i}
            </Badge>
          ))}
        </div>
      </div>
      <div>
        <SectionLabel className="mb-1.5">
          <Truck className="mr-1 inline h-3 w-3" />
          Orders served
        </SectionLabel>
        {orders.map((o) => (
          <div key={o.id} className="flex justify-between py-1">
            <span>
              <span className="font-mono text-ink">{o.id}</span> <span className="text-muted">{o.customer}</span>
            </span>
            <span className="text-muted">due {fmtRelHours(state, o.dueHour)}</span>
          </div>
        ))}
      </div>
      {custom.length > 0 && (
        <div>
          <SectionLabel className="mb-1.5">
            <Link2 className="mr-1 inline h-3 w-3" />
            User-defined dependencies
          </SectionLabel>
          {custom.map((c) => (
            <p key={c.id} className="font-mono text-ink-2">
              {c.source} → {c.target}
            </p>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted">If this asset stops, {line.name} stops (machines in series){downstreamLine ? ` and ${downstreamLine.name} loses its share of inflow` : ""}.</p>
    </div>
  );
}

interface DocMeta {
  id: string;
  title: string;
  kind: string;
  source: string;
  path: string;
}

function Documents({ asset }: { asset: Asset }) {
  const [data, setData] = useState<{ documents: DocMeta[]; store: string; remoteError: string | null } | null>(null);
  const [open, setOpen] = useState<{ title: string; content: string } | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ documents: DocMeta[]; store: string; remoteError: string | null }>(`/api/documents?assetId=${encodeURIComponent(asset.id)}`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ documents: [], store: "unavailable", remoteError: "Could not load documents" }));
    return () => {
      alive = false;
    };
  }, [asset.id]);
  const view = async (d: DocMeta) => {
    if (d.source !== "local") return;
    try {
      const j = await api<{ title: string; content: string }>(`/api/documents/${d.id}`);
      setOpen({ title: j.title, content: j.content });
    } catch {
      /* the list already shows when documents are unavailable */
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">{data?.store ?? "Loading…"}</p>
      {data?.remoteError && <p className="text-[11px] text-critical-ink">Cloud Storage: {data.remoteError}</p>}
      {data && !data.documents.length && <p className="text-[12px] text-muted">No documents linked to this asset type.</p>}
      {data?.documents.map((d) => (
        <button key={d.id} onClick={() => view(d)} className="flex w-full items-start gap-2.5 rounded-lg border border-line bg-shell/60 p-2.5 text-left hover:border-line-strong">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-medium text-ink">{d.title}</span>
            <span className="block truncate text-[11px] text-muted">
              {d.kind} · {d.path}
            </span>
          </span>
        </button>
      ))}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.title ?? ""} className="max-w-2xl">
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-shell p-4">
          <Markdown text={open?.content ?? ""} />
        </div>
      </Dialog>
    </div>
  );
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
      {lines.map((l, i) => {
        if (l.startsWith("# ")) return <p key={i} className="text-[15px] font-semibold text-ink">{l.slice(2)}</p>;
        if (l.startsWith("## ")) return <p key={i} className="pt-2 text-[13px] font-semibold text-ink">{l.slice(3)}</p>;
        if (l.startsWith("|")) {
          if (/^\|[-\s|]+\|$/.test(l)) return null;
          const cells = l.split("|").slice(1, -1);
          return (
            <div key={i} className="grid grid-cols-3 gap-2 border-b border-line/60 py-1 font-mono text-[11.5px]">
              {cells.map((c, k) => (
                <span key={k}>{c.trim()}</span>
              ))}
            </div>
          );
        }
        if (/^\d+\.\s|^-\s/.test(l)) return <p key={i} className="pl-3">• {l.replace(/^\d+\.\s|^-\s/, "").replace(/\*\*/g, "")}</p>;
        if (!l.trim()) return null;
        return <p key={i}>{l.replace(/\*\*/g, "").replace(/^\*(.*)\*$/, "$1")}</p>;
      })}
    </div>
  );
}

function Configure({ state, asset }: { state: FactoryState; asset: Asset }) {
  const router = useRouter();
  const updateAsset = useFactory((s) => s.updateAsset);
  const injectFault = useFactory((s) => s.injectFault);
  const analyze = useFactory((s) => s.analyze);
  const busy = useFactory((s) => s.busy);
  const [form, setForm] = useState({ name: asset.name, speedPct: asset.speedPct, nominalRate: asset.nominalRate, criticality: asset.criticality, vibrationAlarm: asset.thresholds.vibrationAlarm });
  const [severity, setSeverity] = useState(50);
  useEffect(() => {
    setForm({ name: asset.name, speedPct: asset.speedPct, nominalRate: asset.nominalRate, criticality: asset.criticality, vibrationAlarm: asset.thresholds.vibrationAlarm });
  }, [asset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const patch: Record<string, unknown> = {};
    if (form.name !== asset.name) patch.name = form.name;
    if (form.speedPct !== asset.speedPct) patch.speedPct = form.speedPct;
    if (form.nominalRate !== asset.nominalRate) patch.nominalRate = form.nominalRate;
    if (form.criticality !== asset.criticality) patch.criticality = form.criticality;
    if (form.vibrationAlarm !== asset.thresholds.vibrationAlarm) patch.vibrationAlarm = form.vibrationAlarm;
    if (Object.keys(patch).length) void updateAsset(asset.id, patch);
  };
  const fault = (mode: FaultMode) => injectFault({ assetId: asset.id, mode, severity });

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <SectionLabel>Asset properties</SectionLabel>
        <div className="space-y-1">
          <Label htmlFor="a-name">Name</Label>
          <Input id="a-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="a-rate">Nameplate rate (u/h)</Label>
            <Input id="a-rate" type="number" min={10} max={1000} value={form.nominalRate} onChange={(e) => setForm({ ...form, nominalRate: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="a-crit">Criticality</Label>
            <Select id="a-crit" className="w-full" value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value as Asset["criticality"] })}>
              <option value="A">A — line-stopping</option>
              <option value="B">B — degrades output</option>
              <option value="C">C — redundant</option>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <Label>Commanded speed</Label>
            <span className="tabular text-[12px] text-ink">{form.speedPct}%</span>
          </div>
          <Slider min={30} max={110} step={5} value={[form.speedPct]} onValueChange={([v]) => setForm({ ...form, speedPct: v })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="a-alarm">Vibration alarm (mm/s)</Label>
          <Input id="a-alarm" type="number" step={0.1} value={form.vibrationAlarm} onChange={(e) => setForm({ ...form, vibrationAlarm: Number(e.target.value) })} />
        </div>
        <Button size="sm" variant="primary" onClick={save} loading={busy.updateAsset}>
          <Save className="h-3.5 w-3.5" /> Save changes
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
        <div>
          <SectionLabel className="text-warning-ink">Fault injection</SectionLabel>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
            Introduce a fault to rehearse the response. Effects appear in telemetry, status, incidents and agent analysis; every injection is logged in the audit trail.
          </p>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <Label>Severity</Label>
            <span className="tabular text-[12px] text-ink">{severity}</span>
          </div>
          <Slider min={0} max={100} step={5} value={[severity]} onValueChange={([v]) => setSeverity(v)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="secondary" onClick={() => fault("bearing-wear")} disabled={asset.mode !== "running"} loading={busy.fault}>
            <Waves className="h-3.5 w-3.5" /> Bearing damage
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fault("overheating")} disabled={asset.mode !== "running"}>
            <Flame className="h-3.5 w-3.5" /> Overheating
          </Button>
          <Button size="sm" variant="danger" onClick={() => fault("failure")} disabled={asset.mode === "down"}>
            <PowerOff className="h-3.5 w-3.5" /> Force trip
          </Button>
          <Button size="sm" variant="ghost" onClick={() => fault("restore")}>
            <RotateCcw className="h-3.5 w-3.5" /> Clear fault
          </Button>
        </div>
        <Button
          size="sm"
          variant="agent"
          className="w-full"
          onClick={() => {
            router.push("/agents");
            void analyze();
          }}
        >
          <BrainCircuit className="h-3.5 w-3.5" /> Analyze impact
        </Button>
      </div>
      <p className="text-[10.5px] text-muted">Plant clock: {fmtSimTime(state, state.clock.hour)}</p>
    </div>
  );
}
