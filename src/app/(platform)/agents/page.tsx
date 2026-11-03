"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, BrainCircuit, ClipboardCheck, FlaskConical, Network, Play, Radar, Terminal } from "lucide-react";
import { highlightFor, useFactory, useUi, type LiveAnalysis } from "@/client/store";
import { AgentCard, AgentDetail, NarrativeCard, WorkflowPipeline } from "@/components/agents/agent-views";
import { KeyValue, PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState } from "@/components/ui/primitives";
import type { AgentId, FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtInt, fmtMoney, fmtSimTime } from "@/lib/format";

const AGENTS: AgentId[] = ["maintenance", "quality", "production", "supply", "energy", "orchestrator"];

/** Normalise either the live (streaming) analysis or the last persisted one into one view model. */
function useAnalysisView(state: FactoryState, live: LiveAnalysis | null) {
  return useMemo(() => {
    if (live) {
      return {
        id: live.id,
        running: live.running,
        stages: live.stages,
        agents: live.agents,
        observation: live.observation,
        forecast: live.forecast,
        run: live.run,
        narrative: live.narrative,
        recommendation: live.recommendation ? (state.recommendations.find((r) => r.id === live.recommendation!.id) ?? live.recommendation) : null,
        log: live.log,
        error: live.error,
        persisted: false,
      };
    }
    const a = state.analyses[0];
    if (!a) return null;
    const run = state.scenarioRuns.find((r) => r.id === a.scenarioRunId) ?? null;
    return {
      id: a.id,
      running: false,
      stages: a.stages,
      agents: Object.fromEntries(Object.entries(a.reports).map(([k, r]) => [k, { status: "complete" as const, report: r }])),
      observation: null,
      forecast: run?.results.find((r) => r.definition.id === "continue") ?? null,
      run,
      narrative: a.narrative,
      recommendation: state.recommendations.find((r) => r.id === a.recommendationId) ?? null,
      log: [],
      error: null,
      persisted: true,
    };
  }, [state, live]);
}

