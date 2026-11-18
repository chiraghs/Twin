"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { BookOpen, CheckCircle2, Circle, ClipboardCheck, HardHat, Wrench } from "lucide-react";
import { api } from "@/client/api";
import type { Highlight } from "@/client/store";
import { useFactory, useUi } from "@/client/store";
import { Markdown } from "@/components/copilot/copilot-panel";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, Meter } from "@/components/ui/primitives";
import { maintenanceGuide, type MaintenanceGuide, type StepKind } from "@/domain/guided-maintenance";
import type { FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";

const Twin3D = dynamic(() => import("@/components/three/twin-3d").then((m) => m.Twin3D), { ssr: false, loading: () => <div className="h-full animate-pulse rounded-lg bg-surface-2" /> });

const KIND_TONE: Record<StepKind, "critical" | "accent" | "warning" | "healthy" | "neutral"> = { safety: "critical", inspect: "accent", repair: "warning", verify: "healthy", close: "neutral" };

/** Work orders as step-by-step procedures: each step signed by name, the machine highlighted in 3D. */
export default function GuidedMaintenancePage() {
  const state = useFactory((s) => s.state);
  const [selected, setSelected] = useState<string | null>(null);
  if (!state) return null;
  const orders = [...state.workOrders].filter((w) => w.status !== "cancelled").sort((a, b) => order(a.status) - order(b.status) || a.startHour - b.startHour);
  const current = orders.find((w) => w.id === selected) ?? orders[0] ?? null;
  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Guided maintenance"
        description="Every work order as a step-by-step procedure for the technician: lock-out, inspection, repair, a test run that must pass the live limit, and sign-off. Each step is signed by name and recorded in the audit trail."
      />
      {orders.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState icon={<Wrench className="h-5 w-5" />} title="No work orders yet" description="Approve a maintenance plan in Approvals; its work order appears here as a guided procedure." />
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[260px_1fr]">
          <Card>
            <CardHeader title="Work orders" description="Scheduled and in progress first" />
            <CardBody className="max-h-[640px] space-y-1 overflow-auto">
              {orders.map((w) => {
                const g = safeGuide(state, w.id);
                return (
                  <button
                    key={w.id}
                    onClick={() => setSelected(w.id)}
                    className={cn("w-full rounded-lg px-2.5 py-2 text-left text-[12.5px]", current?.id === w.id ? "bg-accent/12 text-ink" : "text-ink-2 hover:bg-surface-2")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11.5px]">{w.id}</span>
                      <Badge tone={w.status === "completed" ? "healthy" : w.status === "in-progress" ? "warning" : "neutral"}>{w.status}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted">
                      {w.assetId} · {g ? `${g.progress.done}/${g.progress.total} steps` : w.reason}
                    </p>
                  </button>
                );
              })}
            </CardBody>
          </Card>
          {current && <GuideView state={state} workOrderId={current.id} />}
        </div>
      )}
    </div>
  );
}

const order = (s: string) => (s === "in-progress" ? 0 : s === "scheduled" ? 1 : 2);

function safeGuide(state: FactoryState, id: string): MaintenanceGuide | null {
  try {
    return maintenanceGuide(state, id);
  } catch {
    return null;
  }
}

