"use client";

import { FileImage, FileText, Link2, MessageSquare, PencilLine, Shapes } from "lucide-react";
import type { Prov, ProvenanceSource, TwinSpec } from "@/domain/builder/spec";
import { Badge, Tip, type Tone } from "../ui/primitives";

export const PROV_META: Record<ProvenanceSource, { label: string; tone: Tone; Icon: typeof FileText; help: string }> = {
  blueprint: { label: "Blueprint", tone: "accent", Icon: FileImage, help: "Read from your drawing." },
  requirement: { label: "Your requirement", tone: "agent", Icon: MessageSquare, help: "From what you asked for." },
  reference: { label: "Cited source", tone: "healthy", Icon: Link2, help: "Supported by a cited web source." },
  template: { label: "Template", tone: "neutral", Icon: Shapes, help: "From a reference template (typical values)." },
  default: { label: "Assumption", tone: "warning", Icon: FileText, help: "A default or the agent's assumption. Check it." },
  user: { label: "Your edit", tone: "maint", Icon: PencilLine, help: "Changed by you in this review." },
};

export function ProvBadge({ prov, spec, compact = false }: { prov: Prov; spec?: TwinSpec | null; compact?: boolean }) {
  const M = PROV_META[prov.source];
  const refs = (prov.refs ?? []).map((id) => spec?.references.find((r) => r.id === id)).filter(Boolean);
  return (
    <Tip
      content={
        <span className="block max-w-xs">
          <span className="font-medium text-ink">{M.label}.</span> {M.help}
          {prov.note && <span className="mt-1 block">{prov.note}</span>}
          {refs.map((r) => (
            <span key={r!.id} className="mt-1 block">
              [{r!.id}] {r!.title}
            </span>
          ))}
        </span>
      }
    >
      <span>
        <Badge tone={M.tone} className="cursor-help">
          <M.Icon className="h-3 w-3" />
          {!compact && M.label}
          {refs.length > 0 && <span className="font-mono">{refs.map((r) => r!.id).join(",")}</span>}
        </Badge>
      </span>
    </Tip>
  );
}

export function ProvLegend({ counts }: { counts: Record<ProvenanceSource, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(Object.keys(PROV_META) as ProvenanceSource[])
        .filter((k) => counts[k])
        .map((k) => {
          const M = PROV_META[k];
          return (
            <Badge key={k} tone={M.tone}>
              <M.Icon className="h-3 w-3" /> {counts[k]} {M.label.toLowerCase()}
            </Badge>
          );
        })}
    </div>
  );
}
