"use client";

import { CheckCircle2, CircleDashed, FileSearch, Globe, Loader2, ListChecks, MinusCircle, PenTool, XCircle } from "lucide-react";
import { useBuilder } from "@/client/builder";
import type { BuilderStage } from "@/domain/builder/pipeline";
import { cn } from "@/lib/cn";

const META: Record<BuilderStage, { label: string; Icon: typeof Globe; what: string }> = {
  read: { label: "Read blueprint", Icon: FileSearch, what: "Recognise machines, lines and flow on the drawing" },
  research: { label: "Research", Icon: Globe, what: "Standard layouts, rates and sensors, with citations" },
  draft: { label: "Draft twin", Icon: PenTool, what: "Propose lines, machines, products and connections" },
  validate: { label: "Validate", Icon: ListChecks, what: "Checks before anything is built" },
};

export function AgentStages({ compact = false }: { compact?: boolean }) {
  const stages = useBuilder((s) => s.stages);
  return (
    <ol className={cn("grid gap-2", compact ? "sm:grid-cols-4" : "")} data-testid="builder-stages">
      {(Object.keys(META) as BuilderStage[]).map((k) => {
        const st = stages[k];
        const M = META[k];
        const Icon =
          st.status === "running" ? Loader2 : st.status === "done" ? CheckCircle2 : st.status === "error" ? XCircle : st.status === "skipped" ? MinusCircle : CircleDashed;
        return (
          <li
            key={k}
            className={cn(
              "rounded-xl border p-3",
              st.status === "running" ? "border-accent/60 bg-accent/8" : st.status === "done" ? "border-healthy/35" : st.status === "error" ? "border-critical/40" : "border-line",
            )}
          >
            <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
              <Icon className={cn("h-4 w-4 shrink-0", st.status === "running" && "animate-spin text-accent", st.status === "done" && "text-healthy", st.status === "error" && "text-critical", (st.status === "pending" || st.status === "skipped") && "text-muted")} />
              <M.Icon className="h-3.5 w-3.5 text-muted" /> {M.label}
            </p>
            <p className={cn("mt-1 text-[11.5px] leading-snug", st.summary ? "text-ink-2" : "text-muted")}>{st.summary ?? M.what}</p>
          </li>
        );
      })}
    </ol>
  );
}
