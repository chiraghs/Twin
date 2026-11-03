"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Bot, Check, CheckCircle2, ChevronDown, Info, Loader2, RotateCcw, Send, ShieldCheck, Sparkles, Wrench, X } from "lucide-react";
import { useCopilot, type CopilotTurn } from "@/client/copilot";
import { cn } from "@/lib/cn";
import { Badge, Button, Sheet, Textarea, Tip } from "../ui/primitives";

const SUGGESTIONS = [
  "Which machine is most at risk right now, and why?",
  "Why is Line A rejecting more boards?",
  "Which orders are at risk, and what are our options?",
  "What if we run A-ROB-03 at 80% speed and start maintenance in 4 hours?",
];

const AGENT_LABEL: Record<string, string> = {
  twin_copilot: "Coordinator",
  maintenance_analyst: "Maintenance analyst",
  quality_analyst: "Quality analyst",
  planning_analyst: "Planning analyst",
};

/** Minimal, safe Markdown: headings, bullets, **bold**, `code`. Builds React nodes (no HTML). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={m.index} className="font-semibold text-ink">{tok.slice(2, -2)}</strong> : <code key={m.index} className="rounded bg-surface-3 px-1 font-mono text-[11.5px] text-ink">{tok.slice(1, -1)}</code>);
    last = m.index! + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`l${blocks.length}`} className="ml-4 list-disc space-y-1 marker:text-muted">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[*-]\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(h ? <p key={`h${blocks.length}`} className="pt-1 text-[12px] font-semibold tracking-wide text-ink uppercase">{inline(h[1])}</p> : <p key={`p${blocks.length}`}>{inline(line)}</p>);
  }
  flush();
  return <div className="space-y-2 text-[13px] leading-relaxed text-ink-2">{blocks}</div>;
}

function Trace({ turn }: { turn: CopilotTurn }) {
  const [open, setOpen] = useState(false);
  if (!turn.trace.length) return null;
  const agents = [...new Set(turn.trace.map((t) => t.agent))];
  return (
    <div className="rounded-lg border border-line bg-shell">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-muted hover:text-ink" aria-expanded={open}>
        <Wrench className="h-3 w-3" />
        {turn.trace.length} tool call{turn.trace.length === 1 ? "" : "s"} by {agents.map((a) => AGENT_LABEL[a] ?? a).join(", ")}
        {turn.pending && <Loader2 className="h-3 w-3 animate-spin" />}
        <ChevronDown className={cn("ml-auto h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {(open || turn.pending) && (
        <ol className="space-y-0.5 border-t border-line px-2.5 py-1.5">
          {turn.trace.map((t, i) => (
            <li key={i} className="flex items-center gap-1.5 text-[11.5px]">
              {t.ok === null ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" /> : t.ok ? <Check className="h-3 w-3 shrink-0 text-healthy" /> : <X className="h-3 w-3 shrink-0 text-critical" />}
              <span className="shrink-0 text-muted">{AGENT_LABEL[t.agent] ?? t.agent}</span>
              <span className="font-mono text-ink">{t.tool}</span>
              {Object.keys(t.args).length > 0 && <span className="truncate font-mono text-[10.5px] text-muted">{JSON.stringify(t.args)}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Grounding({ g }: { g: NonNullable<CopilotTurn["grounding"]> }) {
  if (!g.figures) return null;
  const ok = !g.unverified.length;
  return (
    <Tip
      content={
        ok
          ? `Every figure in this answer was found in a tool result${g.derived.length ? `; ${g.derived.join(", ")} ${g.derived.length === 1 ? "is a difference" : "are differences"} between two tool figures` : ""}.`
          : `Not found in any tool result: ${g.unverified.join(", ")}. Treat ${g.unverified.length === 1 ? "it" : "them"} as the model's own calculation.`
      }
    >
      <span className={cn("inline-flex cursor-help items-center gap-1 text-[11px]", ok ? "text-healthy-ink" : "text-warning-ink")}>
        {ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        {ok ? `${g.figures} figures checked against tool results` : `${g.unverified.length} of ${g.figures} figures not traced to a tool`}
      </span>
    </Tip>
  );
}

function ConfirmCard({ turn }: { turn: CopilotTurn }) {
  const confirm = useCopilot((s) => s.confirm);
  const busy = useCopilot((s) => s.busy);
  const c = turn.confirm!;
  const args = c.args as { plan?: string; assetId?: string; reason?: string };
  return (
    <div className="rounded-xl border border-agent/40 bg-agent/8 p-3 text-[12.5px]" data-testid="copilot-confirm">
      <p className="flex items-center gap-1.5 font-medium text-ink">
        <Info className="h-4 w-4 text-agent" /> The copilot wants to propose a plan
      </p>
      <p className="mt-1 text-ink-2">
        <span className="font-medium text-ink">{args.plan ?? "plan"}</span>
        {args.assetId ? ` for ${args.assetId}` : ""}
        {args.reason ? ` — “${args.reason}”` : ""}. This creates a <span className="font-medium text-ink">pending</span> recommendation that a person must approve in Approvals. It does not change production or equipment.
      </p>
      {c.decided === null ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="agent" disabled={busy} onClick={() => void confirm(turn.id, true)}>
            <Check className="h-3.5 w-3.5" /> Yes, propose it
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void confirm(turn.id, false)}>
            No
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] text-muted">{c.decided ? "You confirmed." : "You declined."}</p>
      )}
    </div>
  );
}

export function CopilotPanel() {
  const open = useCopilot((s) => s.open);
  const setOpen = useCopilot((s) => s.setOpen);
  const info = useCopilot((s) => s.info);
  const loadInfo = useCopilot((s) => s.loadInfo);
  const turns = useCopilot((s) => s.turns);
  const ask = useCopilot((s) => s.ask);
  const busy = useCopilot((s) => s.busy);
  const reset = useCopilot((s) => s.reset);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !info) void loadInfo();
  }, [open, info, loadInfo]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [turns, open]);

  const send = (t: string) => {
    if (!t.trim()) return;
    setText("");
    void ask(t);
  };
  const available = info?.available ?? true;

  return (
    <Sheet open={open} onOpenChange={setOpen} title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-agent" /> Twin Copilot</span>} width="max-w-xl">
      <div className="flex h-full flex-col" data-testid="copilot-panel">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-5 py-2.5 text-[11.5px] text-muted">
          <Badge tone="agent">
            <Sparkles className="h-3 w-3" /> Muse Spark
          </Badge>
          {info?.model && <Badge tone="neutral">{info.model}</Badge>}
          <Tip
            content={
              <span className="block">
                {(info?.agents ?? []).map((a) => (
                  <span key={a.name} className="mb-1 block">
                    <span className="font-medium text-ink">{a.role}</span> · {a.tools.join(", ")}
                  </span>
                ))}
              </span>
            }
          >
            <span className="cursor-help underline decoration-dotted">{info?.agents.length ?? 4} agents, 12 tools</span>
          </Tip>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={reset} disabled={busy}>
            <RotateCcw className="h-3 w-3" /> New conversation
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {turns.length === 0 && (
            <div className="space-y-3">
              <p className="text-[13px] leading-relaxed text-ink-2">
                Ask about machines, quality, orders, inventory or what-if plans. Specialist agents answer with figures from Twin&apos;s tools, and each answer is checked against them. The copilot can
                propose a plan for approval but can&apos;t approve or run anything.
              </p>
              <div className="grid gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} disabled={!available || busy} onClick={() => send(s)} className="rounded-lg border border-line px-3 py-2 text-left text-[12.5px] text-ink-2 hover:border-agent/50 hover:text-ink disabled:opacity-50">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t) => (
            <Fragment key={t.id}>
              {t.role === "user" ? (
                <div className="ml-10 rounded-xl bg-accent/12 px-3 py-2 text-[13px] text-ink">{t.text}</div>
              ) : (
                <div className="mr-4 space-y-2" data-testid="copilot-answer">
                  <Trace turn={t} />
                  {t.confirm && <ConfirmCard turn={t} />}
                  {t.text && <Markdown text={t.text} />}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {t.grounding && <Grounding g={t.grounding} />}
                    {t.text && t.trace.some((s) => s.tool === "propose_plan" && s.ok) && (
                      <Link href="/approvals" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 text-[12px] text-accent-ink hover:underline">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Review it in Approvals →
                      </Link>
                    )}
                  </div>
                  {t.error && <p className="rounded-lg border border-critical/40 bg-critical/8 px-2.5 py-1.5 text-[12px] text-critical-ink">{t.error}</p>}
                  {t.pending && !t.trace.length && (
                    <p className="flex items-center gap-1.5 text-[12px] text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                    </p>
                  )}
                </div>
              )}
            </Fragment>
          ))}
          <div ref={end} />
        </div>

        <div className="border-t border-line px-5 py-3">
          {!available ? (
            <p className="text-[12px] text-warning-ink">The copilot is turned off. An admin can turn on AI in Integrations.</p>
          ) : (
            <div className="flex gap-2">
              <Textarea
                rows={2}
                className="min-h-0 text-[13px]"
                value={text}
                placeholder="Ask the copilot…"
                aria-label="Message to the copilot"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(text);
                  }
                }}
              />
              <Button variant="agent" size="icon" className="h-auto self-stretch px-3" loading={busy} disabled={!text.trim()} onClick={() => send(text)} aria-label="Send to copilot">
                {!busy && <Send className="h-4 w-4" />}
              </Button>
            </div>
          )}
          <p className="mt-1.5 text-[10.5px] text-muted">Every tool call is shown above each answer.</p>
        </div>
      </div>
    </Sheet>
  );
}
