"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/cn";

/* ─────────────────────────────── Button ─────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "success" | "agent";
type ButtonSize = "xs" | "sm" | "md" | "lg" | "icon";

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong shadow-[0_0_0_1px_rgba(76,141,255,0.4),0_6px_20px_-8px_rgba(76,141,255,0.6)]",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3 border border-line",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
  outline: "border border-line-strong text-ink hover:bg-surface-2",
  danger: "bg-critical/90 text-white hover:bg-critical",
  success: "bg-healthy/90 text-white hover:bg-healthy",
  agent: "bg-agent/15 text-agent-ink border border-agent/40 hover:bg-agent/25",
};
const sizeClass: Record<ButtonSize, string> = {
  xs: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-xl",
  icon: "h-8 w-8 rounded-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", loading, asChild, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors outline-none select-none",
          "focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-45",
          variantClass[variant],
          sizeClass[size],
          className,
        )}
        disabled={asChild ? undefined : disabled || loading}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

/* ──────────────────────────────── Card ──────────────────────────────── */

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-4 pt-4 pb-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <div className="mt-0.5 text-ink-2">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-semibold tracking-tight text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 pb-4", className)} {...props} />;
}

/* ──────────────────────────────── Badge ──────────────────────────────── */

export type Tone = "neutral" | "accent" | "healthy" | "warning" | "critical" | "offline" | "maint" | "agent";
const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-3/70 text-ink-2 border-line-strong",
  accent: "bg-accent/12 text-accent-ink border-accent/35",
  healthy: "bg-healthy/12 text-healthy-ink border-healthy/35",
  warning: "bg-warning/12 text-warning-ink border-warning/35",
  critical: "bg-critical/12 text-critical-ink border-critical/40",
  offline: "bg-offline/15 text-offline-ink border-offline/40",
  maint: "bg-maint/12 text-maint-ink border-maint/40",
  agent: "bg-agent/12 text-agent-ink border-agent/40",
};

export function Badge({ tone = "neutral", className, children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap", toneClass[tone], className)}
      {...props}
    >
      {children}
    </span>
  );
}

/* ──────────────────────────────── Tabs ──────────────────────────────── */

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex items-center gap-0.5 rounded-lg border border-line bg-shell p-0.5", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-muted transition-colors",
        "hover:text-ink data-[state=active]:bg-surface-3 data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

/* ─────────────────────────────── Slider ─────────────────────────────── */

export function Slider({ className, "aria-label": ariaLabel, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root className={cn("relative flex h-5 w-full touch-none items-center select-none", className)} {...props}>
      <SliderPrimitive.Track className="relative h-1 grow overflow-hidden rounded-full bg-surface-3">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          aria-label={ariaLabel}
          className="block h-3.5 w-3.5 rounded-full border-2 border-accent bg-white shadow transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent/50"
        />
      ))}
    </SliderPrimitive.Root>
  );
}

/* ─────────────────────────────── Switch ─────────────────────────────── */

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface-3 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent/80",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}

/* ─────────────────────────────── Tooltip ─────────────────────────────── */

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[80] max-w-xs rounded-lg border border-line-strong bg-shell px-2.5 py-1.5 text-xs leading-relaxed text-ink-2 shadow-xl animate-fade-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ─────────────────────────────── Dialog ─────────────────────────────── */

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px] animate-fade-in" />
        <DialogPrimitive.Content
          className={cn(
            "fixed top-1/2 left-1/2 z-[70] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line-strong bg-surface p-5 shadow-2xl animate-fade-in",
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-ink">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ──────────────────────────────── Sheet ──────────────────────────────── */

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  width = "max-w-xl",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50 animate-fade-in" />
        <DialogPrimitive.Content className={cn("fixed inset-y-0 right-0 z-[70] flex w-full flex-col border-l border-line-strong bg-shell shadow-2xl", width)}>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <DialogPrimitive.Title className="text-sm font-semibold text-ink">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Details panel</DialogPrimitive.Description>
            <DialogPrimitive.Close className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ─────────────────────────────── Inputs ─────────────────────────────── */

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-9 w-full rounded-lg border border-line bg-shell px-3 text-sm text-ink placeholder:text-muted outline-none transition-colors focus:border-accent/60 focus:ring-2 focus:ring-accent/20",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-20 w-full rounded-lg border border-line bg-shell px-3 py-2 text-sm text-ink placeholder:text-muted outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 rounded-lg border border-line bg-shell px-2.5 text-sm text-ink outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/20",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-ink-2", className)} {...props} />;
}

/* ─────────────────────────────── Misc ─────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function Meter({ value, tone = "accent", className }: { value: number; tone?: Tone; className?: string }) {
  const color: Record<Tone, string> = {
    neutral: "bg-ink-2",
    accent: "bg-accent",
    healthy: "bg-healthy",
    warning: "bg-warning",
    critical: "bg-critical",
    offline: "bg-offline",
    maint: "bg-maint",
    agent: "bg-agent",
  };
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", color[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 rounded-xl border border-line bg-surface-2 p-2.5 text-ink-2">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-2 px-1 py-px font-mono text-[10px] text-ink-2">{children}</kbd>;
}