export default function AgentsPage() {
  const router = useRouter();
  const state = useFactory((s) => s.state)!;
  const live = useFactory((s) => s.analysis);
  const analyze = useFactory((s) => s.analyze);
  const setHighlight = useUi((s) => s.setHighlight);
  const view = useAnalysisView(state, live);
  const [selected, setSelected] = useState<AgentId>("maintenance");
  const logRef = useRef<HTMLDivElement>(null);

  // Follow the agent that is currently working.
  useEffect(() => {
    if (!view?.running) return;
    const working = AGENTS.find((a) => view.agents[a]?.status === "running");
    if (working) setSelected(working);
  }, [view?.agents, view?.running]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [view?.log.length]);

  const focusId = view?.observation?.focusAssetId ?? state.analyses[0]?.focusAssetId ?? null;
  const focus = state.assets.find((a) => a.id === focusId);
  const selectedReport = view?.agents[selected]?.report;
  const best = view?.run?.results.find((r) => r.definition.id === view.run!.recommendedId);

  const showInTwin = () => {
    if (!view?.run || !best) return;
    setHighlight(highlightFor(view.run.id, best));
    router.push("/twin");
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="AI Operations Command Center"
        description="Six specialised agents investigate the factory on a snapshot of the shared twin. Every finding lists its inputs, method and evidence."
        eyebrow={
          <Badge tone="agent">
            <BrainCircuit className="h-3 w-3" /> Agentic workflow · OBSERVE → INVESTIGATE → PREDICT → SIMULATE → RECOMMEND → HUMAN APPROVAL
          </Badge>
        }
        actions={
          <Button variant="primary" size="sm" onClick={() => void analyze()} loading={view?.running}>
            {!view?.running && <Play className="h-3.5 w-3.5" />}
            {view?.running ? "Agents working…" : view ? "Re-run analysis" : "Run analysis"}
          </Button>
        }
      />

      {!view ? (
        <Card>
          <EmptyState
            icon={<BrainCircuit className="h-5 w-5" />}
            title="No investigation yet"
            description="Run the analysis to let the agents observe telemetry, investigate the most at-risk asset, predict the impact, simulate alternative plans and propose an action for approval."
            action={
              <Button variant="primary" size="sm" onClick={() => void analyze()}>
                <Play className="h-3.5 w-3.5" /> Run analysis
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="font-mono text-ink-2">{view.id}</span>
            {focus && (
              <>
                <span>·</span>
                <span>
                  Focus asset{" "}
                  <Link href={`/twin?asset=${focus.id}`} className="font-mono text-accent hover:underline">
                    {focus.id}
                  </Link>{" "}
                  {focus.name}
                </span>
              </>
            )}
            {view.persisted && <Badge tone="neutral">Last completed analysis</Badge>}
            {view.error && (
              <Badge tone="critical">
                <AlertTriangle className="h-3 w-3" /> {view.error}
              </Badge>
            )}
          </div>

          <WorkflowPipeline stages={view.stages} />

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_380px]">
            <div className="min-w-0 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {AGENTS.map((id) => (
                  <AgentCard
                    key={id}
                    id={id}
                    status={view.agents[id]?.status ?? (view.running ? "idle" : "idle")}
                    report={view.agents[id]?.report}
                    selected={selected === id}
                    onSelect={() => setSelected(id)}
                  />
                ))}
              </div>
              <Card>
                <CardBody className="pt-4">
                  {selectedReport ? (
                    <AgentDetail state={state} report={selectedReport} />
                  ) : (
                    <EmptyState icon={<Radar className="h-5 w-5" />} title="Waiting for this agent" description="Its report appears here as soon as the agent completes." />
                  )}
                </CardBody>
              </Card>
            </div>

            <div className="space-y-4">
              {view.observation && (
                <Card>
                  <CardHeader title="Observed anomalies" description={`${view.observation.assetsScanned} assets · ${fmtInt(view.observation.readings)} readings`} icon={<Radar className="h-4 w-4" />} />
                  <CardBody className="space-y-1.5">
                    {view.observation.anomalies.slice(0, 6).map((a, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11.5px]">
                        <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", a.severity === "critical" ? "bg-critical" : a.severity === "warning" ? "bg-warning" : "bg-accent")} />
                        <span className="text-ink-2">
                          <span className="font-mono text-ink">{a.assetId}</span> {a.detail}
                        </span>
                      </div>
                    ))}
                  </CardBody>
                </Card>
              )}

              {view.forecast && (
                <Card className="border-critical/30">
                  <CardHeader title="Prediction: no intervention" description="If the current plan continues" icon={<AlertTriangle className="h-4 w-4 text-critical" />} />
                  <CardBody>
                    <KeyValue k="Predicted trip" v={view.forecast.metrics.failureOccurs ? `h+${view.forecast.metrics.failureHour?.toFixed(1)}` : "None in horizon"} />
                    <KeyValue k="Unplanned downtime" v={`${view.forecast.metrics.targetUnplannedDowntimeHours.toFixed(0)} h`} />
                    <KeyValue k="Late units (due orders)" v={fmtInt(view.forecast.metrics.lateUnits)} />
                    <KeyValue k="Est. operating cost" v={fmtMoney(view.forecast.metrics.operatingCost)} />
                  </CardBody>
                </Card>
              )}

              {view.narrative && (
                <Card className="border-agent/30">
                  <CardHeader title="Orchestrator brief" icon={<BrainCircuit className="h-4 w-4 text-agent" />} />
                  <CardBody>
                    <NarrativeCard narrative={view.narrative} />
                  </CardBody>
                </Card>
              )}

              {view.recommendation && (
                <Card className="border-accent/40">
                  <CardHeader
                    title="Recommended action"
                    description={`${view.recommendation.id} · ${view.recommendation.status}`}
                    icon={<ClipboardCheck className="h-4 w-4 text-accent" />}
                    actions={<Badge tone={view.recommendation.status === "pending" ? "warning" : view.recommendation.status === "approved" ? "healthy" : "neutral"}>{view.recommendation.status}</Badge>}
                  />
                  <CardBody className="space-y-3">
                    <p className="text-[13px] font-medium text-ink">{view.recommendation.title}</p>
                    <p className="text-[12px] text-ink-2">{view.recommendation.reason}</p>
                    <div className="grid grid-cols-1 gap-2">
                      <Button size="sm" variant="primary" asChild>
                        <Link href="/approvals">
                          Review &amp; approve <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" variant="secondary" asChild>
                          <Link href="/simulator">
                            <FlaskConical className="h-3.5 w-3.5" /> Compare plans
                          </Link>
                        </Button>
                        <Button size="sm" variant="secondary" onClick={showInTwin}>
                          <Network className="h-3.5 w-3.5" /> Show in twin
                        </Button>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              )}

              {view.log.length > 0 && (
                <Card>
                  <CardHeader title="Agent activity" icon={<Terminal className="h-4 w-4" />} />
                  <div ref={logRef} className="max-h-64 overflow-y-auto px-4 pb-4 font-mono text-[11px] leading-relaxed">
                    {view.log.map((l, i) => (
                      <p key={i} className={cn(l.kind === "error" ? "text-critical-ink" : l.kind === "result" ? "text-accent-ink" : l.kind === "agent" ? "text-ink-2" : "text-muted")}>
                        <span className="text-muted">{new Date(l.at).toLocaleTimeString("en-GB")}</span> {l.text}
                      </p>
                    ))}
                  </div>
                </Card>
              )}
              <p className="px-1 text-[10.5px] text-muted">Plant clock {fmtSimTime(state, state.clock.hour)}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
