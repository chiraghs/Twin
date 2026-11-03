import { AlertOctagon, AlertTriangle, CheckCircle2, PowerOff, Wrench } from "lucide-react";
import type { AssetStatus, RiskLevel, Severity } from "@/domain/types";
import { cn } from "@/lib/cn";
import { Badge, type Tone } from "./primitives";
import { healthBand } from "@/domain/health";
import { STATUS_COLOR } from "./labels";

export const STATUS_META: Record<AssetStatus, { label: string; tone: Tone; color: string; Icon: typeof CheckCircle2 }> = {
  healthy: { label: "Healthy", tone: "healthy", color: STATUS_COLOR.healthy, Icon: CheckCircle2 },
  warning: { label: "Warning", tone: "warning", color: STATUS_COLOR.warning, Icon: AlertTriangle },
  critical: { label: "Critical", tone: "critical", color: STATUS_COLOR.critical, Icon: AlertOctagon },
  offline: { label: "Offline", tone: "offline", color: STATUS_COLOR.offline, Icon: PowerOff },
  maintenance: { label: "Maintenance", tone: "maint", color: STATUS_COLOR.maintenance, Icon: Wrench },
};

export function StatusBadge({ status, className }: { status: AssetStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <Badge tone={m.tone} className={className}>
      <m.Icon className="h-3 w-3" />
      {m.label}
    </Badge>
  );
}

export function StatusDot({ status, pulse = false, className }: { status: AssetStatus; pulse?: boolean; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)} aria-label={m.label}>
      {pulse && <span className="absolute inset-0 rounded-full animate-pulse-ring" style={{ background: m.color }} />}
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: m.color }} />
    </span>
  );
}

const RISK_TONE: Record<RiskLevel, Tone> = { low: "healthy", medium: "neutral", high: "warning", critical: "critical" };
export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return <Badge tone={RISK_TONE[risk]}>{risk[0].toUpperCase() + risk.slice(1)} risk</Badge>;
}

export const SEVERITY_TONE: Record<Severity, Tone> = { info: "accent", warning: "warning", critical: "critical", success: "healthy" };

export function healthTone(score: number): "healthy" | "warning" | "critical" {
  return healthBand(score);
}
