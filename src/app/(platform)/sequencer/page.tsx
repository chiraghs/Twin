"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Clock, Columns2, ListOrdered, Play, Plus, Save, Square, Timer, Trash2, Zap } from "lucide-react";
import { api } from "@/client/api";
import { useAdmin } from "@/client/admin";
import { useFactory, useUi } from "@/client/store";
import { AdminAccess } from "@/components/admin/admin-access";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Select, type Tone } from "@/components/ui/primitives";
import { assetSignals } from "@/domain/live";
import { lineStartupTemplate, runSequence, type SeqCommand, type SeqOp, type SeqStep, type Sequence, type StepStatus } from "@/domain/sequences";
import type { FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";

type Leaf = Exclude<SeqStep, { kind: "parallel" }>;
const STATUS_TONE: Record<StepStatus, Tone> = { pending: "neutral", running: "accent", done: "healthy", failed: "critical", skipped: "neutral" };
let seq = 1;
const newId = () => `st${Date.now().toString(36)}${seq++}`;

function blank(kind: SeqStep["kind"], s: FactoryState): SeqStep {
  const a = s.assets[0]?.id ?? "";
  if (kind === "command") return { id: newId(), kind, assetId: a, command: "start" };
  if (kind === "wait") return { id: newId(), kind, signalId: `${a}.Running`, op: "=", value: true, timeoutS: 30 };
  if (kind === "delay") return { id: newId(), kind, seconds: 5 };
  return { id: newId(), kind: "parallel", branches: [[blank("command", s) as Leaf], [blank("delay", s) as Leaf]] };
}

/** Commissioning sequences: build start-up and test routines step by step and run them on the twin. */
export default function SequencerPage() {
  const state = useFactory((s) => s.state);
  const apply = useFactory((s) => s.apply);
  const toast = useFactory((s) => s.toast);
  const admin = useAdmin((s) => s.admin);
  const operator = useUi((s) => s.operator);
  const [list, setList] = useState<Sequence[]>([]);
  const [current, setCurrent] = useState<{ id?: string; name: string; steps: SeqStep[] } | null>(null);
  const [status, setStatus] = useState<Record<string, { s: StepStatus; note?: string }>>({});
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => setList((await api<{ sequences: Sequence[] }>("/api/sequences")).sequences), []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => () => abort.current?.abort(), []);

  if (!state) return null;

  const save = async () => {
    if (!current) return;
    setSaving(true);
    try {
      const r = await api<{ sequence: Sequence }>("/api/sequences", { body: { ...current, by: operator } });
      setCurrent({ id: r.sequence.id, name: r.sequence.name, steps: r.sequence.steps });
      toast({ tone: "success", title: "Sequence saved" });
      await load();
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save the sequence", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const run = async () => {
    if (!current) return;
    abort.current = new AbortController();
    setRunning(true);
    setStatus({});
    try {
      await runSequence(current.steps, {
        getState: () => useFactory.getState().state!,
        command: async (assetId: string, command: SeqCommand, value?: number) => {
          if (command === "speed") apply((await api<{ state: FactoryState }>(`/api/assets/${assetId}`, { method: "PATCH", body: { speedPct: value } })).state);
          else apply(await api<FactoryState>("/api/faults", { body: { assetId, mode: command === "stop" ? "failure" : "restore", severity: command === "stop" ? 100 : 0 } }));
        },
        sleep: (ms) =>
          new Promise((resolve) => {
            const t = setTimeout(resolve, ms);
            abort.current?.signal.addEventListener("abort", () => {
              clearTimeout(t);
              resolve();
            });
          }),
        onStatus: (id, s, note) => setStatus((prev) => ({ ...prev, [id]: { s, note } })),
        signal: abort.current.signal,
        pollMs: 500,
      });
      toast({ tone: "success", title: `Sequence "${current.name}" completed` });
    } catch (e) {
      toast({ tone: "error", title: "Sequence stopped", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Sequencer"
        description="Build commissioning sequences: start-ups, shutdowns and test routines. Steps run in order; a parallel step runs its branches at the same time. Waits hold until a twin signal meets its condition. Commands act on the twin only and are audited."
        actions={<AdminAccess />}
      />
      <div className="grid gap-3 xl:grid-cols-[260px_1fr]">
        <Card>
          <CardHeader title="Sequences" icon={<ListOrdered className="h-4 w-4" />} />
          <CardBody className="space-y-2 text-[12.5px]">
            <ul className="space-y-1" data-testid="sequence-list">
              {list.length === 0 && <li className="text-muted">None yet.</li>}
              {list.map((x) => (
                <li key={x.id} className="flex items-center gap-1">
                  <button onClick={() => (setCurrent({ id: x.id, name: x.name, steps: x.steps }), setStatus({}))} className={cn("min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left hover:bg-surface-2", current?.id === x.id ? "bg-surface-2 text-ink" : "text-ink-2")}>
                    {x.name}
                  </button>
                  <button
                    aria-label={`Delete ${x.name}`}
                    className="p-1 text-muted hover:text-critical"
                    onClick={async () => {
                      await api(`/api/sequences/${x.id}`, { method: "DELETE" });
                      if (current?.id === x.id) setCurrent(null);
                      await load();
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <Button size="sm" variant="secondary" className="w-full" onClick={() => (setCurrent({ name: "New sequence", steps: [] }), setStatus({}))}>
              <Plus className="h-3.5 w-3.5" /> New sequence
            </Button>
            {state.lines.map((l) => (
              <Button key={l.id} size="sm" variant="ghost" className="w-full justify-start" onClick={() => (setCurrent({ name: `${l.name} start-up`, steps: lineStartupTemplate(state, l.id) }), setStatus({}))}>
                <Zap className="h-3.5 w-3.5" /> {l.name} start-up template
              </Button>
            ))}
          </CardBody>
        </Card>
        {!current ? (
          <EmptyState title="Pick or create a sequence" description="Start from a line start-up template: each machine is started in flow order and the sequence waits until it runs." />
        ) : (
          <Card>
            <CardHeader
              title={<Input aria-label="Sequence name" value={current.name} maxLength={80} onChange={(e) => setCurrent({ ...current, name: e.target.value })} className="h-8 max-w-md font-medium" />}
              actions={
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" loading={saving} onClick={save} disabled={running}>
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                  {running ? (
                    <Button size="sm" variant="danger" onClick={() => abort.current?.abort()}>
                      <Square className="h-3.5 w-3.5" /> Stop
                    </Button>
                  ) : (
                    <Button size="sm" variant="primary" disabled={!admin || !current.steps.length} onClick={run} data-testid="run-sequence">
                      <Play className="h-3.5 w-3.5" /> Run on the twin
                    </Button>
                  )}
                </div>
              }
            />
            <CardBody className="space-y-2">
              {!admin && <p className="text-[11.5px] text-muted">Running a sequence needs admin.</p>}
              <StepList state={state} steps={current.steps} status={status} disabled={running} onChange={(steps) => setCurrent({ ...current, steps })} allowParallel />
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function StepList({ state, steps, status, disabled, onChange, allowParallel }: { state: FactoryState; steps: SeqStep[]; status: Record<string, { s: StepStatus; note?: string }>; disabled: boolean; onChange: (s: SeqStep[]) => void; allowParallel: boolean }) {
  const set = (i: number, s: SeqStep) => onChange(steps.map((x, j) => (j === i ? s : x)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-1.5" data-testid="sequence-steps">
      {steps.map((s, i) => {
        const st = status[s.id];
        return (
          <div key={s.id} className={cn("rounded-lg border px-2 py-1.5", st?.s === "running" ? "border-accent" : st?.s === "failed" ? "border-critical" : "border-line")}>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="w-5 text-right font-mono text-muted">{i + 1}</span>
              {s.kind === "parallel" ? (
                <span className="flex items-center gap-1 font-medium text-ink">
                  <Columns2 className="h-3.5 w-3.5" /> Parallel
                </span>
              ) : (
                <LeafEditor state={state} step={s} disabled={disabled} onChange={(x) => set(i, x)} />
              )}
              <span className="ml-auto flex items-center gap-1">
                {st && <Badge tone={STATUS_TONE[st.s]}>{st.s}</Badge>}
                <button aria-label="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="p-1 text-muted hover:text-ink disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button aria-label="Move down" disabled={disabled || i === steps.length - 1} onClick={() => move(i, 1)} className="p-1 text-muted hover:text-ink disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button aria-label="Remove step" disabled={disabled} onClick={() => onChange(steps.filter((_, j) => j !== i))} className="p-1 text-muted hover:text-critical disabled:opacity-30">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
            {st?.note && <p className="mt-1 pl-7 text-[11.5px] text-critical-ink">{st.note}</p>}
            {s.kind === "parallel" && (
              <div className="mt-1.5 grid gap-2 pl-7" style={{ gridTemplateColumns: `repeat(${s.branches.length}, minmax(0, 1fr))` }}>
                {s.branches.map((b, bi) => (
                  <div key={bi} className="rounded-md border border-dashed border-line p-1.5">
                    <p className="mb-1 text-[10.5px] font-medium tracking-wide text-muted uppercase">Branch {bi + 1}</p>
                    <StepList
                      state={state}
                      steps={b}
                      status={status}
                      disabled={disabled}
                      allowParallel={false}
                      onChange={(nb) => set(i, { ...s, branches: s.branches.map((x, k) => (k === bi ? (nb as Leaf[]) : x)) })}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {(
          [
            ["command", "Command", Zap],
            ["wait", "Wait for signal", Timer],
            ["delay", "Delay", Clock],
            ...(allowParallel ? [["parallel", "Parallel", Columns2]] : []),
          ] as [SeqStep["kind"], string, typeof Zap][]
        ).map(([k, label, Icon]) => (
          <Button key={k} size="xs" variant="ghost" disabled={disabled} onClick={() => onChange([...steps, blank(k, state)])}>
            <Icon className="h-3 w-3" /> {label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function LeafEditor({ state, step, disabled, onChange }: { state: FactoryState; step: Leaf; disabled: boolean; onChange: (s: Leaf) => void }) {
  const signals = useMemo(() => state.assets.flatMap((a) => assetSignals(state, a).map((x) => ({ id: x.id, kind: x.kind }))), [state]);
  if (step.kind === "command")
    return (
      <>
        <Select aria-label="Command" disabled={disabled} value={step.command} onChange={(e) => onChange({ ...step, command: e.target.value as SeqCommand, value: e.target.value === "speed" ? (step.value ?? 100) : undefined })}>
          <option value="start">Start</option>
          <option value="stop">Stop</option>
          <option value="speed">Set speed</option>
        </Select>
        <Select aria-label="Machine" disabled={disabled} value={step.assetId} onChange={(e) => onChange({ ...step, assetId: e.target.value })}>
          {state.assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} · {a.name}
            </option>
          ))}
        </Select>
        {step.command === "speed" && <Input aria-label="Speed %" type="number" min={30} max={110} className="w-20" disabled={disabled} value={step.value ?? 100} onChange={(e) => onChange({ ...step, value: Number(e.target.value) })} />}
      </>
    );
  if (step.kind === "delay")
    return (
      <>
        <span className="text-ink-2">Wait</span>
        <Input aria-label="Seconds" type="number" min={0} max={3600} className="w-20" disabled={disabled} value={step.seconds} onChange={(e) => onChange({ ...step, seconds: Number(e.target.value) })} />
        <span className="text-ink-2">s</span>
      </>
    );
  const isBool = signals.find((x) => x.id === step.signalId)?.kind === "bool";
  return (
    <>
      <span className="text-ink-2">Wait until</span>
      <Select aria-label="Signal" disabled={disabled} value={step.signalId} onChange={(e) => onChange({ ...step, signalId: e.target.value, ...(signals.find((x) => x.id === e.target.value)?.kind === "bool" ? { op: "=" as SeqOp, value: true } : { op: ">" as SeqOp, value: 0 }) })}>
        {signals.map((x) => (
          <option key={x.id} value={x.id}>
            {x.id}
          </option>
        ))}
      </Select>
      {isBool ? (
        <Select aria-label="Value" disabled={disabled} value={String(step.value)} onChange={(e) => onChange({ ...step, op: "=", value: e.target.value === "true" })}>
          <option value="true">= true</option>
          <option value="false">= false</option>
        </Select>
      ) : (
        <>
          <Select aria-label="Comparison" disabled={disabled} value={step.op} onChange={(e) => onChange({ ...step, op: e.target.value as SeqOp })}>
            {[">", ">=", "<", "<=", "="].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
          <Input aria-label="Target" type="number" step="any" className="w-20" disabled={disabled} value={Number(step.value)} onChange={(e) => onChange({ ...step, value: Number(e.target.value) })} />
        </>
      )}
      <span className="text-ink-2">within</span>
      <Input aria-label="Timeout seconds" type="number" min={1} max={3600} className="w-20" disabled={disabled} value={step.timeoutS} onChange={(e) => onChange({ ...step, timeoutS: Number(e.target.value) })} />
      <span className="text-ink-2">s</span>
    </>
  );
}
