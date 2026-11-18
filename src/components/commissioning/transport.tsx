"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Route } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, Select } from "@/components/ui/primitives";
import { createTransport, PITCH, stationState, stepTransport, syncTransport, transportStats, type StationState, type TransportSim } from "@/domain/transport";
import type { FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";

const PRODUCT_COLORS = ["#4c8dff", "#f59e0b", "#22c55e", "#e879f9", "#38bdf8", "#f87171"];
const STATE_FILL: Record<StationState, string> = { working: "#22c55e", blocked: "#f59e0b", starved: "#64748b", down: "#ef4444" };
const K = 46; // px per metre

/**
 * Units moving through one line: source, belts, machines, photo-eyes and sink, per product. Runs in
 * the browser on the twin's live machine states (speed, trips, maintenance), faster than real time
 * if you like.
 */
export function TransportPanel({ state, lineId: initialLine }: { state: FactoryState; lineId: string }) {
  const [lineId, setLineId] = useState(initialLine);
  const [speed, setSpeed] = useState(60);
  const [playing, setPlaying] = useState(true);
  const [, setFrame] = useState(0);
  const sim = useRef<TransportSim | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => setLineId(initialLine), [initialLine]);
  const reset = () => {
    sim.current = createTransport(stateRef.current, lineId);
    setFrame((f) => f + 1);
  };
  useEffect(reset, [lineId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sim.current) syncTransport(sim.current, state);
  }, [state]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (sim.current) stepTransport(sim.current, dt * speed);
      acc += dt;
      if (acc > 1 / 20) {
        acc = 0;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const s = sim.current;
  if (!s) return null;
  const stats = transportStats(s);
  const products = s.mix.map((m) => m.productId);
  const color = (p: string) => PRODUCT_COLORS[Math.max(0, products.indexOf(p)) % PRODUCT_COLORS.length];
  const productName = (id: string) => state.products.find((p) => p.id === id)?.name ?? id;
  const W = (s.length + 1.2) * K;
  const beltY = 70;

  return (
    <Card className="mt-3">
      <CardHeader
        title="Product flow · per unit"
        description="Every unit on the line: released by the source in the product mix, carried by the belts, held by each machine for its cycle time, counted by the photo-eyes and the sink. Follows live speed changes, trips and maintenance."
        icon={<Route className="h-4 w-4" />}
        actions={
          <div className="flex items-center gap-2">
            <Select aria-label="Line" value={lineId} onChange={(e) => setLineId(e.target.value)}>
              {state.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <Select aria-label="Simulation speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[1, 10, 60].map((x) => (
                <option key={x} value={x}>
                  {x}× real time
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="secondary" onClick={reset} aria-label="Restart the flow">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-3">
        <div className="overflow-x-auto rounded-lg border border-line bg-shell" data-testid="transport-strip">
          <svg width={W} height={150} viewBox={`0 0 ${W} 150`} role="img" aria-label="Units moving along the line">
            {/* belt */}
            <rect x={0.2 * K} y={beltY - 9} width={(s.length - 0.2) * K} height={18} rx={4} fill="#1f2937" stroke="#374151" />
            {/* source and sink */}
            <text x={0.2 * K} y={beltY + 30} fill="#94a3b8" fontSize={10}>
              source
            </text>
            <text x={s.length * K - 8} y={beltY + 30} fill="#94a3b8" fontSize={10}>
              sink
            </text>
            {/* machines */}
            {s.stations.map((st) => {
              const stt = stationState(s, st);
              return (
                <g key={st.assetId}>
                  <rect x={(st.x + 0.2) * K - 22} y={beltY - 28} width={44} height={56} rx={5} fill="#111827" stroke={STATE_FILL[stt]} strokeWidth={2} />
                  <text x={(st.x + 0.2) * K} y={beltY - 34} fill="#e5e7eb" fontSize={10} textAnchor="middle" fontFamily="monospace">
                    {st.assetId}
                  </text>
                  <text x={(st.x + 0.2) * K} y={beltY + 42} fill={STATE_FILL[stt]} fontSize={10} textAnchor="middle">
                    {stt}
                  </text>
                </g>
              );
            })}
            {/* photo-eyes */}
            {s.sensors.map((se) => {
              const blocked = se.coveredS > 2;
              return (
                <g key={se.id}>
                  <line x1={(se.x + 0.2) * K} x2={(se.x + 0.2) * K} y1={beltY - 14} y2={beltY + 14} stroke={blocked ? "#ef4444" : "#38bdf8"} strokeDasharray="2 2" />
                  <circle cx={(se.x + 0.2) * K} cy={beltY + 16} r={3} fill={blocked ? "#ef4444" : "#38bdf8"} />
                  <text x={(se.x + 0.2) * K} y={beltY + 58} fill="#94a3b8" fontSize={9} textAnchor="middle">
                    {se.count}
                  </text>
                </g>
              );
            })}
            {/* units */}
            {s.units.map((u) => (
              <rect key={u.id} x={(u.x + 0.2) * K - (PITCH * K * 0.7) / 2} y={beltY - 7} width={PITCH * K * 0.7} height={14} rx={2} fill={color(u.productId)} stroke="#0b1020" />
            ))}
          </svg>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]" data-testid="transport-stats">
          <span className="text-muted">
            Simulated <span className="tabular text-ink">{formatDuration(stats.seconds)}</span>
          </span>
          <span className="text-muted">
            Released <span className="tabular text-ink">{stats.created}</span>
          </span>
          <span className="text-muted">
            On the line <span className="tabular text-ink">{stats.wip}</span>
          </span>
          <span className="text-muted">
            Finished <span className="tabular text-ink" data-testid="transport-finished">{stats.finished}</span>
          </span>
          <span className="text-muted">
            Rate <span className="tabular text-ink">{stats.ratePerHour} u/h</span>
          </span>
          {stats.avgLeadTimeS !== null && (
            <span className="text-muted">
              Lead time <span className="tabular text-ink">{formatDuration(stats.avgLeadTimeS)}</span>
            </span>
          )}
          {stats.bottleneck && <Badge tone="warning">bottleneck {stats.bottleneck}</Badge>}
        </div>
        <div className="flex flex-wrap gap-3 text-[11.5px]">
          {products.map((p) => (
            <span key={p} className="flex items-center gap-1.5 text-ink-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(p) }} /> {productName(p)} · <span className="tabular text-ink">{stats.finishedByProduct[p] ?? 0}</span> finished
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-left text-muted">
              <tr>
                {["Machine", "State", "Processed", "Working", "Blocked", "Starved"].map((h) => (
                  <th key={h} className="px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.stations.map((st) => (
                <tr key={st.assetId} className="border-t border-line">
                  <td className="px-2 py-1 text-ink">
                    <span className="font-mono text-[11px] text-muted">{st.assetId}</span> {st.name}
                  </td>
                  <td className={cn("px-2 py-1")} style={{ color: STATE_FILL[st.state] }}>
                    {st.state}
                  </td>
                  <td className="tabular px-2 py-1 text-ink-2">{st.processed}</td>
                  <td className="tabular px-2 py-1 text-ink-2">{st.utilisationPct}%</td>
                  <td className="tabular px-2 py-1 text-ink-2">{st.blockedPct}%</td>
                  <td className="tabular px-2 py-1 text-ink-2">{st.starvedPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function formatDuration(sec: number) {
  if (sec < 60) return `${sec.toFixed(0)} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
  return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
}
