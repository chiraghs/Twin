"use client";

import { useMemo } from "react";
import { cameraView } from "@/domain/quality";
import type { Asset, Camera, FactoryState } from "@/domain/types";
import type { Highlight } from "@/client/store";
import { STATUS_META } from "../ui/status";import { SERIES } from "../charts/kit";



/** Simplified 2D floor plan: bays, machine footprints and conveyor flow, coloured by live status. */
export function FloorView({ state, highlight, selectedId, onSelect }: { state: FactoryState; highlight: Highlight | null; selectedId: string | null; onSelect: (id: string) => void }) {
  const assembly = state.lines.filter((l) => l.kind === "assembly");
  const packaging = state.lines.filter((l) => l.kind === "packaging");
  const bayH = 120;
  const height = 80 + assembly.length * (bayH + 30) + 40;
  const tileW = 150;
  const tileH = 64;
  const get = (id: string) => state.assets.find((a) => a.id === id) as Asset;
  const dim = (a: Asset) => !!highlight && !highlight.assetIds.includes(a.id) && a.id !== highlight.targetAssetId && a.lineId !== highlight.rerouteLineId;

  const tile = (a: Asset, x: number, y: number) => {
    const m = STATUS_META[a.status];
    const sel = a.id === selectedId;
    const target = highlight?.targetAssetId === a.id;
    return (
      <g key={a.id} transform={`translate(${x},${y})`} onClick={() => onSelect(a.id)} style={{ cursor: "pointer", opacity: dim(a) ? 0.35 : 1 }}>
        <rect width={tileW} height={tileH} rx={10} fill="var(--color-surface)" stroke={sel ? "var(--color-accent)" : target ? "var(--color-accent-ink)" : m.color} strokeOpacity={sel || target ? 1 : 0.65} strokeWidth={sel || target ? 2.5 : 1.5} />
        <rect x={0} y={0} width={6} height={tileH} rx={3} fill={m.color} />
        <text x={16} y={22} fill="var(--color-ink)" fontSize={12} fontFamily="var(--font-mono)">
          {a.id}
        </text>
        <text x={16} y={40} fill="var(--color-ink-2)" fontSize={11}>
          {a.name.length > 20 ? a.name.slice(0, 19) + "…" : a.name}
        </text>
        <text x={16} y={56} fill={m.color} fontSize={10.5}>
          {m.label} · {a.healthScore.toFixed(0)}
        </text>
        {(a.status === "critical" || a.status === "offline") && <circle cx={tileW - 12} cy={12} r={5} fill={m.color} className="animate-pulse" />}
      </g>
    );
  };

  const asmX0 = 170;
  const gap = 40;
  const maxRow = Math.max(4, ...assembly.map((l) => l.assetIds.length));
  const pkgX = asmX0 + maxRow * (tileW + gap) + 30;
  const dockW = 170;
  const width = pkgX + tileW + 40 + dockW + 30;

  // Tile positions (same formulas as the bays below) for placing camera markers.
  const tilePos: Record<string, { x: number; y: number }> = {};
  assembly.forEach((l, li) => l.assetIds.forEach((id, i) => (tilePos[id] = { x: asmX0 + i * (tileW + gap), y: 40 + li * (bayH + 30) + 38 })));
  packaging.forEach((l) => l.assetIds.forEach((id, i) => (tilePos[id] = { x: pkgX, y: 80 + i * ((height - 80 - 60) / Math.max(1, l.assetIds.length)) })));
  const alerts = useMemo(() => Object.fromEntries(state.cameras.map((c) => [c.id, cameraView(state, c).detections.some((d) => d.tone === "bad")])), [state]);
  const camPos = (c: Camera): { x: number; y: number } | null => {
    const line = state.lines.find((l) => l.id === c.lineId);
    if (c.kind === "inspection") {
      const p = c.assetId ? tilePos[c.assetId] : null;
      if (!p) return null;
      return line?.kind === "packaging" ? { x: p.x + tileW + 2, y: p.y + 6 } : { x: p.x + tileW - 26, y: p.y - 20 };
    }
    if (c.kind === "thermal") {
      const ps = c.covers.map((id) => tilePos[id]).filter(Boolean);
      if (!ps.length) return null;
      return { x: (Math.min(...ps.map((p) => p.x)) + Math.max(...ps.map((p) => p.x)) + tileW) / 2 - 12, y: ps[0].y + tileH + 2 };
    }
    if (c.kind === "dock") return { x: width - 64, y: 48 };
    if (!line) return { x: 73, y: height - 64 };
    if (line.kind === "packaging") return { x: pkgX + tileW - 14, y: 50 };
    return { x: pkgX - 52, y: 40 + assembly.indexOf(line) * (bayH + 30) + 8 };
  };

  return (
    <div className="h-full w-full overflow-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full min-h-[520px] w-full" role="img" aria-label="2D factory floor view">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-muted)" />
          </marker>
          <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--color-surface-3)" strokeWidth="2" />
          </pattern>
        </defs>
        <rect x={10} y={10} width={width - 20} height={height - 20} rx={18} fill="var(--color-shell)" stroke="var(--color-line-strong)" />
        {/* Stores */}
        <rect x={30} y={40} width={110} height={height - 80} rx={12} fill="url(#hatch)" stroke="var(--color-line)" />
        <text x={85} y={64} textAnchor="middle" fill="var(--color-muted)" fontSize={11} fontWeight={600}>
          COMPONENT
        </text>
        <text x={85} y={78} textAnchor="middle" fill="var(--color-muted)" fontSize={11} fontWeight={600}>
          STORES
        </text>
        {state.inventory.slice(0, 7).map((i, k) => (
          <text key={i.id} x={85} y={110 + k * 22} textAnchor="middle" fill={i.onHand < i.reorderPoint ? "#f59e0b" : "var(--color-ink-2)"} fontSize={10.5} fontFamily="var(--font-mono)">
            {i.id}
          </text>
        ))}
        {/* Assembly bays */}
        {assembly.map((l, li) => {
          const y = 40 + li * (bayH + 30);
          const color = SERIES[state.lines.indexOf(l) % SERIES.length];
          const hl = highlight && (highlight.lineIds.includes(l.id) || highlight.rerouteLineId === l.id);
          return (
            <g key={l.id}>
              <rect x={asmX0 - 16} y={y} width={pkgX - asmX0 - 4} height={bayH} rx={14} fill="var(--color-deep)" stroke={hl ? "var(--color-accent-ink)" : "var(--color-line)"} strokeDasharray={hl ? undefined : "6 6"} />
              <rect x={asmX0 - 16} y={y} width={5} height={bayH} rx={2} fill={color} />
              <text x={asmX0} y={y + 20} fill="var(--color-ink)" fontSize={12} fontWeight={600}>
                {l.name}
              </text>
              <text x={asmX0 + 120} y={y + 20} fill="var(--color-muted)" fontSize={11}>
                {Object.entries(l.allocation)
                  .filter(([, s]) => s > 0)
                  .map(([p]) => p)
                  .join(" · ")}{" "}
                · {l.state}
              </text>
              {l.assetIds.map((id, i) => {
                const x = asmX0 + i * (tileW + gap);
                return (
                  <g key={id}>
                    {i > 0 && <line x1={x - gap + 4} y1={y + 38 + tileH / 2} x2={x - 6} y2={y + 38 + tileH / 2} stroke="var(--color-muted)" strokeWidth={3} markerEnd="url(#arrow)" />}
                    {tile(get(id), x, y + 38)}
                  </g>
                );
              })}
              <path d={`M ${asmX0 + l.assetIds.length * (tileW + gap) - gap + 4} ${y + 38 + tileH / 2} H ${pkgX - 26}`} stroke="var(--color-muted)" strokeWidth={3} fill="none" markerEnd="url(#arrow)" />
            </g>
          );
        })}
        {/* Packaging bay */}
        {packaging.map((l) => {
          const color = SERIES[state.lines.indexOf(l) % SERIES.length];
          const hl = highlight?.lineIds.includes(l.id);
          const h = height - 80;
          return (
            <g key={l.id}>
              <rect x={pkgX - 16} y={40} width={tileW + 32} height={h} rx={14} fill="var(--color-deep)" stroke={hl ? "var(--color-accent-ink)" : "var(--color-line)"} strokeDasharray={hl ? undefined : "6 6"} />
              <rect x={pkgX - 16} y={40} width={tileW + 32} height={5} rx={2} fill={color} />
              <text x={pkgX} y={64} fill="var(--color-ink)" fontSize={12} fontWeight={600}>
                {l.name}
              </text>
              {l.assetIds.map((id, i) => {
                const y = 80 + i * ((h - 60) / Math.max(1, l.assetIds.length));
                return (
                  <g key={id}>
                    {i > 0 && <line x1={pkgX + tileW / 2} y1={y - 14} x2={pkgX + tileW / 2} y2={y - 4} stroke="var(--color-muted)" strokeWidth={3} markerEnd="url(#arrow)" />}
                    {tile(get(id), pkgX, y)}
                  </g>
                );
              })}
            </g>
          );
        })}
        {/* Shipping dock */}
        <rect x={pkgX + tileW + 40} y={40} width={width - (pkgX + tileW + 40) - 30} height={height - 80} rx={12} fill="url(#hatch)" stroke="var(--color-line)" />
        <text x={pkgX + tileW + 40 + (width - (pkgX + tileW + 40) - 30) / 2} y={64} textAnchor="middle" fill="var(--color-muted)" fontSize={11} fontWeight={600}>
          SHIPPING DOCK
        </text>
        {state.orders.map((o, k) => (
          <text
            key={o.id}
            x={pkgX + tileW + 40 + (width - (pkgX + tileW + 40) - 30) / 2}
            y={100 + k * 24}
            textAnchor="middle"
            fill={highlight?.orderIds.includes(o.id) ? "var(--color-accent-ink)" : "var(--color-ink-2)"}
            fontSize={10.5}
            fontFamily="var(--font-mono)"
          >
            {o.id} {Math.round((o.fulfilled / o.quantity) * 100)}%
          </text>
        ))}
        {/* Cameras */}
        {state.cameras.map((c) => {
          const p = camPos(c);
          if (!p) return null;
          const sel = selectedId === `cam:${c.id}`;
          const alert = alerts[c.id];
          const lens = c.kind === "thermal" ? "#fb923c" : alert ? "#ef4444" : "var(--color-accent)";
          return (
            <g
              key={c.id}
              transform={`translate(${p.x},${p.y})`}
              onClick={(e) => (e.stopPropagation(), onSelect(`cam:${c.id}`))}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              className="outline-none"
              aria-label={`Camera ${c.id}`}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(`cam:${c.id}`))}
            >
              <title>{`${c.id} · ${c.name}`}</title>
              <rect x={-4} y={-4} width={32} height={24} fill="transparent" />
              <rect width={24} height={16} rx={4} fill="var(--color-shell)" stroke={sel ? "var(--color-accent)" : alert ? "#ef4444" : "var(--color-line-strong)"} strokeWidth={sel ? 2 : 1.2} />
              <circle cx={14} cy={8} r={4} fill={lens} />
              <circle cx={6} cy={5} r={1.6} fill="#ef4444" className="iso-blink" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
