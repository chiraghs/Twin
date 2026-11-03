"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, ClipboardCheck, FastForward, History, Loader2, Network, RotateCcw, Undo2, Wrench, XCircle } from "lucide-react";
import { useFactory, useUi } from "@/client/store";
import { KeyValue, PageHeader, SectionLabel } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, Dialog, EmptyState, Input, Label, Textarea, type Tone } from "@/components/ui/primitives";
import type { Directive, FactoryState, Recommendation } from "@/domain/types";
import { describeAllocation } from "@/domain/world";
import { cn } from "@/lib/cn";
import { fmtInt, fmtMoney, fmtRelHours, fmtSimTime } from "@/lib/format";

const STATUS_TONE: Record<Recommendation["status"], Tone> = {
  pending: "warning",
  approved: "healthy",
  rejected: "critical",
  "rolled-back": "neutral",
  superseded: "neutral",
};

export default function ApprovalsPage() {
  const state = useFactory((s) => s.state)!;
  const recs = state.recommendations;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId || !recs.some((r) => r.id === selectedId)) setSelectedId(recs.find((r) => r.status === "pending")?.id ?? recs[0]?.id ?? null);
  }, [recs, selectedId]);
  const rec = recs.find((r) => r.id === selectedId) ?? null;
  const pending = recs.filter((r) => r.status === "pending").length;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Human Approval & Execution"
        description="AI recommendations never act on their own. Review the proposed actions, evidence, risks and rollback options; approval applies the plan to the twin."
      />
      {!recs.length ? (
        <Card>
          <EmptyState
            icon={<ClipboardCheck className="h-5 w-5" />}
            title="No recommendations yet"
            description="Run the agent analysis or send a scenario from the simulator to create a recommendation for review."
            action={
              <div className="flex gap-2">
                <Button size="sm" variant="primary" asChild>
                  <Link href="/agents">Run agent analysis</Link>
                </Button>
                <Button size="sm" variant="secondary" asChild>
                  <Link href="/simulator">Open simulator</Link>
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
          <Card className="self-start">
            <CardHeader title="Queue" description={`${pending} pending · ${recs.length} total`} />
            <div className="space-y-1 px-2 pb-2">
              {recs.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={cn("w-full rounded-lg border p-2.5 text-left transition-colors", r.id === selectedId ? "border-accent/50 bg-surface-2" : "border-transparent hover:bg-surface-2/60")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11.5px] text-ink">{r.id}</span>
                    <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-ink-2">{r.title}</p>
                  <p className="mt-1 text-[10.5px] text-muted">
                    {r.source === "orchestrator" ? "Operations Orchestrator" : r.source === "rule" ? "Automation rule" : "Operator"} · {fmtSimTime(state, r.createdHour)}
                  </p>
                </button>
              ))}
            </div>
          </Card>
          {rec && <RecommendationDetail state={state} rec={rec} />}
        </div>
      )}
    </div>
  );
}

