"use client";

import { useMemo, useState } from "react";
import { Gauge, Power, RotateCcw, ShieldAlert, Thermometer, Waves, Zap } from "lucide-react";
import { useAdmin } from "@/client/admin";
import { useFactory } from "@/client/store";
import { AdminAccess } from "@/components/admin/admin-access";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Slider } from "@/components/ui/primitives";
import { assetSignals, lineFlow, lineOutput, type LiveSignal } from "@/domain/live";
import type { Asset, FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";

const STATE_TONE = { ok: "healthy", alarm: "warning", trip: "critical" } as const;
const STATUS_DOT: Record<Asset["status"], string> = { healthy: "bg-healthy", warning: "bg-warning", critical: "bg-critical", offline: "bg-muted", maintenance: "bg-maint" };

/** Live signals of every machine, and commissioning commands that act on the twin (simulated, audited). */
export default function CommissioningPage() {
  const state = useFactory((s) => s.state);
  const [selected, setSelected] = useState<string | null>(null);
  if (!state) return null;
  const asset = state.assets.find((a) => a.id === (selected ?? state.assets[0]?.id)) ?? null;
  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Signals & commissioning"
        description="Every machine's live signals with their alarm and trip limits. In commissioning mode you can change setpoints and trip, degrade or restore a machine to test how the plant, the agents and the operators respond. Commands act on the twin only, never on real equipment, and every one is audited."
        actions={<AdminAccess />}
      />
      <LineStrip state={state} />
      <div className="grid gap-3 xl:grid-cols-[260px_1fr_320px]">
        <MachineList state={state} selectedId={asset?.id ?? null} onSelect={setSelected} />
        {asset ? <SignalTable state={state} asset={asset} /> : <EmptyState title="No machines" />}
        {asset && <Commands asset={asset} />}
      </div>
    </div>
  );
}

