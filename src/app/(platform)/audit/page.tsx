"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, Search } from "lucide-react";
import { useFactory } from "@/client/store";
import { EventFeed } from "@/components/dashboard/widgets";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";
import { SEVERITY_TONE } from "@/components/ui/status";
import type { AuditCategory, AuditEntry, FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtSimTime, titleCase } from "@/lib/format";

const CATEGORIES: { id: AuditCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "telemetry-alert", label: "Telemetry alerts" },
  { id: "agent", label: "Agent investigations" },
  { id: "scenario", label: "Scenario runs" },
  { id: "recommendation", label: "Recommendations" },
  { id: "approval", label: "Approvals" },
  { id: "rejection", label: "Rejections" },
  { id: "action", label: "Actions" },
  { id: "state-change", label: "State changes" },
  { id: "asset", label: "Asset changes" },
  { id: "system", label: "System" },
];

export default function AuditPage() {
  const state = useFactory((s) => s.state)!;
  const [cat, setCat] = useState<AuditCategory | "all">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const entries = useMemo(() => {
    const n = q.trim().toLowerCase();
    return state.audit.filter((e) => (cat === "all" || e.category === cat) && (!n || `${e.title} ${e.detail} ${e.actor} ${JSON.stringify(e.refs)}`.toLowerCase().includes(n)));
  }, [state.audit, cat, q]);
  const counts = useMemo(() => state.audit.reduce<Record<string, number>>((m, e) => ((m[e.category] = (m[e.category] ?? 0) + 1), m), {}), [state.audit]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `twin-audit-${state.profile.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Audit Trail & Event Timeline"
        description="Every telemetry alert, agent investigation, scenario run, recommendation, human decision, executed action and resulting state change — in order, with links to the evidence."
        actions={
          <Button size="sm" variant="secondary" onClick={exportJson}>
            <Download className="h-3.5 w-3.5" /> Export JSON
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            aria-pressed={cat === c.id}
            className={cn(
              "h-7 rounded-lg border px-2.5 text-[12px] transition-colors",
              cat === c.id ? "border-accent/50 bg-accent/12 text-accent-ink" : "border-line text-muted hover:text-ink",
            )}
          >
            {c.label}
            <span className="ml-1.5 tabular text-[11px] opacity-70">{c.id === "all" ? state.audit.length : (counts[c.id] ?? 0)}</span>
          </button>
        ))}
      </div>
      <Card>
        <div className="border-b border-line p-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" />
            <Input className="pl-9" placeholder="Search events, assets, recommendation IDs…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit trail" />
          </div>
        </div>
        <div className="divide-y divide-line/60">
          {entries.map((e) => (
            <AuditRow key={e.id} state={state} entry={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />
          ))}
          {!entries.length && <p className="p-8 text-center text-[13px] text-muted">No events match.</p>}
        </div>
      </Card>
    </div>
  );
}

function AuditRow({ state, entry, open, onToggle }: { state: FactoryState; entry: AuditEntry; open: boolean; onToggle: () => void }) {
  const refs = entry.refs;
  return (
    <div className="px-3 py-1">
      <button onClick={onToggle} className="flex w-full items-start gap-3 text-left">
        <span className="tabular mt-2.5 w-[86px] shrink-0 text-[11px] text-muted">{fmtSimTime(state, entry.hour, false)} · h{entry.hour >= 0 ? "+" : ""}{entry.hour.toFixed(1)}</span>
        <div className="min-w-0 flex-1">
          <EventFeed state={state} entries={[entry]} />
        </div>
        <Badge tone={SEVERITY_TONE[entry.severity]} className="mt-2.5 hidden capitalize sm:inline-flex">
          {titleCase(entry.category)}
        </Badge>
      </button>
      {open && (
        <div className="mb-2 ml-[98px] rounded-lg border border-line bg-shell/60 p-3 text-[12px]">
          <p className="text-ink-2">{entry.detail}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="font-mono text-[11px] text-muted">{entry.id}</span>
            <span className="text-[11px] text-muted">· recorded {new Date(entry.at).toLocaleString()}</span>
            {refs.assetIds?.map((a) => (
              <Link key={a} href={`/twin?asset=${a}`} className="rounded border border-line bg-surface px-1.5 font-mono text-[10.5px] text-ink-2 hover:text-ink">
                {a}
              </Link>
            ))}
            {refs.recommendationId && (
              <Link href="/approvals" className="rounded border border-accent/40 bg-accent/10 px-1.5 font-mono text-[10.5px] text-accent-ink">
                {refs.recommendationId}
              </Link>
            )}
            {refs.scenarioRunId && (
              <Link href="/simulator" className="rounded border border-line bg-surface px-1.5 font-mono text-[10.5px] text-ink-2">
                {refs.scenarioRunId}
              </Link>
            )}
            {refs.analysisId && (
              <Link href="/agents" className="rounded border border-agent/40 bg-agent/10 px-1.5 font-mono text-[10.5px] text-agent-ink">
                {refs.analysisId}
              </Link>
            )}
            {refs.incidentId && <span className="rounded border border-line bg-surface px-1.5 font-mono text-[10.5px] text-ink-2">{refs.incidentId}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
