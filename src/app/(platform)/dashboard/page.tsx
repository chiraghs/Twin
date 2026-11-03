"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, Boxes, BrainCircuit, Factory, Gauge, HeartPulse, Network, PackageX, Recycle, Truck, Zap } from "lucide-react";
import { useForecast, useKpis } from "@/client/hooks";
import { useFactory } from "@/client/store";
import { PageHeader, StatTile } from "@/components/page";
import { EnergyByLineChart, OeeTrendChart, ProductionChart } from "@/components/dashboard/charts";
import { IsoMini } from "@/components/iso/iso-card";
import { DeliveryOutlook, EventFeed, HealthDistribution, IncidentBanner, InventoryCoverage, LineStatusList, QuickActions } from "@/components/dashboard/widgets";
import { Badge, Button, Card, CardBody, CardHeader, Meter } from "@/components/ui/primitives";
import { fmtInt, fmtNum, fmtPct } from "@/lib/format";

export default function DashboardPage() {
  const router = useRouter();
  const state = useFactory((s) => s.state)!;
  const analyzing = useFactory((s) => !!s.analysis?.running);
  const analyze = useFactory((s) => s.analyze);
  const data = useKpis(state);
  const forecast = useForecast(state);
  if (!data) return null;
  const { kpis, hourly } = data;
  const incident = state.incidents.find((i) => i.status !== "resolved" && i.severity === "critical") ?? state.incidents.find((i) => i.status !== "resolved");
  const due = forecast?.result.orders.filter((o) => o.dueInHorizon) ?? [];
  const atRisk = due.filter((o) => !o.onTime);
  const orderRisk = Object.fromEntries(due.map((o) => [o.orderId, !o.onTime]));
  const shortages = kpis.inventory.items.filter((i) => i.onHand < i.reorderPoint || i.coverageHours < 24).sort((a, b) => a.coverageHours - b.coverageHours);
  const oeeTone = kpis.oee.oee >= 0.85 ? "healthy" : kpis.oee.oee >= 0.7 ? "warning" : "critical";

  const startAnalysis = () => {
    router.push("/agents");
    void analyze();
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Factory Command Center"
        description={`Live overview of ${state.profile.name}: production, machine health, energy, quality, materials and deliveries in one place.`}
        actions={
          <>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/twin">
                <Network className="h-3.5 w-3.5" /> Open twin
              </Link>
            </Button>
            <Button variant="agent" size="sm" onClick={startAnalysis} loading={analyzing}>
              <BrainCircuit className="h-3.5 w-3.5" /> Run agent analysis
            </Button>
          </>
        }
      />

      {incident && <IncidentBanner state={state} incident={incident} onAnalyze={startAnalysis} analyzing={analyzing} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Overall equipment effectiveness"
          icon={<Gauge className="h-4 w-4" />}
          tone={oeeTone}
          value={fmtPct(kpis.oee.oee)}
          sub={`A ${fmtPct(kpis.oee.availability, 0)} · P ${fmtPct(kpis.oee.performance, 0)} · Q ${fmtPct(kpis.oee.quality, 1)} · assembly, ${kpis.windowHours} h`}
        />
        <StatTile
          label="Output vs target"
          icon={<Factory className="h-4 w-4" />}
          tone={kpis.output.attainment >= 0.95 ? "healthy" : kpis.output.attainment >= 0.85 ? "warning" : "critical"}
          value={
            <span>
              {fmtInt(kpis.output.actual)}
              <span className="text-[14px] font-medium text-muted"> / {fmtInt(kpis.output.target)}</span>
            </span>
          }
          sub={`${fmtPct(kpis.output.attainment, 0)} of plan · packaged units, ${kpis.windowHours} h`}
          footer={<Meter value={kpis.output.attainment * 100} tone={kpis.output.attainment >= 0.95 ? "healthy" : "warning"} />}
        />
        <StatTile
          label="Machine health & risk"
          icon={<HeartPulse className="h-4 w-4" />}
          tone={kpis.health.distribution.critical || kpis.health.distribution.offline ? "critical" : kpis.health.distribution.warning ? "warning" : "healthy"}
          value={fmtNum(kpis.health.average, 1)}
          sub={`${kpis.health.distribution.critical} critical · ${kpis.health.distribution.warning} warning · ${kpis.health.distribution.offline} offline · ${kpis.health.atRisk} high-risk`}
        />
        <StatTile
          label="Energy intensity"
          icon={<Zap className="h-4 w-4" />}
          value={
            <span>
              {fmtNum(kpis.energy.kwhPerUnit, 3)}
              <span className="text-[14px] font-medium text-muted"> kWh/unit</span>
            </span>
          }
          sub={`${fmtInt(kpis.energy.kwh)} kWh in ${kpis.windowHours} h · ${fmtInt(kpis.energy.idleKwh)} kWh idle`}
        />
        <StatTile
          label="Scrap & defect rate"
          icon={<Recycle className="h-4 w-4" />}
          tone={kpis.scrap.rate > 0.04 ? "critical" : kpis.scrap.rate > 0.025 ? "warning" : "healthy"}
          value={fmtPct(kpis.scrap.rate, 2)}
          sub={`${fmtInt(kpis.scrap.units)} units scrapped in ${kpis.windowHours} h`}
        />
        <StatTile
          label="Open incidents"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={kpis.incidents.critical ? "critical" : kpis.incidents.open ? "warning" : "healthy"}
          value={kpis.incidents.open}
          sub={kpis.incidents.open ? `${kpis.incidents.critical} critical · ${state.incidents.filter((i) => i.status === "mitigating").length} mitigating` : "No open incidents"}
        />
        <StatTile
          label="Inventory shortages"
          icon={<PackageX className="h-4 w-4" />}
          tone={shortages.length ? "warning" : "healthy"}
          value={shortages.length}
          sub={shortages.length ? shortages.slice(0, 2).map((s) => `${s.id} · ${Number.isFinite(s.coverageHours) ? `${s.coverageHours.toFixed(0)} h cover` : "below reorder"}`).join(" · ") : "All items above reorder point"}
        />
        <StatTile
          label="On-time delivery risk"
          icon={<Truck className="h-4 w-4" />}
          tone={atRisk.length ? "critical" : "healthy"}
          value={
            <span>
              {atRisk.length}
              <span className="text-[14px] font-medium text-muted"> of {due.length} at risk</span>
            </span>
          }
          sub={
            atRisk.length
              ? `${atRisk.map((o) => `${o.orderId} ${fmtInt(o.lateUnits)} short`).join(" · ")} at current plan`
              : `Orders due in 48 h are on track`
          }
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Production: target vs actual"
            description="Hourly packaged output against the planned rate."
            icon={<Activity className="h-4 w-4" />}
          />
          <CardBody>
            <ProductionChart state={state} data={hourly} />
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1 text-[12px] font-medium text-ink-2">Assembly OEE, hourly</p>
              <OeeTrendChart state={state} data={hourly} />
            </div>
          </CardBody>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="overflow-hidden">
            <CardHeader
              title="Live factory twin"
              description="Isometric view · click a machine to inspect it"
              icon={<Network className="h-4 w-4" />}
              actions={
                <Link href="/twin" className="text-[12px] text-accent hover:underline">
                  Open studio
                </Link>
              }
            />
            <div className="h-72 overflow-hidden border-t border-line bg-deep px-2 py-2">
              <IsoMini state={state} orderRisk={orderRisk} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Production lines" description="Live state, throughput and asset status" icon={<Boxes className="h-4 w-4" />} />
            <CardBody>
              <LineStatusList state={state} />
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader title="Inventory coverage" description="Components and packaging vs next inbound purchase order" icon={<PackageX className="h-4 w-4" />} />
          <CardBody>
            <InventoryCoverage state={state} items={kpis.inventory.items} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Energy by line" description="kWh per hour, stacked" icon={<Zap className="h-4 w-4" />} />
          <CardBody>
            <EnergyByLineChart state={state} data={hourly} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2 xl:col-span-1">
          <CardHeader title="Asset health distribution" description={`${state.assets.length} production assets`} icon={<HeartPulse className="h-4 w-4" />} />
          <CardBody>
            <HealthDistribution state={state} kpis={kpis} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Delivery commitments"
            description="Projected completion of each order if nothing changes."
            icon={<Truck className="h-4 w-4" />}
            actions={forecast?.result.metrics.failureOccurs ? <Badge tone="critical">Trip predicted at h+{forecast.result.metrics.failureHour?.toFixed(1)}</Badge> : null}
          />
          <CardBody>
            <DeliveryOutlook state={state} forecast={forecast?.result ?? null} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Recent operational events"
            actions={
              <Link href="/audit" className="text-[12px] text-accent hover:underline">
                Audit trail
              </Link>
            }
          />
          <CardBody className="max-h-[360px] overflow-y-auto">
            <EventFeed state={state} entries={state.audit.slice(0, 8)} compact />
          </CardBody>
          <div className="border-t border-line p-3">
            <QuickActions />
          </div>
        </Card>
      </div>
    </div>
  );
}