function RecommendationDetail({ state, rec }: { state: FactoryState; rec: Recommendation }) {
  const approve = useFactory((s) => s.approve);
  const reject = useFactory((s) => s.reject);
  const rollback = useFactory((s) => s.rollback);
  const advance = useFactory((s) => s.advance);
  const busy = useFactory((s) => s.busy);
  const operator = useUi((s) => s.operator);
  const setOperator = useUi((s) => s.setOperator);
  const [dialog, setDialog] = useState<"approve" | "reject" | "rollback" | null>(null);
  const [note, setNote] = useState("");
  const directives = state.directives.filter((d) => d.recommendationId === rec.id);
  const run = state.scenarioRuns.find((r) => r.id === rec.scenarioRunId);

  const confirm = async () => {
    const ok = dialog === "approve" ? await approve(rec.id, operator, note) : dialog === "reject" ? await reject(rec.id, operator, note) : await rollback(rec.id, operator);
    if (ok) {
      setDialog(null);
      setNote("");
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <Card className={cn(rec.status === "pending" && "border-warning/40")}>
        <CardBody className="pt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] text-muted">{rec.id}</span>
                <Badge tone={STATUS_TONE[rec.status]}>{rec.status}</Badge>
                <Badge tone="neutral">Scenario: {rec.scenarioName}</Badge>
                <Badge tone={rec.confidence.level === "high" ? "healthy" : rec.confidence.level === "medium" ? "warning" : "critical"}>Confidence {rec.confidence.level}</Badge>
              </div>
              <h3 className="mt-2 text-[17px] font-semibold tracking-tight text-ink">{rec.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{rec.reason}</p>
              <p className="mt-1 text-[11.5px] text-muted">
                Proposed by {rec.source === "orchestrator" ? "Operations Orchestrator" : rec.source === "rule" ? "an automation rule" : "operator"} at {fmtSimTime(state, rec.createdHour)} · based on {rec.scenarioRunId}
                {rec.analysisId ? ` · ${rec.analysisId}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {rec.status === "pending" && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => setDialog("reject")}>
                    <XCircle className="h-3.5 w-3.5" /> Reject
                  </Button>
                  <Button size="sm" variant="success" onClick={() => setDialog("approve")}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approve &amp; execute
                  </Button>
                </>
              )}
              {rec.status === "approved" && directives.some((d) => d.status === "scheduled" || d.status === "active") && (
                <Button size="sm" variant="secondary" onClick={() => setDialog("rollback")}>
                  <Undo2 className="h-3.5 w-3.5" /> Roll back
                </Button>
              )}
            </div>
          </div>
          {rec.decision && (
            <div className="mt-3 rounded-lg border border-line bg-shell/60 px-3 py-2 text-[12px] text-ink-2">
              {rec.status === "rejected" ? "Rejected" : "Approved"} by <span className="font-medium text-ink">{rec.decision.by}</span> at {fmtSimTime(state, rec.decision.hour)}
              {rec.decision.note && <> — “{rec.decision.note}”</>}
            </div>
          )}
        </CardBody>
      </Card>

      {rec.execution && <ExecutionPanel state={state} rec={rec} directives={directives} onAdvance={(h) => advance(h)} advancing={!!busy.advance} />}

      <div className="grid gap-4 2xl:grid-cols-2">
        <Card>
          <CardHeader title="Proposed actions" description="What will change in the factory" icon={<Wrench className="h-4 w-4" />} />
          <CardBody className="space-y-2.5">
            {rec.actions.map((a) => (
              <div key={a.id} className="rounded-xl border border-line bg-shell/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13px] font-semibold text-ink">{a.title}</p>
                  <Badge tone={a.reversible ? "healthy" : "warning"}>{a.reversible ? "Reversible" : "Not reversible"}</Badge>
                </div>
                <p className="mt-1 text-[12px] text-ink-2">{a.detail}</p>
                <p className="mt-1.5 text-[11px] text-muted">
                  <RotateCcw className="mr-1 inline h-3 w-3" />
                  Rollback: {a.rollback}
                </p>
                {a.assetIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {a.assetIds.map((id) => (
                      <Link key={id} href={`/twin?asset=${id}`} className="rounded border border-line bg-surface px-1.5 py-px font-mono text-[10.5px] text-ink-2 hover:text-ink">
                        {id}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Estimated impact" description={`Proposed plan vs "${run?.results.find((r) => r.definition.id === rec.comparedToScenarioId)?.definition.name ?? rec.comparedToScenarioId}"`} />
          <CardBody>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-[11px] text-muted">
                  <th className="py-1.5 text-left font-medium">Metric</th>
                  <th className="py-1.5 text-right font-medium">Without action</th>
                  <th className="py-1.5 text-right font-medium">With plan</th>
                  <th className="py-1.5 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {rec.impact.map((i) => {
                  const d = i.proposed - i.baseline;
                  const good = d !== 0 && ((i.better === "lower" && d < 0) || (i.better === "higher" && d > 0));
                  const fmt = (v: number) => (i.unit === "$" ? fmtMoney(v) : `${fmtInt(v)}${i.unit && i.unit !== "units" ? ` ${i.unit}` : ""}`);
                  return (
                    <tr key={i.label} className="border-b border-line/50 last:border-0">
                      <td className="py-1.5 text-ink-2">{i.label}</td>
                      <td className="tabular py-1.5 text-right text-ink-2">{fmt(i.baseline)}</td>
                      <td className="tabular py-1.5 text-right font-medium text-ink">{fmt(i.proposed)}</td>
                      <td className={cn("tabular py-1.5 text-right text-[12px]", d === 0 ? "text-muted" : good ? "text-healthy-ink" : "text-critical-ink")}>
                        {d === 0 ? "—" : `${d > 0 ? "+" : "−"}${i.unit === "$" ? fmtMoney(Math.abs(d)) : fmtInt(Math.abs(d))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Supporting evidence" />
          <CardBody>
            {rec.evidence.map((e) => (
              <div key={e.label} className="border-b border-line/50 py-1.5 last:border-0">
                <KeyValue k={e.label} v={e.value} className="py-0" />
                <p className="text-right text-[10.5px] text-muted">{e.source}</p>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Benefits & risks" />
          <CardBody className="space-y-3">
            <div>
              <SectionLabel className="mb-1">Expected benefits</SectionLabel>
              <ul className="space-y-1 text-[12px] text-ink-2">
                {rec.benefits.map((b) => (
                  <li key={b} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-healthy" />
                    {b}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionLabel className="mb-1">Potential risks</SectionLabel>
              <ul className="space-y-1 text-[12px] text-ink-2">
                {rec.risks.map((r) => (
                  <li key={r} className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[11px] text-muted">Confidence: {rec.confidence.rationale}</p>
            <div className="flex flex-wrap gap-1">
              {rec.affectedAssetIds.map((id) => (
                <Link key={id} href={`/twin?asset=${id}`} className="rounded border border-line bg-shell px-1.5 py-px font-mono text-[10.5px] text-ink-2 hover:text-ink">
                  {id}
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "approve" ? `Approve ${rec.id}?` : dialog === "reject" ? `Reject ${rec.id}?` : `Roll back ${rec.id}?`}
        description={
          dialog === "approve"
            ? "The plan's actions will be applied to the twin: work orders scheduled and line allocations changed."
            : dialog === "reject"
              ? "No changes will be applied. The decision and your reason are recorded in the audit trail."
              : "Scheduled actions are cancelled and active re-allocations reverted (one changeover). Maintenance already in progress runs to completion."
        }
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button size="sm" variant={dialog === "approve" ? "success" : dialog === "reject" ? "danger" : "secondary"} onClick={confirm} loading={!!busy.decide || !!busy.rollback}>
              {dialog === "approve" ? "Approve & execute" : dialog === "reject" ? "Reject" : "Roll back"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="op">Decision by</Label>
            <Input id="op" value={operator} onChange={(e) => setOperator(e.target.value)} />
          </div>
          {dialog !== "rollback" && (
            <div className="space-y-1">
              <Label htmlFor="note">{dialog === "reject" ? "Reason" : "Note (optional)"}</Label>
              <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={dialog === "reject" ? "e.g. Line B needed for an urgent SH-40 sample run" : "e.g. Crew confirmed for 07:45"} />
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}

function directiveLabel(state: FactoryState, d: Directive) {
  if (d.kind === "maintenance") return `${d.workOrderId}: ${d.assetId} maintenance ${d.durationHours} h`;
  if (d.kind === "allocation") return `${state.lines.find((l) => l.id === d.lineId)?.name}: ${describeAllocation(d.allocation)}`;
  return `${d.assetId} speed → ${d.speedPct}%`;
}

function directiveTiming(state: FactoryState, d: Directive) {
  const now = state.clock.hour;
  if (d.kind === "maintenance") {
    const end = d.startHour + d.durationHours;
    if (d.status === "scheduled") return `starts ${fmtRelHours(state, d.startHour)}`;
    if (d.status === "active") return `in progress · ends ${fmtRelHours(state, end)}`;
    return d.status === "completed" ? `completed ${fmtRelHours(state, end)}` : "cancelled";
  }
  const end = d.endHour;
  if (d.status === "scheduled") return `starts ${fmtRelHours(state, d.startHour)}`;
  if (d.status === "active") return end !== null ? `active · reverts ${fmtRelHours(state, end)}` : "active";
  if (d.status === "completed") return end !== null && end <= now ? `completed ${fmtRelHours(state, end)}` : "completed";
  return "cancelled";
}

function ExecutionPanel({ state, rec, directives, onAdvance, advancing }: { state: FactoryState; rec: Recommendation; directives: Directive[]; onAdvance: (h: number) => void; advancing: boolean }) {
  const allDone = directives.length > 0 && directives.every((d) => d.status === "completed" || d.status === "cancelled");
  const incident = state.incidents.find((i) => rec.affectedAssetIds.includes(i.assetId));
  const target = state.assets.find((a) => a.id === rec.affectedAssetIds[0]);
  return (
    <Card className="border-healthy/30">
      <CardHeader
        title="Execution status"
        description={
          rec.execution?.status === "rolled-back"
            ? "Plan rolled back"
            : rec.execution?.status === "partially-applied"
              ? "Some actions could not be applied — see the audit trail"
              : allDone
                ? "All actions completed in the twin"
                : "Actions run in the twin as plant time advances"
        }
        icon={<History className="h-4 w-4 text-healthy" />}
        actions={
          rec.status === "approved" && !allDone ? (
            <div className="flex gap-1.5">
              <Button size="xs" variant="secondary" onClick={() => onAdvance(1)} loading={advancing}>
                <FastForward className="h-3 w-3" /> +1 h
              </Button>
              <Button size="xs" variant="primary" onClick={() => onAdvance(8)} loading={advancing}>
                <FastForward className="h-3 w-3" /> Fast-forward 8 h
              </Button>
            </div>
          ) : null
        }
      />
      <CardBody>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <SectionLabel>Applied actions</SectionLabel>
            {rec.execution?.steps.map((s) => (
              <div key={s.actionId} className="flex gap-2.5 text-[12px]">
                {s.status === "applied" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-healthy" />
                ) : s.status === "failed" ? (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" />
                ) : (
                  <Undo2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                )}
                <div>
                  <p className="font-medium text-ink">{s.title}</p>
                  <p className="text-muted">{s.message}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <SectionLabel>Live directives in the twin</SectionLabel>
            {directives.map((d) => (
              <div key={d.id} className="flex items-center gap-2.5 rounded-lg border border-line bg-shell/60 px-3 py-2 text-[12px]">
                {d.status === "active" ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                ) : d.status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-healthy" />
                ) : d.status === "cancelled" ? (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-muted" />
                ) : (
                  <CircleDashed className="h-3.5 w-3.5 shrink-0 text-ink-2" />
                )}
                <span className="min-w-0 flex-1 truncate text-ink">{directiveLabel(state, d)}</span>
                <span className="shrink-0 text-[11px] text-muted">{directiveTiming(state, d)}</span>
              </div>
            ))}
            {target && (
              <div className="mt-2 rounded-lg border border-line bg-shell/60 px-3 py-2 text-[12px] text-ink-2">
                <span className="font-mono text-ink">{target.id}</span> is <span className="font-medium text-ink">{target.status}</span> · health {target.healthScore.toFixed(0)} · {target.signal.vibration.toFixed(2)} mm/s
                {incident && (
                  <>
                    {" "}
                    · {incident.id} <span className="font-medium text-ink">{incident.status}</span>
                  </>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="xs" variant="secondary" asChild>
                <Link href="/twin">
                  <Network className="h-3 w-3" /> View in twin
                </Link>
              </Button>
              <Button size="xs" variant="secondary" asChild>
                <Link href="/dashboard">
                  Command Center <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
              <Button size="xs" variant="secondary" asChild>
                <Link href="/audit">
                  Audit trail <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
