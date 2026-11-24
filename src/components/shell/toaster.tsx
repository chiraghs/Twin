"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useFactory } from "@/client/store";
import { cn } from "@/lib/cn";

export function Toaster() {
  const toasts = useFactory((s) => s.toasts);
  const dismiss = useFactory((s) => s.dismiss);
  const top = toasts.filter((t) => t.corner === "top");
  return (
    <>
      {top.length > 0 && (
        <div className="pointer-events-none fixed top-4 right-4 z-[90] flex max-w-[calc(100vw-32px)] flex-col items-end gap-1.5" aria-live="polite">
          {top.map((t) => (
            <div key={t.id} role="status" className="pointer-events-auto flex items-center gap-2 rounded-lg border border-warning/40 bg-shell/95 py-1.5 pr-1.5 pl-2.5 text-xs shadow-xl backdrop-blur animate-fade-in">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
              <span className="font-medium text-ink">{t.title}</span>
              {t.detail && <span className="hidden text-muted sm:inline">{t.detail}</span>}
              <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Dismiss">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    <div className="pointer-events-none fixed right-4 bottom-4 z-[90] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2" aria-live="polite">
      {toasts.filter((t) => t.corner !== "top").map((t) => {
        const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertCircle : Info;
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-shell/95 px-3.5 py-3 shadow-2xl backdrop-blur animate-fade-in",
              t.tone === "success" ? "border-healthy/40" : t.tone === "error" ? "border-critical/50" : "border-line-strong",
            )}
          >
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.tone === "success" ? "text-healthy" : t.tone === "error" ? "text-critical" : "text-accent")} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{t.title}</p>
              {t.detail && <p className="mt-0.5 text-xs text-muted">{t.detail}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
    </>
  );
}
