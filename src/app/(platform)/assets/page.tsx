"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search, SlidersHorizontal } from "lucide-react";
import { useFactory, useUi } from "@/client/store";
import { AssetPanel } from "@/components/assets/asset-panel";
import { PageHeader } from "@/components/page";
import { Badge, Card, Input, Meter, Select, Sheet } from "@/components/ui/primitives";
import { RiskBadge, StatusBadge, healthTone } from "@/components/ui/status";
import { KIND_ICON } from "@/components/ui/asset-kind";
import { riskFromStatus } from "@/domain/health";
import { ASSET_KIND_LABEL } from "@/domain/archetypes";
import type { Asset, AssetKind, AssetStatus, RiskLevel } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtInt, fmtPct } from "@/lib/format";

type SortKey = "id" | "health" | "vibration" | "temperature" | "utilization" | "maintenance" | "risk";
const RISK_ORDER: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default function AssetsPage() {
  const state = useFactory((s) => s.state)!;
  const selectAsset = useUi((s) => s.selectAsset);
  const [q, setQ] = useState("");
  const [line, setLine] = useState("all");
  const [status, setStatus] = useState<"all" | AssetStatus>("all");
  const [kind, setKind] = useState<"all" | AssetKind>("all");
  const [risk, setRisk] = useState<"all" | RiskLevel>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "risk", dir: 1 });
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = state.assets.filter((a) => {
      if (line !== "all" && a.lineId !== line) return false;
      if (status !== "all" && a.status !== status) return false;
      if (kind !== "all" && a.kind !== kind) return false;
      if (risk !== "all" && riskFromStatus(a) !== risk) return false;
      if (needle && !`${a.id} ${a.name} ${a.model} ${a.manufacturer}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    const val = (a: Asset): number | string => {
      switch (sort.key) {
        case "id":
          return a.id;
        case "health":
          return a.healthScore;
        case "vibration":
          return a.signal.vibration / a.thresholds.vibrationAlarm;
        case "temperature":
          return a.signal.temperature;
        case "utilization":
          return a.utilization;
        case "maintenance":
          return a.lastMaintenanceHour;
        case "risk":
          return RISK_ORDER[riskFromStatus(a)] * 1000 + a.healthScore;
      }
    };
    return [...filtered].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [state.assets, q, line, status, kind, risk, sort]);

  const open = state.assets.find((a) => a.id === openId) ?? null;
  const header = (key: SortKey, label: string, className?: string) => (
    <th className={cn("py-2.5 pr-3 font-medium", className)}>
      <button
        className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === key && "text-ink")}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === "health" || key === "id" ? 1 : -1 }))}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader title="Asset Management" description={`${state.assets.length} production assets across ${state.lines.length} lines. Values are live from the twin; select a row for telemetry, history, dependencies and configuration.`} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted" />
            <Input className="pl-9" placeholder="Search ID, name, model…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search assets" />
          </div>
          <SlidersHorizontal className="h-4 w-4 text-muted" />
          <Select value={line} onChange={(e) => setLine(e.target.value)} aria-label="Filter by line">
            <option value="all">All lines</option>
            {state.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {(["healthy", "warning", "critical", "offline", "maintenance"] as const).map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Filter by type">
            <option value="all">All types</option>
            {(Object.keys(ASSET_KIND_LABEL) as AssetKind[]).map((k) => (
              <option key={k} value={k}>
                {ASSET_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <Select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)} aria-label="Filter by risk">
            <option value="all">All risk levels</option>
            {(["critical", "high", "medium", "low"] as const).map((r) => (
              <option key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)} risk
              </option>
            ))}
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] text-muted">
                <th className="py-2.5 pr-3 pl-4 font-medium">
                  <button className={cn("inline-flex items-center gap-1 hover:text-ink", sort.key === "id" && "text-ink")} onClick={() => setSort((s) => ({ key: "id", dir: s.key === "id" ? ((-s.dir) as 1 | -1) : 1 }))}>
                    Asset {sort.key === "id" && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </th>
                <th className="py-2.5 pr-3 font-medium">Type</th>
                <th className="py-2.5 pr-3 font-medium">Line</th>
                <th className="py-2.5 pr-3 font-medium">Status</th>
                {header("health", "Health")}
                {header("temperature", "Temp")}
                {header("vibration", "Vibration")}
                {header("utilization", "Utilization")}
                {header("maintenance", "Last maintenance")}
                {header("risk", "Risk")}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const Icon = KIND_ICON[a.kind];
                const vibRatio = a.signal.vibration / a.thresholds.vibrationAlarm;
                const since = state.clock.hour - a.lastMaintenanceHour;
                const overdue = since > a.maintenanceIntervalHours;
                return (
                  <tr
                    key={a.id}
                    onClick={() => {
                      setOpenId(a.id);
                      selectAsset(a.id);
                    }}
                    className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2/70"
                  >
                    <td className="py-2.5 pr-3 pl-4">
                      <div className="flex items-center gap-2.5">
                        <span className="rounded-md border border-line bg-shell p-1.5 text-ink-2">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div>
                          <p className="font-mono text-[12px] text-ink">{a.id}</p>
                          <p className="text-[11.5px] text-muted">{a.name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-2">{ASSET_KIND_LABEL[a.kind]}</td>
                    <td className="py-2.5 pr-3 text-ink-2">{state.lines.find((l) => l.id === a.lineId)?.name.replace("Assembly ", "").replace("Packaging ", "Pkg ")}</td>
                    <td className="py-2.5 pr-3">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="flex w-28 items-center gap-2">
                        <Meter value={a.healthScore} tone={healthTone(a.healthScore)} className="flex-1" />
                        <span className="tabular w-7 text-right font-semibold text-ink">{a.healthScore.toFixed(0)}</span>
                      </div>
                    </td>
                    <td className={cn("tabular py-2.5 pr-3", a.signal.temperature >= a.thresholds.temperatureAlarm ? "text-critical-ink" : "text-ink-2")}>{a.signal.temperature.toFixed(1)} °C</td>
                    <td className={cn("tabular py-2.5 pr-3", vibRatio >= 1 ? "text-critical-ink" : vibRatio >= 0.8 ? "text-warning-ink" : "text-ink-2")}>
                      {a.signal.vibration.toFixed(2)} mm/s
                    </td>
                    <td className="tabular py-2.5 pr-3 text-ink-2">{fmtPct(a.utilization, 0)}</td>
                    <td className="py-2.5 pr-3">
                      <span className="tabular text-ink-2">{since < 48 ? `${fmtInt(since)} h ago` : `${Math.round(since / 24)} d ago`}</span>
                      {overdue && (
                        <Badge tone="warning" className="ml-1.5">
                          overdue
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <RiskBadge risk={riskFromStatus(a)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <p className="p-8 text-center text-[13px] text-muted">No assets match these filters.</p>}
        </div>
      </Card>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)} title={open ? `${open.id} · ${open.name}` : "Asset"} width="max-w-lg">
        {open && <AssetPanel state={state} asset={open} compact />}
      </Sheet>
    </div>
  );
}
