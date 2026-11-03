"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BatteryWarning, Factory, Leaf, Recycle, Zap, FlaskConical, Info } from "lucide-react";
import { useKpis } from "@/client/hooks";
import { useFactory } from "@/client/store";
import { AXIS_TICK, ChartTooltip, GRID, lineColor } from "@/components/charts/kit";
import { EnergyByLineChart } from "@/components/dashboard/charts";
import { KeyValue, PageHeader, StatTile } from "@/components/page";
import { scenarioColor } from "@/components/simulator/compare";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Slider } from "@/components/ui/primitives";
import { fmtInt, fmtMoney, fmtNum, fmtPct } from "@/lib/format";

const STANDBY_REDUCTION = 0.6;

export default function SustainabilityPage() {
  const state = useFactory((s) => s.state)!;
  const data = useKpis(state);
  const [gridFactor, setGridFactor] = useState(0.71);

  const stats = useMemo(() => {
    const end = state.clock.hour;
    const recs = state.production.filter((r) => r.hour >= Math.floor(end) - 24);
    const byLine = state.lines.map((l) => {
      const rs = recs.filter((r) => r.lineId === l.id);
      const kwh = rs.reduce((s, r) => s + r.energyKwh, 0);
      const idle = rs.reduce((s, r) => s + r.idleEnergyKwh, 0);
      const good = rs.reduce((s, r) => s + r.goodUnits, 0);
      const scrap = rs.reduce((s, r) => s + r.scrapUnits, 0);
      return { line: l, kwh, idle, good, scrap, intensity: good > 0 ? kwh / good : 0, excessScrap: Math.max(0, scrap - (good + scrap) * l.baseScrapRate) };
    });
    const pkgIds = new Set(state.lines.filter((l) => l.kind === "packaging").map((l) => l.id));
    const output = recs.filter((r) => pkgIds.has(r.lineId)).reduce((s, r) => s + r.goodUnits, 0);
    const kwh = byLine.reduce((s, x) => s + x.kwh, 0);
    const idle = byLine.reduce((s, x) => s + x.idle, 0);
    const scrap = byLine.filter((x) => x.line.kind === "assembly").reduce((s, x) => s + x.scrap, 0);
    const excessScrap = byLine.filter((x) => x.line.kind === "assembly").reduce((s, x) => s + x.excessScrap, 0);
    const avgMaterial = state.products.reduce((s, p) => s + p.unitMaterialCost, 0) / Math.max(1, state.products.length);
    return { byLine, output, kwh, idle, scrap, excessScrap, avoidableIdle: idle * STANDBY_REDUCTION, avgMaterial };
  }, [state]);

  const run = state.scenarioRuns.find((r) => r.results[0]?.hourly.length);
  const scenarios = run?.results ?? [];
  const cont = scenarios.find((r) => r.definition.id === "continue");
  const best = scenarios.find((r) => r.definition.id === run?.recommendedId);
  if (!data) return null;
  const price = state.costModel.energyPricePerKwh;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Sustainability & Waste Intelligence"
        description="Energy, idle waste and scrap from the twin's metered history (last 24 h of plant time). Savings depend on the assumptions below."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Energy per unit produced" icon={<Zap className="h-4 w-4" />} value={`${fmtNum(stats.output > 0 ? stats.kwh / stats.output : 0, 3)} kWh`} sub={`${fmtInt(stats.kwh)} kWh for ${fmtInt(stats.output)} packaged units`} />
        <StatTile
          label="Idle-machine energy"
          icon={<BatteryWarning className="h-4 w-4" />}
          tone={stats.idle / Math.max(1, stats.kwh) > 0.05 ? "warning" : "healthy"}
          value={`${fmtInt(stats.idle)} kWh`}
          sub={`${fmtPct(stats.idle / Math.max(1, stats.kwh))} of total · ${fmtMoney(stats.idle * price)} at $${price.toFixed(2)}/kWh`}
        />
        <StatTile
          label="Scrap & defects"
          icon={<Recycle className="h-4 w-4" />}
          tone={stats.excessScrap > 20 ? "warning" : "healthy"}
          value={`${fmtInt(stats.scrap)} units`}
          sub={`${fmtInt(stats.excessScrap)} above line baseline rates · ≈${fmtMoney(stats.scrap * stats.avgMaterial)} material`}
        />
        <StatTile
          label="Estimated avoidable waste"
          icon={<Leaf className="h-4 w-4" />}
          tone="healthy"
          value={`${fmtInt(stats.avoidableIdle)} kWh`}
          sub={`+ ${fmtInt(stats.excessScrap)} excess scrap units / 24 h`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Energy intensity by line" description="kWh per good unit, last 24 h" icon={<Factory className="h-4 w-4" />} />
          <CardBody>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.byLine.map((x) => ({ name: x.line.name.replace("Assembly ", "").replace("Packaging ", "Pkg "), value: Number(x.intensity.toFixed(3)), id: x.line.id }))} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => Number(v).toFixed(2)} />
                  <Tooltip content={<ChartTooltip valueFormatter={(v) => `${v.toFixed(3)} kWh/unit`} />} />
                  <Bar dataKey="value" name="kWh per unit" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
                    {stats.byLine.map((x) => (
                      <Cell key={x.line.id} fill={lineColor(state, x.line.id)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Energy consumption by line" description="kWh per hour, stacked" icon={<Zap className="h-4 w-4" />} />
          <CardBody>
            <EnergyByLineChart state={state} data={data.hourly} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Idle energy & scrap by line" description="Last 24 h — where the waste is" icon={<BatteryWarning className="h-4 w-4" />} />
          <CardBody>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-[11px] text-muted">
                  <th className="py-1.5 text-left font-medium">Line</th>
                  <th className="py-1.5 text-right font-medium">Idle kWh</th>
                  <th className="py-1.5 text-right font-medium">Idle share</th>
                  <th className="py-1.5 text-right font-medium">Scrap</th>
                </tr>
              </thead>
              <tbody>
                {stats.byLine.map((x) => (
                  <tr key={x.line.id} className="border-b border-line/50 last:border-0">
                    <td className="py-2 text-ink-2">
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px]" style={{ background: lineColor(state, x.line.id) }} />
                      {x.line.name}
                    </td>
                    <td className="tabular py-2 text-right text-ink">{fmtNum(x.idle, 1)}</td>
                    <td className="tabular py-2 text-right text-ink-2">{fmtPct(x.idle / Math.max(1, x.kwh))}</td>
                    <td className="tabular py-2 text-right text-ink-2">{fmtInt(x.scrap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11.5px] leading-relaxed text-ink-2">
              Packaging line idle draw comes from waiting on upstream output (starved time). An auto-standby rule could avoid ≈{fmtInt(stats.avoidableIdle)} kWh/day ({fmtMoney(stats.avoidableIdle * price)}/day, ≈
              {fmtNum((stats.avoidableIdle * gridFactor) / 1000, 2)} t CO₂e/day at the stated grid factor).
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader
            title="Scenario-based energy & waste outcomes"
            description={run ? `From ${run.id} (${run.source === "agent" ? "agent analysis" : run.source === "rule" ? "automation rule" : "operator run"}), ${run.results[0]?.definition.params.horizonHours} h horizon` : "Run an analysis or simulation to compare plans"}
            icon={<FlaskConical className="h-4 w-4" />}
            actions={
              <Button size="xs" variant="secondary" asChild>
                <Link href="/simulator">Open simulator</Link>
              </Button>
            }
          />
          <CardBody>
            {!scenarios.length ? (
              <EmptyState title="No scenario run yet" description="Scenario energy and waste comparisons appear here after the agents or the simulator run a comparison." />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line text-[11px] text-muted">
                        <th className="py-1.5 text-left font-medium">Plan</th>
                        <th className="py-1.5 text-right font-medium">Energy</th>
                        <th className="py-1.5 text-right font-medium">Idle energy</th>
                        <th className="py-1.5 text-right font-medium">kWh/unit</th>
                        <th className="py-1.5 text-right font-medium">Scrap units</th>
                        <th className="py-1.5 text-right font-medium">Scrap material</th>
                        <th className="py-1.5 text-right font-medium">Est. CO₂e</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((r) => (
                        <tr key={r.definition.id} className="border-b border-line/50 last:border-0">
                          <td className="py-2 text-ink-2">
                            <span className="mr-1.5 inline-block h-2 w-2 rounded-[2px]" style={{ background: scenarioColor(r.definition.id) }} />
                            {r.definition.name}
                            {r.definition.id === run?.recommendedId && (
                              <Badge tone="healthy" className="ml-1.5">
                                recommended
                              </Badge>
                            )}
                          </td>
                          <td className="tabular py-2 text-right text-ink">{fmtInt(r.metrics.energyKwh)} kWh</td>
                          <td className="tabular py-2 text-right text-ink-2">{fmtInt(r.metrics.idleEnergyKwh)} kWh</td>
                          <td className="tabular py-2 text-right text-ink-2">{fmtNum(r.metrics.energyPerUnit, 3)}</td>
                          <td className="tabular py-2 text-right text-ink-2">{fmtInt(r.metrics.scrapUnits)}</td>
                          <td className="tabular py-2 text-right text-ink-2">{fmtMoney(r.metrics.scrapCost)}</td>
                          <td className="tabular py-2 text-right text-ink-2">{fmtNum((r.metrics.energyKwh * gridFactor) / 1000, 2)} t</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {best && cont && best !== cont && (
                  <div className="mt-3 rounded-xl border border-healthy/30 bg-healthy/5 p-3 text-[12.5px] leading-relaxed text-ink-2">
                    Choosing <span className="font-semibold text-ink">{best.definition.name}</span> instead of continuing unchanged is estimated to avoid{" "}
                    <span className="font-semibold text-ink">{fmtInt(cont.metrics.scrapUnits - best.metrics.scrapUnits)} scrapped units</span> (≈{fmtMoney(cont.metrics.scrapCost - best.metrics.scrapCost)} of components) and{" "}
                    <span className="font-semibold text-ink">{fmtInt(cont.metrics.idleEnergyKwh - best.metrics.idleEnergyKwh)} kWh of idle energy</span>; total energy changes by{" "}
                    {fmtInt(best.metrics.energyKwh - cont.metrics.energyKwh)} kWh because the plan also produces {fmtInt(best.metrics.totalOutput - cont.metrics.totalOutput)} more units.
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Calculation assumptions" icon={<Info className="h-4 w-4" />} />
          <CardBody className="space-y-3 text-[12px]">
            <div>
              <div className="mb-1.5 flex justify-between">
                <span className="text-ink-2">Grid emission factor</span>
                <span className="tabular font-semibold text-ink">{gridFactor.toFixed(2)} kg CO₂e/kWh</span>
              </div>
              <Slider min={0.1} max={1} step={0.01} value={[gridFactor]} onValueChange={([v]) => setGridFactor(v)} aria-label="Grid emission factor" />
              <p className="mt-1 text-[11px] text-muted">Default is an illustrative grid-average value. Replace it with your utility&apos;s published factor.</p>
            </div>
            <KeyValue k="Energy price" v={`$${price.toFixed(2)}/kWh`} />
            <KeyValue k="Standby reduction" v={`${STANDBY_REDUCTION * 100}% of idle draw`} />
            <KeyValue k="Scrap material value" v={`$${stats.avgMaterial.toFixed(0)}/unit avg`} />
            <ul className="space-y-1.5 pt-1 text-[11.5px] leading-relaxed text-muted">
              <li>• Energy is metered per machine: active power scales with speed; idle draw applies while a machine waits; maintenance lock-out draws 0 kW.</li>
              <li>• Degraded machines draw extra power (3.5% of rated kW per mm/s of excess vibration).</li>
              <li>• Excess scrap = scrap above each line&apos;s baseline scrap rate.</li>
              <li>• CO₂e is energy × the grid factor above; Scope 2 only.</li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
