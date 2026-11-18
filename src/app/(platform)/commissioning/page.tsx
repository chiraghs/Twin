"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Camera, Gauge, Hand, Home, Minus, Plus, Power, RotateCcw, ShieldAlert, Thermometer, Trash2, Waves, Zap } from "lucide-react";
import { useJog } from "@/client/jog";
import { FieldSignals } from "@/components/commissioning/field-signals";
import { TransportPanel } from "@/components/commissioning/transport";
import { atLimit, machineAxes, type AxisDef } from "@/domain/axes";
import { api } from "@/client/api";
import { useAdmin } from "@/client/admin";
import { useFactory, useUi } from "@/client/store";
import { AdminAccess } from "@/components/admin/admin-access";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Slider } from "@/components/ui/primitives";
import { assetSignals, lineFlow, lineOutput, type LiveSignal } from "@/domain/live";
import type { Asset, FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";

const MachinePreview = dynamic(() => import("@/components/three/machine-preview").then((m) => m.MachinePreview), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-surface-2" />,
});

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
        {asset ? (
          <div className="min-w-0 space-y-3">
            <SignalTable state={state} asset={asset} />
            <Axes state={state} asset={asset} />
          </div>
        ) : (
          <EmptyState title="No machines" />
        )}
        {asset && (
          <div className="space-y-3">
            <Commands asset={asset} />
            <Snapshots />
          </div>
        )}
      </div>
      {asset && <FieldSignals state={state} asset={asset} />}
      {asset && <TransportPanel state={state} lineId={asset.lineId} />}
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

interface SnapshotMeta {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  simHour: number;
  bytes: number;
}