function LineStrip({ state }: { state: FactoryState }) {
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="line-strip">
      {state.lines.map((l) => {
        const flow = lineFlow(state, l.id);
        return (
          <Card key={l.id}>
            <CardBody className="py-2.5">
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-medium text-ink">{l.name}</span>
                <Badge tone={flow > 0 ? "healthy" : "critical"}>{l.state}</Badge>
              </div>
              <p className="mt-1 text-[11.5px] text-muted">
                Pace {Math.round(flow * 100)}% of nameplate · {lineOutput(state, l.id).toLocaleString("en-US")} good units in 8 h
              </p>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

function MachineList({ state, selectedId, onSelect }: { state: FactoryState; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <Card>
      <CardHeader title="Machines" description="By line, in flow order" />
      <CardBody className="max-h-[560px] space-y-3 overflow-auto">
        {state.lines.map((l) => (
          <div key={l.id}>
            <p className="mb-1 text-[10.5px] font-semibold tracking-[0.08em] text-muted uppercase">{l.name}</p>
            {l.assetIds.map((id) => {
              const a = state.assets.find((x) => x.id === id);
              if (!a) return null;
              return (
                <button
                  key={id}
                  onClick={() => onSelect(id)}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px]", selectedId === id ? "bg-accent/12 text-ink" : "text-ink-2 hover:bg-surface-2")}
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[a.status])} />
                  <span className="font-mono text-[11px] text-muted">{a.id}</span>
                  <span className="truncate">{a.name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function SignalTable({ state, asset }: { state: FactoryState; asset: Asset }) {
  const signals = useMemo(() => assetSignals(state, asset), [state, asset]);
  const history = state.telemetry[asset.id] ?? [];
  return (
    <Card>
      <CardHeader title={`${asset.id} · ${asset.name}`} description={`Mode ${asset.mode} · status ${asset.status} · updates with every live tick`} icon={<Gauge className="h-4 w-4" />} />
      <CardBody className="overflow-x-auto">
        <table className="w-full text-[12.5px]" data-testid="signal-table">
          <thead className="text-left text-muted">
            <tr>
              {["Signal", "Value", "Limits", "State", "Trend (last readings)"].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="px-2 py-1.5">
                  <span className="text-ink">{s.name}</span>
                  <span className="ml-1.5 font-mono text-[10.5px] text-muted">{s.id}</span>
                </td>
                <td className="tabular px-2 py-1.5 font-mono text-ink">{fmt(s)}</td>
                <td className="tabular px-2 py-1.5 text-muted">{s.limits ? `alarm ${s.limits.alarm} · trip ${s.limits.trip}` : "—"}</td>
                <td className="px-2 py-1.5">
                  <Badge tone={STATE_TONE[s.state]}>{s.state}</Badge>
                </td>
                <td className="px-2 py-1.5">{s.name === "Vibration" || s.name === "Temperature" ? <Spark values={history.slice(-36).map((r) => (s.name === "Vibration" ? r.vibration : r.temperature))} limit={s.limits?.alarm} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

const fmt = (s: LiveSignal) => (s.kind === "bool" ? (s.value ? "TRUE" : "FALSE") : `${s.value} ${s.unit}`.trim());

/** A small inline trend with the alarm limit as a dashed line. */
function Spark({ values, limit }: { values: number[]; limit?: number }) {
  if (values.length < 2) return <span className="text-muted">—</span>;
  const max = Math.max(...values, limit ?? 0) * 1.08;
  const min = Math.min(...values) * 0.92;
  const W = 140, H = 28;
  const y = (v: number) => H - ((v - min) / Math.max(1e-6, max - min)) * H;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} aria-hidden>
      {limit != null && <line x1={0} x2={W} y1={y(limit)} y2={y(limit)} stroke="var(--color-warning)" strokeDasharray="3 3" strokeWidth={1} />}
      <path d={d} fill="none" stroke="var(--color-series-1)" strokeWidth={1.6} />
    </svg>
  );
}

function Commands({ asset }: { asset: Asset }) {
  const admin = useAdmin((s) => s.admin);
  const injectFault = useFactory((s) => s.injectFault);
  const updateAsset = useFactory((s) => s.updateAsset);
  const busy = useFactory((s) => s.busy);
  const [speed, setSpeed] = useState<number | null>(null);
  const value = speed ?? asset.speedPct;
  const running = asset.mode === "running";
  const commands = [
    { label: "Trip (stop with a fault)", icon: Power, tone: "danger" as const, disabled: !running, run: () => injectFault({ assetId: asset.id, mode: "failure", severity: 100 }) },
    { label: "Inject bearing wear", icon: Waves, tone: "secondary" as const, disabled: !running, run: () => injectFault({ assetId: asset.id, mode: "bearing-wear", severity: 50 }) },
    { label: "Inject overheating", icon: Thermometer, tone: "secondary" as const, disabled: !running, run: () => injectFault({ assetId: asset.id, mode: "overheating", severity: 50 }) },
    { label: "Restore (clear faults)", icon: RotateCcw, tone: "secondary" as const, disabled: false, run: () => injectFault({ assetId: asset.id, mode: "restore", severity: 0 }) },
  ];
  return (
    <Card>
      <CardHeader title="Commissioning commands" description="Act on the twin only (simulated); audited with your name." icon={<Zap className="h-4 w-4" />} />
      <CardBody className="space-y-3 text-[12.5px]">
        {!admin && (
          <p className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/8 p-2 text-[12px] text-warning-ink">
            <ShieldAlert className="h-3.5 w-3.5" /> Unlock admin to send commands.
          </p>
        )}
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <span className="text-ink-2">Speed setpoint</span>
            <span className="tabular font-mono text-ink">{value}%</span>
          </div>
          <Slider aria-label="Speed setpoint" min={30} max={110} step={5} value={[value]} onValueChange={([v]) => setSpeed(v)} disabled={!admin} />
          <Button size="sm" variant="primary" className="w-full" disabled={!admin || value === asset.speedPct} loading={!!busy.updateAsset} onClick={async () => (await updateAsset(asset.id, { speedPct: value })) && setSpeed(null)}>
            Apply {value}%
          </Button>
        </div>
        <div className="space-y-1.5 border-t border-line pt-3">
          {commands.map((c) => (
            <Button key={c.label} size="sm" variant={c.tone} className="w-full justify-start" disabled={!admin || c.disabled} loading={!!busy.fault} onClick={c.run}>
              <c.icon className="h-3.5 w-3.5" /> {c.label}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted">The 3D view, the alarms, the agents and the analytics all see the result on the next live tick.</p>
      </CardBody>
    </Card>
  );
}
