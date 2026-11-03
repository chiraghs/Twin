"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, ChevronDown, FastForward, Menu, Pause, Play, RotateCcw, Siren, Sparkles, Database, Cpu } from "lucide-react";
import { useCopilot } from "@/client/copilot";
import { INTEGRATION_STATE, useIntegrations } from "@/client/integrations";
import { useFactory, useUi } from "@/client/store";
import { fmtSimTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, Button, Tip } from "../ui/primitives";
import { ThemeToggle } from "../theme-toggle";
import { AGENT_META } from "@/domain/agents/context";
import { FacilitySwitcher } from "./facility-switcher";

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export function DemoControls({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { open, setOpen, ref } = usePopover();
  const crisis = useFactory((s) => s.crisis);
  const reset = useFactory((s) => s.reset);
  const advance = useFactory((s) => s.advance);
  const busy = useFactory((s) => s.busy);
  const setGuide = useUi((s) => s.setGuide);

  const runCrisis = async () => {
    setOpen(false);
    if (await crisis()) {
      setGuide({ active: true, step: 0 });
      router.push("/dashboard");
    }
  };

  return (
    <div className="relative" ref={ref}>
      <Button variant="primary" size="sm" onClick={() => setOpen(!open)} loading={busy.crisis || busy.reset || busy.advance}>
        <Sparkles className="h-3.5 w-3.5" />
        {!compact && "Demo controls"}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-line-strong bg-shell p-1.5 shadow-2xl animate-fade-in">
          <button onClick={runCrisis} className="flex w-full items-start gap-3 rounded-lg p-2.5 text-left hover:bg-surface-2">
            <Siren className="mt-0.5 h-4 w-4 text-critical" />
            <span>
              <span className="block text-[13px] font-semibold text-ink">Run Factory Crisis Demo</span>
              <span className="block text-xs leading-relaxed text-muted">Reset, inject joint-4 bearing damage on A-ROB-03 and follow the guided investigation.</span>
            </span>
          </button>
          <div className="my-1 h-px bg-line" />
          {[1, 6].map((h) => (
            <button
              key={h}
              onClick={() => {
                setOpen(false);
                void advance(h);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <FastForward className="h-4 w-4 text-muted" />
              Fast-forward {h} h of plant time
            </button>
          ))}
          <div className="my-1 h-px bg-line" />
          <button
            onClick={() => {
              setOpen(false);
              setGuide({ active: false, step: 0 });
              void reset();
            }}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <RotateCcw className="h-4 w-4 text-muted" />
            Reset demo to initial state
          </button>
        </div>
      )}
    </div>
  );
}

function SystemStatus() {
  const { open, setOpen, ref } = usePopover();
  const { data } = useIntegrations({ enabled: open });
  return (
    <div className="relative hidden md:block" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:text-ink"
      >
        <Database className="h-3.5 w-3.5 text-accent" />
        Simulated data
        <span className="h-1 w-1 rounded-full bg-muted" />
        <Cpu className="h-3.5 w-3.5 text-agent" />
        {Object.keys(AGENT_META).length} agents ready
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-96 rounded-xl border border-line-strong bg-shell p-3 shadow-2xl animate-fade-in">
          <p className="text-xs font-semibold text-ink">System status</p>
          <div className="mt-2.5 space-y-1.5">
            {!data && <p className="text-xs text-muted">Loading…</p>}
            {data?.integrations.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface/60 px-2.5 py-1.5">
                <span className="truncate text-[12px] text-ink-2">{i.name}</span>
                <Badge tone={INTEGRATION_STATE[i.state].tone}>{INTEGRATION_STATE[i.state].short}</Badge>
              </div>
            ))}
          </div>
          <Link href="/integrations" onClick={() => setOpen(false)} className="mt-2.5 block text-center text-[12px] text-accent hover:underline">
            Open integrations
          </Link>
        </div>
      )}
    </div>
  );
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const state = useFactory((s) => s.state);
  const setLive = useFactory((s) => s.setLive);
  const busy = useFactory((s) => s.busy.live);
  const live = state?.clock.liveTelemetry ?? false;
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md lg:px-6">
      <button className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2 lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu className="h-5 w-5" />
      </button>
      <FacilitySwitcher />
      {state && (
        <div className="hidden items-center gap-2 sm:flex">
          <Tip content={`Plant clock${live ? "" : " (paused)"} · h+${state.clock.hour.toFixed(2)} since start`}>
            <div className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5">
              <span className="relative flex h-2 w-2">
                {live && <span className="absolute inset-0 animate-ping rounded-full bg-healthy/60" />}
                <span className={cn("relative h-2 w-2 rounded-full", live ? "bg-healthy" : "bg-muted")} />
              </span>
              <span className="tabular text-[12px] font-medium text-ink">{fmtSimTime(state, state.clock.hour)}</span>
              <span className="tabular text-[11px] text-muted">h+{state.clock.hour.toFixed(1)}</span>
            </div>
          </Tip>
          <Tip content={live ? "Pause the plant clock" : "Resume the plant clock"}>
            <Button variant="secondary" size="icon" onClick={() => setLive(!live)} loading={busy} aria-label={live ? "Pause live telemetry" : "Resume live telemetry"}>
              {!busy && (live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />)}
            </Button>
          </Tip>
        </div>
      )}
      <CopilotButton />
      <SystemStatus />
      <ThemeToggle />
      <DemoControls />
    </header>
  );
}

function CopilotButton() {
  const setOpen = useCopilot((s) => s.setOpen);
  return (
    <Button variant="agent" size="sm" onClick={() => setOpen(true)} aria-label="Ask Twin Copilot" data-testid="copilot-open">
      <Bot className="h-3.5 w-3.5" /> <span className="hidden md:inline">Ask Copilot</span>
    </Button>
  );
}
