"use client";

import { ScanEye, BrainCircuit, CheckCircle2, CircleDashed, Cpu, Eye, FlaskConical, Hourglass, Leaf, Loader2, Microscope, Search, Sparkles, Telescope, Truck, UserCheck, Wrench, Factory } from "lucide-react";
import { AGENT_META } from "@/domain/agents/context";
import type { AgentId, AgentReport, FactoryState, Narrative, StageState, WorkflowStage } from "@/domain/types";
import { cn } from "@/lib/cn";
import { SectionLabel } from "../page";
import { Badge, Meter, type Tone } from "../ui/primitives";
import { SEVERITY_TONE } from "../ui/status";

export const AGENT_ICON: Record<AgentId, typeof Wrench> = {
  maintenance: Wrench,
  production: Factory,
  supply: Truck,
  energy: Leaf,
  quality: ScanEye,
  orchestrator: BrainCircuit,
};

const STAGE_META: Record<WorkflowStage, { label: string; icon: typeof Eye; hint: string }> = {
  observe: { label: "Observe", icon: Eye, hint: "Scan telemetry for anomalies" },
  investigate: { label: "Investigate", icon: Search, hint: "Specialist agents analyse" },
  predict: { label: "Predict", icon: Telescope, hint: "Project no-intervention outcome" },
  simulate: { label: "Simulate", icon: FlaskConical, hint: "Run alternative plans" },
  recommend: { label: "Recommend", icon: Sparkles, hint: "Rank, resolve conflicts" },
  approval: { label: "Human approval", icon: UserCheck, hint: "Operator decides" },
};

export function WorkflowPipeline({ stages }: { stages: StageState[] }) {
  const all: StageState[] = (["observe", "investigate", "predict", "simulate", "recommend", "approval"] as WorkflowStage[]).map(
    (s) => stages.find((x) => x.stage === s) ?? { stage: s, status: "pending" },
  );
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
      {all.map((s, i) => {
        const M = STAGE_META[s.stage];
        const running = s.status === "running";
        const done = s.status === "complete";
        const waiting = s.status === "waiting";
        return (
          <div
            key={s.stage}
            className={cn(
              "relative rounded-xl border p-3 transition-colors duration-300",
              running ? "border-agent/60 bg-agent/10 shadow-[0_0_24px_-8px_rgba(144,133,233,0.6)]" : done ? "border-healthy/30 bg-healthy/5" : waiting ? "border-warning/40 bg-warning/5" : "border-line bg-surface",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                <M.icon className={cn("h-3.5 w-3.5", running ? "text-agent" : done ? "text-healthy" : waiting ? "text-warning" : "text-muted")} />
                <span className="text-muted">{i + 1}</span> {M.label}
              </span>
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-agent" />
              ) : done ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-healthy" />
              ) : waiting ? (
                <Hourglass className="h-3.5 w-3.5 text-warning" />
              ) : (
                <CircleDashed className="h-3.5 w-3.5 text-muted" />
              )}
            </div>
            <p className={cn("mt-1.5 line-clamp-3 text-[11.5px] leading-snug", s.summary ? "text-ink-2" : "text-muted")}>{s.summary ?? M.hint}</p>
          </div>
        );
      })}
    </div>
  );
}

const CONF_TONE: Record<"high" | "medium" | "low", Tone> = { high: "healthy", medium: "warning", low: "critical" };

