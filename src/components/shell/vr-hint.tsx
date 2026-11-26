"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useUi } from "@/client/store";

const KEY = "twin:vr-hint-done";

/**
 * First-visit pointer to the VR mode: a hand points at Digital Twin Studio in the sidebar, then (on
 * that page) at the VR tab. Gone for good once VR is opened or the hint is dismissed.
 */
export function VrHint() {
  const pathname = usePathname();
  const view = useUi((s) => s.twinView);
  const [done, setDone] = useState(true);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const onTwin = pathname === "/twin" || pathname.startsWith("/twin/");
  const target = onTwin ? "vr-tab" : "twin-nav";

  const finish = () => {
    setDone(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  };

  useEffect(() => {
    try {
      setDone(localStorage.getItem(KEY) === "1");
    } catch {
      setDone(false);
    }
  }, []);

  useEffect(() => {
    if (onTwin && view === "vr") finish();
  }, [onTwin, view]);

  // Follow the target (sidebar item or VR tab) as the page lays out, scrolls or resizes.
  useEffect(() => {
    if (done) return;
    const tick = () => {
      const r = document.querySelector(`[data-hint="${target}"]`)?.getBoundingClientRect();
      const visible = r && r.width > 0 && r.right > 0 && r.bottom > 0 && r.top < window.innerHeight;
      setRect((prev) => (!visible ? null : prev && prev.top === r.top && prev.left === r.left && prev.width === r.width ? prev : r));
    };
    tick();
    const id = window.setInterval(tick, 300);
    window.addEventListener("resize", tick);
    window.addEventListener("scroll", tick, true);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", tick);
      window.removeEventListener("scroll", tick, true);
    };
  }, [done, target]);

  if (done || !rect) return null;
  const side = target === "twin-nav";
  return (
    <>
      <style>{`
        @keyframes vrhint-x { 0%,100% { transform: translate(0,-50%) } 50% { transform: translate(-8px,-50%) } }
        @keyframes vrhint-y { 0%,100% { transform: translate(-50%,0) } 50% { transform: translate(-50%,-8px) } }
        @keyframes vrhint-ring { 0% { opacity: .9; transform: scale(1) } 100% { opacity: 0; transform: scale(1.12) } }
      `}</style>
      {/* A pulsing outline on the target */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[60] rounded-lg border-2 border-accent"
        style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6, animation: "vrhint-ring 1.4s ease-out infinite" }}
      />
      {side ? (
        <div className="pointer-events-none fixed z-[60] flex items-center gap-2" style={{ left: rect.right + 8, top: rect.top + rect.height / 2, animation: "vrhint-x 1.2s ease-in-out infinite" }}>
          <span aria-hidden className="text-[30px] leading-none drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]">👈</span>
          <Bubble onClose={finish} title="Try Twin in VR" body="Open Digital Twin Studio, then press VR." />
        </div>
      ) : (
        <div className="pointer-events-none fixed z-[60] flex flex-col items-center gap-1.5" style={{ left: rect.left + rect.width / 2, top: rect.bottom + 6, animation: "vrhint-y 1.2s ease-in-out infinite" }}>
          <span aria-hidden className="text-[30px] leading-none drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)]">👆</span>
          <Bubble onClose={finish} title="Press VR" body="Walk the plant on Meta Quest, or try it here in the browser simulator." />
        </div>
      )}
    </>
  );
}

function Bubble({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <div role="note" className="pointer-events-auto flex max-w-[260px] items-start gap-2 rounded-lg border border-accent/50 bg-surface px-3 py-2 shadow-lg">
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-2">{body}</p>
      </div>
      <button onClick={onClose} aria-label="Dismiss" className="-mr-1 -mt-0.5 rounded p-0.5 text-muted hover:bg-surface-2 hover:text-ink">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
