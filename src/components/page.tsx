import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 max-w-full [&>span]:whitespace-normal [&>span]:leading-snug">{eyebrow}</div>}
        <h2 className="text-xl font-semibold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone,
  footer,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: "healthy" | "warning" | "critical" | "neutral";
  footer?: ReactNode;
  className?: string;
}) {
  const bar = tone === "critical" ? "bg-critical" : tone === "warning" ? "bg-warning" : tone === "healthy" ? "bg-healthy" : "bg-transparent";
  return (
    <div className={cn("relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]", className)}>
      <span className={cn("absolute inset-y-0 left-0 w-[3px]", bar)} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-muted">{label}</p>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div className="mt-1.5 text-[22px] leading-tight font-semibold tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-1 text-[11.5px] leading-snug text-ink-2">{sub}</div>}
      {footer && <div className="mt-2.5">{footer}</div>}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[10.5px] font-semibold tracking-[0.08em] text-muted uppercase", className)}>{children}</p>;
}

export function KeyValue({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1 text-[12.5px]", className)}>
      <span className="text-muted">{k}</span>
      <span className="tabular text-right font-medium text-ink">{v}</span>
    </div>
  );
}