function GuideView({ state, workOrderId }: { state: FactoryState; workOrderId: string }) {
  const guide = useMemo(() => safeGuide(state, workOrderId), [state, workOrderId]);
  const apply = useFactory((s) => s.apply);
  const toast = useFactory((s) => s.toast);
  const operator = useUi((s) => s.operator);
  const [busy, setBusy] = useState<string | null>(null);
  if (!guide) return <EmptyState title="This work order's machine no longer exists" />;
  const { asset, workOrder: wo } = guide;
  const highlight: Highlight = { runId: "", scenarioId: "maintenance", scenarioName: "Maintenance", kind: "preventive", assetIds: [asset.id], lineIds: [], itemIds: [], orderIds: [], rerouteLineId: null, targetAssetId: asset.id };

  const sign = async (stepId: string) => {
    setBusy(stepId);
    try {
      const r = await api<{ guide: MaintenanceGuide; state: FactoryState }>(`/api/maintenance/${encodeURIComponent(wo.id)}`, { body: { stepId, by: operator } });
      apply(r.state);
      toast({ tone: "success", title: `${wo.id}: step signed`, detail: `${r.guide.progress.done} of ${r.guide.progress.total} steps done.` });
    } catch (e) {
      toast({ tone: "error", title: "Step not signed", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3 2xl:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader
          title={`${wo.id} · ${asset.name}`}
          description={`${wo.type} maintenance · ${guide.failureMode} · ${wo.durationHours} h window`}
          icon={<HardHat className="h-4 w-4" />}
          actions={<Badge tone={guide.progress.done === guide.progress.total ? "healthy" : "neutral"}>{guide.progress.done}/{guide.progress.total} signed</Badge>}
        />
        <CardBody className="space-y-2.5">
          <Meter value={(guide.progress.done / guide.progress.total) * 100} tone={guide.progress.done === guide.progress.total ? "healthy" : "accent"} />
          <ol className="space-y-2" data-testid="guide-steps">
            {guide.steps.map((s, i) => {
              const next = guide.nextStepId === s.id;
              return (
                <li key={s.id} className={cn("rounded-lg border p-2.5", next ? "border-accent/50 bg-accent/6" : "border-line")}>
                  <div className="flex items-start gap-2">
                    {s.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-healthy" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-medium text-ink">
                          {i + 1}. {s.title}
                        </span>
                        <Badge tone={KIND_TONE[s.kind]}>{s.kind}</Badge>
                      </div>
                      <p className="mt-0.5 text-[12px] text-ink-2">{s.detail}</p>
                      {s.check && (
                        <p className={cn("mt-1 text-[12px] font-medium", s.check.pass ? "text-healthy-ink" : "text-warning-ink")}>
                          Live {s.check.label.toLowerCase()}: {s.check.value} {s.check.unit} (limit {s.check.limit}) · {s.check.pass ? "passes" : "not yet"}
                        </p>
                      )}
                      {s.done && <p className="mt-1 text-[11px] text-muted">Signed by {s.done.by} · {new Date(s.done.at).toLocaleString()}</p>}
                    </div>
                    {next && (
                      <Button size="sm" variant="primary" loading={busy === s.id} disabled={!!s.check && !s.check.pass} onClick={() => sign(s.id)}>
                        <ClipboardCheck className="h-3.5 w-3.5" /> Sign
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </CardBody>
      </Card>
      <div className="space-y-3">
        <Card>
          <CardHeader title="Where" description={`${asset.id} highlighted in the live twin`} />
          <CardBody>
            <div className="h-[340px] overflow-hidden rounded-lg">
              <Twin3D state={state} highlight={highlight} selectedId={asset.id} onSelect={() => {}} orderRisk={{}} />
            </div>
          </CardBody>
        </Card>
        <Manuals assetId={asset.id} />
      </div>
    </div>
  );
}

function Manuals({ assetId }: { assetId: string }) {
  const [docs, setDocs] = useState<{ id: string; title: string }[] | null>(null);
  const [open, setOpen] = useState<{ title: string; content: string } | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ documents: { id: string; title: string }[] }>(`/api/documents?assetId=${encodeURIComponent(assetId)}`)
      .then((d) => alive && setDocs(d.documents))
      .catch(() => alive && setDocs([]));
    return () => {
      alive = false;
    };
  }, [assetId]);
  return (
    <Card>
      <CardHeader title="Manuals and procedures" description="Linked to this machine type" icon={<BookOpen className="h-4 w-4" />} />
      <CardBody className="space-y-1 text-[12.5px]">
        {docs === null ? <p className="text-muted">Loading…</p> : docs.length === 0 ? <p className="text-muted">No documents linked to this machine type.</p> : null}
        {docs?.map((d) => (
          <button
            key={d.id}
            className="block w-full truncate rounded-md px-2 py-1 text-left text-accent-ink hover:bg-surface-2"
            onClick={async () => setOpen(await api<{ title: string; content: string }>(`/api/documents/${encodeURIComponent(d.id)}`))}
          >
            {d.title}
          </button>
        ))}
      </CardBody>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.title ?? ""}>
        <div className="max-h-[60vh] overflow-auto text-[12.5px]">{open && <Markdown text={open.content} />}</div>
      </Dialog>
    </Card>
  );
}
