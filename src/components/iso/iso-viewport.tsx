"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Cctv, Maximize, Minus, Plus, Radio, RotateCcw, RotateCw, Tag } from "lucide-react";
import type { FactoryState } from "@/domain/types";
import type { Highlight } from "@/client/store";
import { cn } from "@/lib/cn";
import { Tip } from "../ui/primitives";
import { IsoScene } from "./iso-scene";
import { isoModelFromState } from "./model";

/** Interactive isometric twin: wheel-zoom toward cursor, drag to pan, rotate in 90° steps. */
export function IsoViewport({
  state,
  highlight,
  selectedId,
  onSelect,
  orderRisk,
}: {
  state: FactoryState;
  highlight: Highlight | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  orderRisk: Record<string, boolean>;
}) {
  const model = useMemo(() => isoModelFromState(state, orderRisk, { cameras: true }), [state, orderRisk]);
  const [rotation, setRotation] = useState(0);
  const [cameras, setCameras] = useState(true);
  const [labels, setLabels] = useState<"smart" | "all">("smart");
  const [sensors, setSensors] = useState(false);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const isoHighlight = useMemo(
    () =>
      highlight
        ? {
            assetIds: highlight.assetIds,
            lineIds: highlight.lineIds,
            targetAssetId: highlight.targetAssetId,
            rerouteLineId: highlight.rerouteLineId,
            targetLabel: highlight.kind === "continue" ? "runs to predicted trip" : highlight.kind === "baseline" ? "assumed healthy" : "maintenance window",
          }
        : null,
    [highlight],
  );

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const s = Math.min(4, Math.max(0.5, v.s * factor));
      const rect = ref.current?.getBoundingClientRect();
      const px = cx !== undefined && rect ? cx - rect.left : (rect?.width ?? 0) / 2;
      const py = cy !== undefined && rect ? cy - rect.top : (rect?.height ?? 0) / 2;
      const k = s / v.s;
      return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div
        ref={ref}
        className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
        onWheel={(e) => zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY)}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) > 4) {
            d.moved = true;
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          }
          if (d.moved) setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }}
        onPointerUp={() => {
          setTimeout(() => (drag.current = null), 0);
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        onClick={() => onSelect(null)}
      >
        <div className="h-full w-full origin-top-left p-6" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
          <IsoScene
            model={model}
            rotation={rotation}
            highlight={isoHighlight}
            selectedId={selectedId}
            onSelect={(id) => onSelect(id)}
            labels={labels}
            sensors={sensors}
            showCameras={cameras}
            className="h-full w-full"
          />
        </div>
      </div>

      <div className="absolute bottom-3 left-3 flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface shadow-[var(--shadow-card)]">
        {[
          { label: "Zoom in", icon: Plus, onClick: () => zoomAt(1.25) },
          { label: "Zoom out", icon: Minus, onClick: () => zoomAt(0.8) },
          { label: "Fit view", icon: Maximize, onClick: () => setView({ s: 1, x: 0, y: 0 }) },
          { label: "Rotate left", icon: RotateCcw, onClick: () => setRotation((r) => r + 3) },
          { label: "Rotate right", icon: RotateCw, onClick: () => setRotation((r) => r + 1) },
        ].map((b) => (
          <Tip key={b.label} content={b.label} side="right">
            <button onClick={b.onClick} aria-label={b.label} className="flex h-8 w-8 items-center justify-center border-b border-line text-ink-2 last:border-0 hover:bg-surface-2 hover:text-ink">
              <b.icon className="h-3.5 w-3.5" />
            </button>
          </Tip>
        ))}
      </div>

      <div className="absolute bottom-3 left-14 flex gap-1.5">
        <button
          onClick={() => setLabels(labels === "all" ? "smart" : "all")}
          aria-pressed={labels === "all"}
          className={cn("flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px]", labels === "all" ? "border-accent/50 bg-accent/12 text-accent-ink" : "border-line bg-surface text-muted hover:text-ink")}
        >
          <Tag className="h-3 w-3" /> {labels === "all" ? "All labels" : "Smart labels"}
        </button>
        <button
          onClick={() => setSensors(!sensors)}
          aria-pressed={sensors}
          className={cn("flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px]", sensors ? "border-accent/50 bg-accent/12 text-accent-ink" : "border-line bg-surface text-muted hover:text-ink")}
        >
          <Radio className="h-3 w-3" /> Sensors
        </button>
        <button
          onClick={() => setCameras(!cameras)}
          aria-pressed={cameras}
          className={cn("flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px]", cameras ? "border-accent/50 bg-accent/12 text-accent-ink" : "border-line bg-surface text-muted hover:text-ink")}
        >
          <Cctv className="h-3 w-3" /> Cameras
        </button>
      </div>
      <p className="pointer-events-none absolute right-3 bottom-3 hidden text-[10.5px] text-muted sm:block">Scroll to zoom · drag to pan · click a machine, camera, rack or truck</p>
    </div>
  );
}
