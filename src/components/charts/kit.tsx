"use client";

import type { FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";

/** Categorical series slots, validated for CVD separation on the card surface (#111a2e). */
export const SERIES = ["var(--color-series-1)", "var(--color-series-2)", "var(--color-series-3)", "var(--color-series-4)"] as const;
export const REFERENCE = "var(--color-reference)";
export const GRID = "var(--color-line)";
export const AXIS_TICK = { fill: "var(--color-muted)", fontSize: 11 };

/** Colour follows the entity (line), never its rank. */
export function lineColor(state: Pick<FactoryState, "lines">, lineId: string) {
  const idx = state.lines.findIndex((l) => l.id === lineId);
  return SERIES[(idx < 0 ? 0 : idx) % SERIES.length];
}

export function Legend({ items, className }: { items: { label: string; color: string; dashed?: boolean; kind?: "line" | "swatch" }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-1", className)}>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11.5px] text-ink-2">
          {i.kind === "line" ? (
            <svg width="16" height="8" aria-hidden>
              <line x1="0" y1="4" x2="16" y2="4" stroke={i.color} strokeWidth="2" strokeDasharray={i.dashed ? "3 3" : undefined} />
            </svg>
          ) : (
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

interface TooltipPayload {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  labelFormatter?: (l: string | number) => string;
  valueFormatter?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-lg border border-line-strong bg-shell/95 px-2.5 py-2 shadow-xl backdrop-blur">
      <p className="mb-1 text-[11px] font-medium text-muted">{labelFormatter ? labelFormatter(label ?? "") : label}</p>
      <div className="space-y-0.5">
        {payload.map((p) => (
          <div key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="tabular font-medium text-ink">
              {typeof p.value === "number" ? (valueFormatter ? valueFormatter(p.value, String(p.name)) : p.value.toLocaleString("en-US")) : p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