/** Save the whole twin under a name before a test, and restore it afterwards (admin). */
function Snapshots() {
  const admin = useAdmin((s) => s.admin);
  const apply = useFactory((s) => s.apply);
  const toast = useFactory((s) => s.toast);
  const operator = useUi((s) => s.operator);
  const [list, setList] = useState<SnapshotMeta[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setList((await api<{ snapshots: SnapshotMeta[] }>("/api/snapshots")).snapshots);
    } catch {
      setList([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try {
      toast({ tone: "success", title: await fn() });
      await load();
    } catch (e) {
      toast({ tone: "error", title: "Snapshot action failed", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader title="Snapshots" description="Save the whole twin before a test; restore it afterwards." icon={<Camera className="h-4 w-4" />} />
      <CardBody className="space-y-2.5 text-[12.5px]">
        <div className="flex gap-2">
          <Input aria-label="Snapshot name" placeholder="e.g. Before trip test" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <Button
            size="sm"
            variant="secondary"
            disabled={!name.trim()}
            loading={busy === "save"}
            onClick={() =>
              act("save", async () => {
                await api("/api/snapshots", { body: { name: name.trim(), by: operator } });
                setName("");
                return "Snapshot saved";
              })
            }
          >
            Save
          </Button>
        </div>
        <ul className="space-y-1" data-testid="snapshot-list">
          {list?.length === 0 && <li className="text-muted">No snapshots yet.</li>}
          {list?.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-ink">{s.name}</p>
                <p className="text-[11px] text-muted">
                  h{s.simHour.toFixed(1)} · {s.createdBy} · {new Date(s.createdAt).toLocaleString()}
                </p>
              </div>
              <Button
                size="xs"
                variant="secondary"
                disabled={!admin}
                loading={busy === s.id}
                onClick={() =>
                  act(s.id, async () => {
                    const r = await api<{ state: FactoryState }>(`/api/snapshots/${encodeURIComponent(s.id)}`, { body: { by: operator } });
                    apply(r.state);
                    return `Restored "${s.name}"`;
                  })
                }
              >
                Restore
              </Button>
              <button
                aria-label={`Delete snapshot ${s.name}`}
                disabled={!admin}
                className="text-muted hover:text-critical disabled:opacity-40"
                onClick={() =>
                  act(`del-${s.id}`, async () => {
                    await api(`/api/snapshots/${encodeURIComponent(s.id)}`, { method: "DELETE" });
                    return "Snapshot deleted";
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        {!admin && <p className="text-[11px] text-muted">Restoring and deleting need admin.</p>}
      </CardBody>
    </Card>
  );
}

/** Hold to jog: one step on press, then repeats while the button is held. */
function JogButton({ label, onStep, disabled, children }: { label: string; onStep: () => void; disabled: boolean; children: React.ReactNode }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const step = useRef(onStep);
  step.current = onStep;
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  return (
    <button
      aria-label={label}
      disabled={disabled}
      onPointerDown={() => {
        step.current();
        stop();
        timer.current = setInterval(() => step.current(), 110);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && step.current()}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Manual mode: jog each axis of the machine and watch the twin move (twin only, never equipment). */
function Axes({ state, asset }: { state: FactoryState; asset: Asset }) {
  const admin = useAdmin((s) => s.admin);
  const axes = machineAxes(asset.kind);
  const pose = useJog((s) => s.manual[asset.id] ?? null);
  const { enter, leave, jog, set, home } = useJog();
  if (!axes.length) return null;
  const manual = !!pose;
  return (
    <Card>
      <CardHeader
        title="Axes · manual jog"
        description="Take the machine into manual mode and jog each axis to check motion and limits. The 3D twin follows; nothing is sent to equipment."
        icon={<Hand className="h-4 w-4" />}
        actions={
          <Button size="sm" variant={manual ? "primary" : "secondary"} disabled={!admin} onClick={() => (manual ? leave(asset.id) : enter(asset.id, asset.kind))}>
            {manual ? "Back to auto" : "Manual mode"}
          </Button>
        }
      />
      <CardBody className="grid gap-3 md:grid-cols-[1fr_1.1fr]">
        <div className="h-56 overflow-hidden rounded-lg border border-line bg-shell" data-testid="machine-preview">
          <MachinePreview state={state} assetId={asset.id} />
        </div>
        <div className="space-y-2 text-[12.5px]" data-testid="axes">
          {axes.map((a: AxisDef) => {
            const v = pose?.[a.id] ?? a.home;
            const limit = manual && atLimit(a, v);
            return (
              <div key={a.id} className="rounded-md border border-line px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-ink">{a.name}</span>
                  {limit && <Badge tone="warning">limit</Badge>}
                  <span className="tabular w-16 text-right font-mono text-ink" data-testid={`axis-${a.id}`}>
                    {Math.round(v)} {a.unit}
                  </span>
                  <JogButton label={`Jog ${a.name} minus`} disabled={!manual} onStep={() => jog(asset.id, asset.kind, a.id, -a.step)}>
                    <Minus className="h-3.5 w-3.5" />
                  </JogButton>
                  <JogButton label={`Jog ${a.name} plus`} disabled={!manual} onStep={() => jog(asset.id, asset.kind, a.id, a.step)}>
                    <Plus className="h-3.5 w-3.5" />
                  </JogButton>
                </div>
                <Slider aria-label={`${a.name} position`} min={a.min} max={a.max} step={a.step / 5} value={[v]} disabled={!manual} onValueChange={([x]) => set(asset.id, asset.kind, a.id, x)} className="mt-1" />
                <p className="mt-0.5 text-[10.5px] text-muted">
                  {a.endless ? "endless" : `${a.min} to ${a.max} ${a.unit}`} · step {a.step} {a.unit}
                </p>
              </div>
            );
          })}
          <Button size="sm" variant="secondary" disabled={!manual} onClick={() => home(asset.id, asset.kind)}>
            <Home className="h-3.5 w-3.5" /> Home all axes
          </Button>
          {!admin && <p className="text-[11px] text-muted">Manual mode needs admin.</p>}
        </div>
      </CardBody>
    </Card>
  );
}
