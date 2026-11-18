"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Route } from "lucide-react";
import { useFactory } from "@/client/store";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Select } from "@/components/ui/primitives";
import { amrPaths } from "@/components/three/amr-paths";
import { isoModelFromState, layoutIso } from "@/components/iso/model";
import { createTraffic, robotPosition, stepTraffic, trafficStats, ZONE, type TrafficSim } from "@/domain/agv-traffic";
import { amrFleet } from "@/domain/intralogistics";
import { cn } from "@/lib/cn";

/** Mobile-robot traffic on the aisle network: zone reservations, docks, congestion and service level. */
export default function FleetTrafficPage() {
  const state = useFactory((s) => s.state);
  const [speed, setSpeed] = useState(30);
  const [playing, setPlaying] = useState(true);
  const [, setFrame] = useState(0);
  const sim = useRef<TrafficSim | null>(null);

  const net = useMemo(() => {
    if (!state) return null;
    const layout = layoutIso(isoModelFromState(state, {}, { cameras: false }));
    const paths = amrPaths(layout, amrFleet(state), state.lines.map((l) => l.id));
    return {
      layout,
      paths,
      inputs: paths.map((p) => ({ id: p.amr.id, fleetId: p.amr.fleetId, points: p.points, speedMps: p.amr.speedMps, tripsPerHour: p.amr.tripsPerHour, active: p.amr.status === "active", phase: p.fleetSize > 1 ? p.slot / p.fleetSize : 0 })),
    };
  }, [state]);
  const key = net ? JSON.stringify(net.inputs.map((i) => [i.id, i.active, i.tripsPerHour, i.points.length])) : "";

  const reset = () => {
    if (net) sim.current = createTraffic(net.inputs);
    setFrame((f) => f + 1);
  };
  useEffect(reset, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (sim.current) stepTraffic(sim.current, dt * speed);
      acc += dt;
      if (acc > 1 / 15) {
        acc = 0;
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  if (!state || !net) return null;
  const s = sim.current;
  if (!net.paths.length || !s) return <EmptyState title="No mobile robots in this twin" description="Add a robot fleet in the Playground to see its traffic here." />;
  const st = trafficStats(s);
  const b = net.layout.bounds;
  const pad = 1;
  const vb = `${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + pad * 2} ${b.y1 - b.y0 + pad * 2}`;
  const maxWait = Math.max(1, ...st.zones.map((z) => z.waitS));
  const colorOf = new Map(net.paths.map((p) => [p.amr.id, p.color]));

  return (
    <div className="animate-fade-in space-y-3">
      <PageHeader
        title="Fleet traffic"
        description="Mobile robots on the aisle network with zone control: a robot reserves the next zone before it drives in. Aisles are two-way, so robots are held only by a robot ahead in their lane or by crossing traffic. Shows where robots queue and whether each fleet keeps up with what its line needs."
      />
      <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader
            title="Aisle network"
            description="Zones shaded by waiting time; squares are docks; robots turn red while held."
            icon={<Route className="h-4 w-4" />}
            actions={
              <div className="flex gap-2">
                <Select aria-label="Simulation speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                  {[1, 10, 30, 120].map((x) => (
                    <option key={x} value={x}>
                      {x}× real time
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="secondary" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
                  {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="secondary" onClick={reset} aria-label="Restart">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            }
          />
          <CardBody>
            <svg viewBox={vb} className="h-[480px] w-full rounded-lg border border-line bg-shell" data-testid="traffic-map" role="img" aria-label="Robot routes, zones and docks">
              {net.layout.bays.map((bay) => (
                <rect key={bay.id} x={bay.x0} y={bay.y0} width={bay.x1 - bay.x0} height={bay.y1 - bay.y0} fill="none" stroke="var(--color-line)" strokeWidth={0.05} rx={0.2} />
              ))}
              {net.layout.machines.map((m) => (
                <rect key={m.m.id} x={m.x - 0.35} y={m.y - 0.35} width={0.7} height={0.7} fill="var(--color-surface-3)" rx={0.08} />
              ))}
              {st.zones.map((z) => (
                <rect key={z.zone} x={z.x - ZONE / 2} y={z.y - ZONE / 2} width={ZONE} height={ZONE} fill="#ef4444" fillOpacity={z.waitS > 0 ? 0.08 + 0.55 * (z.waitS / maxWait) : 0} stroke="var(--color-line)" strokeOpacity={0.35} strokeWidth={0.02} />
              ))}
              {net.paths.map((p) => (
                <polyline key={p.amr.id} points={p.points.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke={p.color} strokeOpacity={0.55} strokeWidth={0.08} />
              ))}
              {st.docks.map((d) => (
                <rect key={d.zone} x={d.x - 0.32} y={d.y - 0.32} width={0.64} height={0.64} fill="none" stroke="var(--color-accent)" strokeWidth={0.08} />
              ))}
              {s.robots.map((r) => {
                const pos = robotPosition(s, r.input.id);
                if (!pos) return null;
                return <circle key={r.input.id} cx={pos.x} cy={pos.y} r={0.28} fill={!r.input.active ? "#64748b" : pos.waiting ? "#ef4444" : (colorOf.get(r.input.id) ?? "#4c8dff")} stroke="#0b1020" strokeWidth={0.05} />;
              })}
            </svg>
          </CardBody>
        </Card>
        <div className="space-y-3">
          <Card>
            <CardHeader title="Traffic" />
            <CardBody className="grid grid-cols-2 gap-2 text-[12px]" data-testid="traffic-kpis">
              <Kpi label="Simulated" value={formatS(st.seconds)} />
              <Kpi label="Robots" value={`${st.robots.filter((r) => r.active).length} active / ${st.robots.length}`} />
              <Kpi label="Waiting, all robots" value={formatS(st.totalWaitS)} />
              <Kpi label="Deadlocks broken" value={String(st.deadlocksBroken)} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Service per robot" description="Trips per hour achieved against what the line needs." />
            <CardBody>
              <table className="w-full text-[12px]" data-testid="traffic-robots">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-1 font-medium">Robot</th>
                    <th className="py-1 font-medium">Trips/h</th>
                    <th className="py-1 font-medium">Waiting</th>
                  </tr>
                </thead>
                <tbody>
                  {st.robots.map((r) => {
                    const short = r.active && st.seconds > 1800 && r.tripsPerHour < r.requiredPerHour * 0.9;
                    return (
                      <tr key={r.id} className="border-t border-line">
                        <td className="py-1 font-mono text-[11px] text-ink">{r.id}</td>
                        <td className="tabular py-1 text-ink-2">
                          {r.active ? `${r.tripsPerHour} / ${r.requiredPerHour}` : "parked"} {short && <Badge tone="warning">short</Badge>}
                        </td>
                        <td className={cn("tabular py-1", r.waitPct > 10 ? "text-warning-ink" : "text-ink-2")}>{r.waitPct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Congestion hot spots" description="Zones where robots waited longest." />
            <CardBody>
              {st.hotspots.length === 0 ? (
                <p className="text-[12px] text-muted">No queuing so far.</p>
              ) : (
                <ul className="space-y-1 text-[12px]" data-testid="traffic-hotspots">
                  {st.hotspots.map((z) => (
                    <li key={z.zone} className="flex items-center justify-between">
                      <span className="font-mono text-[11px] text-ink-2">
                        zone {z.zone} · {z.robots} robots use it
                      </span>
                      <span className="tabular text-ink">{formatS(z.waitS)} waited</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line px-2 py-1.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="tabular text-[14px] font-medium text-ink">{value}</p>
    </div>
  );
}

function formatS(sec: number) {
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.floor(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
}
