"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useRecording } from "@/client/recording";
import { useUi } from "@/client/store";

/** Screens and views added during the hackathon (everything else existed before it). */
const NEW_PATHS = ["/commissioning", "/sequencer", "/fleet-traffic"];

/**
 * Demo-video overlay, toggled with Shift + C: a corner badge saying whether the screen existed
 * before the hackathon or was built during it, and captions of the voice conversation.
 */
export function RecordingOverlay() {
  const on = useRecording((s) => s.on);
  const heard = useRecording((s) => s.heard);
  const reply = useRecording((s) => s.reply);
  const toggle = useRecording((s) => s.toggle);
  const view = useUi((s) => s.twinView);
  const path = usePathname();
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.code !== "KeyC" || (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]"))) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [toggle]);
  if (!on) return null;
  const isVR = path.startsWith("/twin") && view === "vr";
  const isNew = isVR || NEW_PATHS.some((p) => path.startsWith(p));
  const badgeLabel = isVR
    ? "NEW · Meta Quest VR & Tabletop MR (Spatial Twin)"
    : isNew
      ? "NEW · built during the hackathon"
      : "EXISTING · before the hackathon";
  return (
    <div className="pointer-events-none fixed inset-0 z-[2147483646]" data-testid="recording-overlay">
      <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 px-4 py-1.5 text-[12.5px] font-semibold tracking-wide shadow-2xl backdrop-blur-md bg-black/85 text-white">
        <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
        <span className={isNew ? "text-accent-ink font-bold" : "text-slate-300 font-medium"}>
          {badgeLabel}
        </span>
        <span className="text-[10.5px] font-normal text-slate-400">· Shift+C</span>
      </div>
      {(heard || reply) && (
        <div className="absolute bottom-20 left-1/2 w-[min(920px,calc(100%-32px))] -translate-x-1/2 space-y-2 text-center pointer-events-none">
          {heard && (
            <p className="mx-auto inline-block rounded-xl border border-white/15 bg-black/85 px-5 py-2 text-[22px] font-semibold text-white shadow-2xl backdrop-blur">
              🎙 “{heard}”
            </p>
          )}
          {reply && (
            <p className="mx-auto block rounded-xl border border-white/10 bg-black/75 px-5 py-2.5 text-[17px] font-medium leading-relaxed text-slate-100 shadow-2xl backdrop-blur">
              {reply.length > 240 ? `${reply.slice(0, 239)}…` : reply}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
