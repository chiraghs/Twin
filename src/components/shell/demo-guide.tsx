"use client";

import { useRouter, usePathname } from "next/navigation";
import { ArrowRight, CheckCircle2, ChevronDown, ChevronUp, Compass, X } from "lucide-react";
import { useState } from "react";
import { highlightFor, useFactory, useUi } from "@/client/store";
import { cn } from "@/lib/cn";
import { Button } from "../ui/primitives";

interface GuideStep {
  title: string;
  body: string;
  path: string;
  cta: string;
}

const STEPS: GuideStep[] = [
  {
    title: "A critical incident is developing",
    body: "Assembly Robot A3 has bearing damage. Vibration jumped above the alarm limit and a critical incident opened. Note the delivery risk on ORD-1042.",
    path: "/dashboard",
    cta: "Investigate with AI agents",
  },
  {
    title: "Agents investigate",
    body: "Six agents observe telemetry, investigate, predict, simulate and recommend. Every finding shows its evidence and method. Watch the stages complete.",
    path: "/agents",
    cta: "Compare operating plans",
  },
  {
    title: "What-if scenarios",
    body: "Each plan runs on the twin. Adjust levers such as maintenance timing, line allocation or MCU-7 availability, and results recalculate instantly.",
    path: "/simulator",
    cta: "See it in the digital twin",
  },
  {
    title: "Affected assets highlighted",
    body: "The recommended plan's production path is highlighted: Line A under maintenance, Line B rerouted, packaging and the critical order downstream.",
    path: "/twin",
    cta: "Review the recommendation",
  },
  {
    title: "Human approval",
    body: "Review actions, evidence, risks and rollback options, then approve. The approved actions run in the twin.",
    path: "/approvals",
    cta: "View the audit trail",
  },
  {
    title: "Explainable history",
    body: "Every alert, agent finding, scenario run, decision and resulting state change is recorded. Fast-forward the plant to watch the maintenance complete.",
    path: "/audit",
    cta: "Finish tour",
  },
];

export function DemoGuide() {
  const router = useRouter();
  const pathname = usePathname();
  const guide = useUi((s) => s.guide);
  const setGuide = useUi((s) => s.setGuide);
  const setHighlight = useUi((s) => s.setHighlight);
  const analyze = useFactory((s) => s.analyze);
  // Only the running flag is rendered; everything else is read when a button is pressed.
  const analysisRunning = useFactory((s) => !!s.analysis?.running);
  const [collapsed, setCollapsed] = useState(false);
  if (!guide.active) return null;
  const step = STEPS[Math.min(guide.step, STEPS.length - 1)];
  const onPage = pathname === step.path;

  const next = async () => {
    const n = guide.step + 1;
    if (n >= STEPS.length) {
      setGuide({ active: false, step: 0 });
      return;
    }
    setGuide({ step: n });
    const target = STEPS[n];
    router.push(target.path);
    if (target.path === "/agents" && !analysisRunning) void analyze();
    if (target.path === "/twin") {
      const run = useFactory.getState().analysis?.run ?? useFactory.getState().state?.scenarioRuns[0];
      const rec = run?.results.find((r) => r.definition.id === run.recommendedId);
      if (run && rec) setHighlight(highlightFor(run.id, rec));
    }
  };

  const waitingForAnalysis = step.path === "/agents" && analysisRunning;

  return (
    <div className="fixed bottom-4 left-4 z-[55] w-[min(360px,calc(100vw-32px))] rounded-2xl border border-accent/40 bg-shell/95 shadow-[0_20px_60px_-20px_rgba(76,141,255,0.45)] backdrop-blur lg:left-64">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-ink">
          <Compass className="h-4 w-4 text-accent" />
          Guided crisis demo
          <span className="text-muted">
            {guide.step + 1}/{STEPS.length}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button className="rounded p-1 text-muted hover:text-ink" onClick={() => setCollapsed(!collapsed)} aria-label="Collapse guide">
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button className="rounded p-1 text-muted hover:text-ink" onClick={() => setGuide({ active: false, step: 0 })} aria-label="Close guide">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="p-3.5">
          <div className="mb-3 flex gap-1">
            {STEPS.map((_, i) => (
              <span key={i} className={cn("h-1 flex-1 rounded-full", i < guide.step ? "bg-healthy" : i === guide.step ? "bg-accent" : "bg-surface-3")} />
            ))}
          </div>
          <p className="text-[13.5px] font-semibold text-ink">{step.title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{step.body}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            {!onPage ? (
              <Button size="sm" variant="ghost" onClick={() => router.push(step.path)}>
                Go to step
              </Button>
            ) : (
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <CheckCircle2 className="h-3.5 w-3.5 text-healthy" /> You are here
              </span>
            )}
            <Button size="sm" variant="primary" onClick={next} loading={waitingForAnalysis} disabled={waitingForAnalysis}>
              {waitingForAnalysis ? "Agents working…" : step.cta}
              {!waitingForAnalysis && <ArrowRight className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