export function AgentCard({ id, status, report, selected, onSelect }: { id: AgentId; status: "idle" | "running" | "complete"; report?: AgentReport; selected: boolean; onSelect: () => void }) {
  const meta = AGENT_META[id];
  const Icon = AGENT_ICON[id];
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex h-full flex-col rounded-xl border p-3.5 text-left transition-colors",
        selected ? "border-accent/60 bg-surface-2" : "border-line bg-surface hover:border-line-strong",
        status === "running" && "border-agent/60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-lg border p-1.5", status === "running" ? "border-agent/50 bg-agent/15 text-agent" : "border-line bg-shell text-ink-2")}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-ink">{meta.name}</p>
            <p className="text-[11px] text-muted">{meta.short}</p>
          </div>
        </div>
        {status === "running" ? (
          <Badge tone="agent">
            <Loader2 className="h-3 w-3 animate-spin" /> Working
          </Badge>
        ) : status === "complete" ? (
          <Badge tone="healthy">Complete</Badge>
        ) : (
          <Badge tone="neutral">Idle</Badge>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-ink-2">{report?.summary ?? meta.role}</p>
      {report && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
            {report.metrics.slice(0, 4).map((m) => (
              <div key={m.label} className="min-w-0">
                <p className="truncate text-[10.5px] text-muted">{m.label}</p>
                <p className={cn("tabular truncate text-[12.5px] font-semibold", m.tone === "critical" ? "text-critical-ink" : m.tone === "warning" ? "text-warning-ink" : m.tone === "success" ? "text-healthy-ink" : "text-ink")}>{m.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-auto pt-3">
            <div className="flex items-center justify-between text-[10.5px] text-muted">
              <span>Confidence</span>
              <span className="capitalize">
                {report.confidence.level} · {Math.round(report.confidence.score * 100)}%
              </span>
            </div>
            <Meter value={report.confidence.score * 100} tone={CONF_TONE[report.confidence.level]} className="mt-1" />
          </div>
        </>
      )}
    </button>
  );
}

export function AgentDetail({ state, report }: { state: FactoryState; report: AgentReport }) {
  const meta = AGENT_META[report.agentId];
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[14px] font-semibold text-ink">{meta.name}</p>
        <p className="mt-0.5 text-[12px] text-muted">{meta.role}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-shell/60 p-3">
          <SectionLabel>Inputs used</SectionLabel>
          <ul className="mt-1.5 space-y-1 text-[12px] text-ink-2">
            {report.inputs.map((i) => (
              <li key={i} className="flex gap-1.5">
                <Cpu className="mt-0.5 h-3 w-3 shrink-0 text-muted" />
                {i}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-shell/60 p-3">
          <SectionLabel>How this was produced</SectionLabel>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{report.method}</p>
          <p className="mt-2 text-[11px] text-muted">
            Confidence <span className="capitalize text-ink-2">{report.confidence.level}</span> — {report.confidence.rationale}
          </p>
        </div>
      </div>
      <div>
        <SectionLabel className="mb-2">Findings &amp; evidence</SectionLabel>
        <div className="space-y-2.5">
          {report.findings.map((f) => (
            <div key={f.id} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-semibold text-ink">{f.title}</p>
                <Badge tone={SEVERITY_TONE[f.severity]} className="capitalize">
                  {f.severity === "success" ? "best" : f.severity}
                </Badge>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{f.detail}</p>
              {f.evidence.length > 0 && (
                <div className="mt-2.5 overflow-hidden rounded-lg border border-line">
                  <table className="w-full text-left text-[11.5px]">
                    <tbody>
                      {f.evidence.map((e) => (
                        <tr key={e.label} className="border-b border-line/70 last:border-0">
                          <td className="w-[28%] bg-shell/60 px-2.5 py-1.5 text-muted">{e.label}</td>
                          <td className="tabular px-2.5 py-1.5 font-medium text-ink">{e.value}</td>
                          <td className="hidden px-2.5 py-1.5 text-muted md:table-cell">{e.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {f.assetIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {f.assetIds.slice(0, 8).map((a) => (
                    <a key={a} href={`/twin?asset=${a}`} className="rounded border border-line bg-shell px-1.5 py-px font-mono text-[10.5px] text-ink-2 hover:border-accent/50 hover:text-ink">
                      {a}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {report.proposals.length > 0 && (
        <div>
          <SectionLabel className="mb-2">Proposed recommendations</SectionLabel>
          <div className="space-y-1.5">
            {report.proposals.map((p) => (
              <div key={p.title} className="flex items-start gap-2.5 rounded-lg border border-line bg-shell/60 px-3 py-2">
                <Badge tone={p.priority === "now" ? "critical" : p.priority === "soon" ? "warning" : "neutral"} className="mt-0.5 uppercase">
                  {p.priority}
                </Badge>
                <div>
                  <p className="text-[12.5px] font-medium text-ink">{p.title}</p>
                  <p className="text-[11.5px] text-muted">{p.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[10.5px] text-muted">
        Computed in {report.durationMs < 1 ? "<1" : report.durationMs} ms on a snapshot of {state.profile.name}
      </p>
    </div>
  );
}

export function NarrativeCard({ narrative }: { narrative: Narrative }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {narrative.source === "ai" ? (
          <Badge tone="agent">
            <Sparkles className="h-3 w-3" /> {narrative.model}
          </Badge>
        ) : (
          <Badge tone="neutral">
            <Microscope className="h-3 w-3" /> Analysis summary
          </Badge>
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-ink">{narrative.summary}</p>
      <p className="text-[12px] leading-relaxed text-ink-2">{narrative.rationale}</p>
      {narrative.risks.length > 0 && (
        <div>
          <SectionLabel className="mb-1">Residual risks</SectionLabel>
          <ul className="space-y-1 text-[12px] text-ink-2">
            {narrative.risks.map((r) => (
              <li key={r} className="flex gap-1.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-warning" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rounded-lg border border-line bg-shell/60 p-2.5 text-[12px] text-ink-2">
        <span className="font-medium text-ink">Operator briefing · </span>
        {narrative.operatorBriefing}
      </div>
      {narrative.note && <p className="text-[10.5px] leading-relaxed text-muted">{narrative.note}</p>}
    </div>
  );
}
