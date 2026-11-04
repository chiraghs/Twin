"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, DollarSign, Hourglass, ShoppingCart } from "lucide-react";
import { proposeFromInsight } from "@/client/intelligence";
import { useFactory } from "@/client/store";
import { AnalyticsShell, fmtHours } from "@/components/analytics/shell";
import { AXIS_TICK, ChartTooltip, GRID, Legend, REFERENCE, SERIES } from "@/components/charts/kit";
import { StatTile } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Meter } from "@/components/ui/primitives";
import type { SupplyInsights, SupplyItemInsight } from "@/domain/intelligence";
import { fmtInt } from "@/lib/format";

type Row = { sim_hour: number; item_id: string; on_hand: number; days_of_supply: number; at_risk: number };

export default function SupplyAnalyticsPage() {
  return (
    <AnalyticsShell<SupplyInsights>
      feature="supply"
      title="Supply chain analytics"
      description="How long each material lasts at the plan's consumption, which line starves first, supplier exposure and recommended purchase orders, from the intelligence backend. Proposing an order creates a pending recommendation in Approvals."
    >
      {(d) => <Body s={d.insights} series={(d.series ?? []) as Row[]} />}
    </AnalyticsShell>
  );
}

function Body({ s, series }: { s: SupplyInsights; series: Row[] }) {
  const firstLine = s.lines.filter((l) => l.runwayHours != null).sort((a, b) => a.runwayHours! - b.runwayHours!)[0];
  const spend = s.suppliers.reduce((t, x) => t + x.dailySpend, 0);
  const orderValue = s.items.reduce((t, i) => t + (i.purchaseOrder?.cost ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Materials at risk" value={s.counts.atRisk} sub={`below reorder point or under ${s.criticalDays} days of supply`} icon={<AlertTriangle className="h-4 w-4" />} tone={s.counts.atRisk ? "warning" : "healthy"} />
        <StatTile label="First line to starve" value={firstLine ? fmtHours(firstLine.runwayHours) : "—"} sub={firstLine ? `${firstLine.name} · ${firstLine.criticalItemId}` : "no consumption"} icon={<Hourglass className="h-4 w-4" />} tone={firstLine && firstLine.runwayHours! < 48 ? "critical" : "neutral"} />
        <StatTile label="Purchase orders recommended" value={s.counts.toOrder} sub={`$${fmtInt(orderValue)} in total`} icon={<ShoppingCart className="h-4 w-4" />} tone={s.counts.toOrder ? "warning" : "healthy"} />
        <StatTile label="Material spend" value={`$${fmtInt(spend)}/day`} sub={`${s.suppliers.length} supplier(s) at the current plan`} icon={<DollarSign className="h-4 w-4" />} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[3fr_2fr]">
        <RunwayChart items={s.items} />
        <LineRunway lines={s.lines} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <StockTrend series={series} items={s.items} />
        <Suppliers s={s} />
      </div>
      <MaterialTable items={s.items} />
    </div>
  );
}

function RunwayChart({ items }: { items: SupplyItemInsight[] }) {
  const data = items.filter((i) => i.runwayHours != null).slice(0, 10).map((i) => ({ id: i.itemId, runway: Math.min(i.runwayHours!, 400), lead: i.leadTimeHours }));
  return (
    <Card>
      <CardHeader title="Runway vs lead time" description="Hours each material lasts (counting inbound that arrives in time) against the supplier's lead time. A runway shorter than the lead time needs an order now." />
      <CardBody>
        {data.length === 0 ? (
          <EmptyState title="No consumption" description="No running line uses these materials." />
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} barGap={2} barCategoryGap={6}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} unit=" h" />
                  <YAxis type="category" dataKey="id" tick={AXIS_TICK} tickLine={false} axisLine={false} width={64} />
                  <Tooltip cursor={{ fill: "var(--color-surface-2)" }} content={<ChartTooltip valueFormatter={(v) => fmtHours(v)} />} />
                  <Bar dataKey="runway" name="Runway" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={12} />
                  <Bar dataKey="lead" name="Lead time" fill={REFERENCE} radius={[0, 4, 4, 0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legend className="mt-2" items={[{ label: "Runway", color: SERIES[0] }, { label: "Lead time", color: REFERENCE }]} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

function LineRunway({ lines }: { lines: SupplyInsights["lines"] }) {
  const max = Math.max(72, ...lines.map((l) => l.runwayHours ?? 0));
  return (
    <Card>
      <CardHeader title="Stock-out countdown by line" description="Hours until each line runs out of its scarcest material." />
      <CardBody className="space-y-3">
        {lines.map((l) => (
          <div key={l.lineId} className="text-[12.5px]">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-ink">{l.name}</span>
              <span className="tabular text-ink-2">
                {fmtHours(l.runwayHours)} {l.criticalItemId && <span className="text-muted">· {l.criticalItemId}</span>}
              </span>
            </div>
            <Meter value={l.runwayHours == null ? 100 : Math.min(100, (l.runwayHours / max) * 100)} tone={l.runwayHours != null && l.runwayHours < 24 ? "critical" : l.runwayHours != null && l.runwayHours < 72 ? "warning" : "healthy"} />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function StockTrend({ series, items }: { series: Row[]; items: SupplyItemInsight[] }) {
  const shown = items.filter((i) => i.atRisk).slice(0, 4);
  const data = useMemo(() => {
    const byHour = new Map<number, Record<string, number>>();
    for (const r of series) {
      if (!shown.some((i) => i.itemId === r.item_id)) continue;
      const row = byHour.get(r.sim_hour) ?? { h: r.sim_hour };
      row[r.item_id] = r.on_hand;
      byHour.set(r.sim_hour, row);
    }
    return [...byHour.values()].sort((a, b) => a.h - b.h);
  }, [series, shown]);
  return (
    <Card>
      <CardHeader title="On-hand stock of at-risk materials" description="Synced history (a point every 15 s). Units differ per material; hover for values." />
      <CardBody>
        {shown.length === 0 ? (
          <EmptyState title="Nothing at risk" description="Every material is above its reorder point." />
        ) : data.length < 2 ? (
          <EmptyState title="Building history" description="Come back in a minute." />
        ) : (
          <>
            <div className="h-60">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ left: 0, right: 16, top: 8 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="h" type="number" domain={["dataMin", "dataMax"]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v) => `h${Number(v).toFixed(1)}`} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => fmtInt(v)} />
                  <Tooltip content={<ChartTooltip labelFormatter={(l) => `Plant hour ${Number(l).toFixed(1)}`} />} />
                  {shown.map((i, k) => (
                    <Line key={i.itemId} dataKey={i.itemId} name={i.itemId} stroke={SERIES[k % SERIES.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legend className="mt-2" items={shown.map((i, k) => ({ label: `${i.itemId} · ${i.name}`, color: SERIES[k % SERIES.length], kind: "line" as const }))} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

function Suppliers({ s }: { s: SupplyInsights }) {
  return (
    <Card>
      <CardHeader title="Supplier exposure" description="Spend per day at the current plan, longest lead time and materials at risk per supplier." />
      <CardBody className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="text-left text-muted">
            <tr>
              {["Supplier", "Materials", "At risk", "Spend / day", "Longest lead time", "Inbound"].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.suppliers.map((x) => (
              <tr key={x.supplier} className="border-t border-line">
                <td className="px-2 py-1.5 text-ink">{x.supplier}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{x.items}</td>
                <td className="px-2 py-1.5">{x.atRisk ? <Badge tone="warning">{x.atRisk}</Badge> : <span className="text-muted">0</span>}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">${fmtInt(x.dailySpend)}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{fmtHours(x.maxLeadTimeHours)}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{fmtInt(x.inboundQty)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

function MaterialTable({ items }: { items: SupplyItemInsight[] }) {
  const toast = useFactory((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  const propose = async (i: SupplyItemInsight) => {
    setBusy(i.itemId);
    try {
      const rec = await proposeFromInsight({ kind: "purchase-order", itemId: i.itemId });
      toast({ tone: "success", title: `${rec.id} proposed`, detail: `${rec.title}. A person approves it in Approvals.` });
    } catch (e) {
      toast({ tone: "error", title: "Could not propose the order", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader title="Materials" description="Shortest runway first. Order quantities cover the lead time plus two days and restore the reorder point." actions={<Link href="/approvals" className="text-[12px] text-accent-ink hover:underline">Open Approvals</Link>} />
      <CardBody className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="text-left text-muted">
            <tr>
              {["Material", "Supplier", "On hand / reorder", "Use / h", "Runway", "Lead time", "Recommended order", ""].map((h) => (
                <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.itemId} className="border-t border-line">
                <td className="px-2 py-1.5"><span className="font-mono text-[11.5px] text-ink">{i.itemId}</span> <span className="text-muted">{i.name}</span></td>
                <td className="px-2 py-1.5 text-ink-2">{i.supplier}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{fmtInt(i.onHand)} / {fmtInt(i.reorderPoint)} {i.atRisk && <Badge tone="warning" className="ml-1">at risk</Badge>}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{i.consumptionPerHour.toFixed(1)}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{fmtHours(i.runwayHours)}</td>
                <td className="tabular px-2 py-1.5 text-ink-2">{fmtHours(i.leadTimeHours)}</td>
                <td className="px-2 py-1.5 text-ink-2">
                  {i.purchaseOrder ? (
                    <span>
                      {fmtInt(i.purchaseOrder.qty)} {i.unit} · ${fmtInt(i.purchaseOrder.cost)} <Badge tone={i.purchaseOrder.urgency === "CRITICAL" ? "critical" : "neutral"}>{i.purchaseOrder.urgency.toLowerCase()}</Badge>
                    </span>
                  ) : i.expediteNeeded ? (
                    <Badge tone="warning">on order, arrives after stock-out: expedite</Badge>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {i.purchaseOrder && (
                    <Button size="sm" variant="secondary" loading={busy === i.itemId} onClick={() => propose(i)}>
                      Propose order
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
