"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Bot, Box, Boxes, Cable, Cctv, ChevronDown, Eye, LayoutGrid, Map as MapIcon, Network, Plus, Radio, RotateCcw, ShieldAlert, Truck, X, FlaskConical, Rotate3d } from "lucide-react";
import Link from "next/link";
import { useForecast } from "@/client/hooks";
import { useFactory, useUi } from "@/client/store";
import { AssetPanel } from "@/components/assets/asset-panel";
import { KeyValue, PageHeader } from "@/components/page";
import { FloorView } from "@/components/twin/floor-view";
import { IsoViewport } from "@/components/iso/iso-viewport";
import { TwinCanvas } from "@/components/twin/twin-canvas";
import { CameraPanel } from "@/components/vision/camera-panel";
import { Badge, Button, Dialog, Input, Label, Select, Tip } from "@/components/ui/primitives";
import { STATUS_META } from "@/components/ui/status";
import { amrPaths } from "@/components/three/amr-paths";
import { isoModelFromState, layoutIso } from "@/components/iso/model";
import { amrFleet, amrUtilisation, METRES_PER_UNIT } from "@/domain/intralogistics";
import { ASSET_KIND_LABEL } from "@/domain/archetypes";
import type { AssetKind, FactoryState } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtInt, fmtRelHours } from "@/lib/format";import { MISSION, ROBOT_TYPE } from "@/components/ui/labels";


// three.js is loaded only when the 3D view is opened.
const Twin3D = dynamic(() => import("@/components/three/twin-3d").then((m) => m.Twin3D), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-[12.5px] text-muted">Loading the 3D view…</div>,
});

export default function TwinPage() {
  return (
    <Suspense>
      <TwinStudio />
    </Suspense>
  );
}

function TwinStudio() {
  const params = useSearchParams();
  const state = useFactory((s) => s.state)!;
  const highlight = useUi((s) => s.highlight);
  const clearHighlight = useUi((s) => s.clearHighlight);
  const selectedId = useUi((s) => s.selectedAssetId);
  const selectAsset = useUi((s) => s.selectAsset);
  const layers = useUi((s) => s.layers);
  const toggleLayer = useUi((s) => s.toggleLayer);
  const view = useUi((s) => s.twinView);
  const setView = useUi((s) => s.setTwinView);
  const resetLayout = useUi((s) => s.resetLayout);
  const [connectMode, setConnectMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const forecast = useForecast(state);

  useEffect(() => {
    const a = params.get("asset");
    if (a && state.assets.some((x) => x.id === a)) {
      selectAsset(a);
      setFocus(a);
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderRisk = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const o of forecast?.result.orders ?? []) out[o.orderId] = o.dueInHorizon && !o.onTime;
    return out;
  }, [forecast]);

  const selectedAsset = state.assets.find((a) => a.id === selectedId) ?? null;
  const selectedCamera = selectedId?.startsWith("cam:") ? (state.cameras.find((c) => `cam:${c.id}` === selectedId) ?? null) : null;
  const selectedOther = selectedId && !selectedAsset && !selectedCamera && (selectedId.startsWith("inv:") || selectedId.startsWith("ord:") || selectedId.startsWith("amr:")) ? selectedId : null;
  const counts = state.assets.reduce<Record<string, number>>((m, a) => ((m[a.status] = (m[a.status] ?? 0) + 1), m), {});

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Digital Twin Studio"
        description="Lines, machines, sensors, materials and customer orders, live. Select anything to inspect it; drag to rearrange."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add asset
            </Button>
            <Tip content="Drag from a node's right edge to another node to record a dependency">
              <Button size="sm" variant={connectMode ? "primary" : "secondary"} onClick={() => setConnectMode(!connectMode)}>
                <Cable className="h-3.5 w-3.5" /> {connectMode ? "Connecting…" : "Connect"}
              </Button>
            </Tip>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-shell p-0.5">
          <button onClick={() => setView("topology")} aria-pressed={view === "topology"} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]", view === "topology" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")}>
            <Network className="h-3.5 w-3.5" /> Topology
          </button>
          <button onClick={() => setView("iso")} aria-pressed={view === "iso"} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]", view === "iso" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")}>
            <Box className="h-3.5 w-3.5" /> Isometric
          </button>
          <button onClick={() => setView("floor")} aria-pressed={view === "floor"} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]", view === "floor" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")}>
            <MapIcon className="h-3.5 w-3.5" /> Floor plan
          </button>
          <button onClick={() => setView("3d")} aria-pressed={view === "3d"} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px]", view === "3d" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")}>
            <Rotate3d className="h-3.5 w-3.5" /> 3D
          </button>
        </div>
        {view === "topology" && (
          <>
            <span className="mx-1 h-5 w-px bg-line" />
            <LayerToggle on={layers.sensors} onClick={() => toggleLayer("sensors")} icon={<Radio className="h-3.5 w-3.5" />} label="Sensors" />
            <LayerToggle on={layers.inventory} onClick={() => toggleLayer("inventory")} icon={<Boxes className="h-3.5 w-3.5" />} label="Inventory" />
            <LayerToggle on={layers.orders} onClick={() => toggleLayer("orders")} icon={<Truck className="h-3.5 w-3.5" />} label="Orders" />
            <LayerToggle on={layers.cameras} onClick={() => toggleLayer("cameras")} icon={<Cctv className="h-3.5 w-3.5" />} label="Cameras" />
            <Button size="xs" variant="ghost" onClick={resetLayout}>
              <RotateCcw className="h-3 w-3" /> Reset layout
            </Button>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11.5px] text-ink-2">
          {(["healthy", "warning", "critical", "offline", "maintenance"] as const).map((s) => {
            const M = STATUS_META[s];
            return (
              <span key={s} className="flex items-center gap-1">
                <M.Icon className="h-3 w-3" style={{ color: M.color }} /> {M.label} <span className="tabular font-semibold text-ink">{counts[s] ?? 0}</span>
              </span>
            );
          })}
        </div>
      </div>

      {highlight && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/8 px-3.5 py-2.5 text-[12.5px]">
          <Eye className="h-4 w-4 text-accent" />
          <span className="text-ink">
            Showing scenario <span className="font-semibold">{highlight.scenarioName}</span> from {highlight.runId}
          </span>
          <span className="text-muted">— {highlight.assetIds.length} assets, {highlight.lineIds.length} lines, {highlight.orderIds.length} orders on the affected path</span>
          <div className="ml-auto flex gap-1.5">
            <Button size="xs" variant="secondary" asChild>
              <Link href="/simulator">
                <FlaskConical className="h-3 w-3" /> Back to simulator
              </Link>
            </Button>
            <Button size="xs" variant="ghost" onClick={clearHighlight}>
              <X className="h-3 w-3" /> Clear
            </Button>
          </div>
        </div>
      )}

      <div className="relative h-[calc(100vh-250px)] min-h-[560px] overflow-hidden rounded-[var(--radius-card)] border border-line bg-deep grid-bg">
        {view === "topology" ? (
          <TwinCanvas
            state={state}
            highlight={highlight}
            connectMode={connectMode}
            focusAssetId={focus}
            orderRisk={orderRisk}
            selectedId={selectedId}
            onSelectNode={(id) => selectAsset(id)}
          />
        ) : view === "iso" ? (
          <IsoViewport state={state} highlight={highlight} selectedId={selectedId} onSelect={(id) => selectAsset(id)} orderRisk={orderRisk} />
        ) : view === "3d" ? (
          <Twin3D state={state} highlight={highlight} selectedId={selectedId} onSelect={(id) => selectAsset(id)} orderRisk={orderRisk} />
        ) : (
          <FloorView state={state} highlight={highlight} selectedId={selectedId} onSelect={(id) => selectAsset(id)} />
        )}
        {connectMode && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-lg border border-agent/50 bg-shell/95 px-3 py-1.5 text-[12px] text-agent-ink shadow-xl">
            Connect mode: drag from a node&apos;s right edge to another node
          </div>
        )}
        {selectedAsset || selectedOther || selectedCamera ? (
          <aside className="absolute inset-y-2 right-2 z-10 w-[min(400px,calc(100%-16px))] overflow-hidden rounded-xl border border-line-strong bg-surface/97 shadow-2xl backdrop-blur animate-fade-in">
            {selectedAsset ? (
              <AssetPanel state={state} asset={selectedAsset} onClose={() => selectAsset(null)} />
            ) : selectedCamera ? (
              <CameraPanel key={selectedCamera.id} state={state} camera={selectedCamera} onClose={() => selectAsset(null)} />
            ) : (
              <OtherNodePanel state={state} id={selectedOther!} onClose={() => selectAsset(null)} />
            )}
          </aside>
        ) : (
          <TwinSummary state={state} onSelect={(id) => selectAsset(id)} />
        )}
      </div>

      <AddAssetDialog open={addOpen} onOpenChange={setAddOpen} state={state} onAdded={(id) => selectAsset(id)} />
    </div>
  );
}

function LayerToggle({ on, onClick, icon, label }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn("flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors", on ? "border-accent/50 bg-accent/12 text-accent-ink" : "border-line text-muted hover:text-ink")}
    >
      {icon} {label}
    </button>
  );
}

function TwinSummary({ state, onSelect }: { state: FactoryState; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ranked = [...state.assets].sort((a, b) => (a.mode === "down" ? -1 : a.healthScore) - (b.mode === "down" ? -1 : b.healthScore)).slice(0, 5);
  return (
    <div className={cn("absolute top-2 right-2 z-10 rounded-xl border border-line-strong bg-shell/92 shadow-xl backdrop-blur", open ? "w-[280px]" : "w-auto")}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left" aria-expanded={open}>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <ShieldAlert className="h-3.5 w-3.5 text-warning" /> Risk watchlist
          <span className="rounded bg-surface-3 px-1.5 text-[10.5px] text-ink-2">{state.assets.filter((a) => a.status !== "healthy").length}</span>
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-line p-1.5">
          {ranked.map((a) => {
            const M = STATUS_META[a.status];
            return (
              <button key={a.id} onClick={() => onSelect(a.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
                <M.Icon className="h-3.5 w-3.5 shrink-0" style={{ color: M.color }} />
                <span className="w-[72px] shrink-0 font-mono text-[11px] text-ink">{a.id}</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{a.name}</span>
                <span className="tabular text-[11.5px] font-semibold text-ink">{a.healthScore.toFixed(0)}</span>
              </button>
            );
          })}
          <p className="px-2 pt-1 pb-0.5 text-[10.5px] text-muted">Select any node to inspect telemetry, history and dependencies.</p>
        </div>
      )}
    </div>
  );
}

function OtherNodePanel({ state, id, onClose }: { state: FactoryState; id: string; onClose: () => void }) {
  const item = id.startsWith("inv:") ? state.inventory.find((i) => `inv:${i.id}` === id) : null;
  const order = id.startsWith("ord:") ? state.orders.find((o) => `ord:${o.id}` === id) : null;
  if (id.startsWith("amr:")) return <AmrPanel state={state} id={id.slice(4)} onClose={onClose} />;
  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="font-mono text-[11.5px] text-muted">{item?.id ?? order?.id}</p>
          <p className="text-[15px] font-semibold text-ink">{item?.name ?? order?.customer}</p>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close panel">
          <X className="h-4 w-4" />
        </button>
      </div>
      {item && (
        <div className="space-y-1">
          <KeyValue k="On hand" v={`${fmtInt(item.onHand)} ${item.unit}`} />
          <KeyValue k="Reorder point" v={fmtInt(item.reorderPoint)} />
          <KeyValue k="Unit cost" v={`$${item.unitCost.toFixed(2)}`} />
          <KeyValue k="Supplier" v={item.supplier} />
          <KeyValue k="Lead time" v={`${item.leadTimeHours} h`} />
          {item.inbound.map((s) => (
            <KeyValue key={s.poId} k={`Inbound ${s.poId}`} v={`${fmtInt(s.qty)} ${fmtRelHours(state, s.etaHour)}${s.expedited ? " · expedited" : ""}`} />
          ))}
          <KeyValue k="Expedite option" v={`$${fmtInt(item.expediteCost)} → h+${item.expediteEtaHours}`} />
        </div>
      )}
      {order && (
        <div className="space-y-1">
          <div className="mb-2 flex gap-1.5">
            <Badge tone={order.priority === "critical" ? "critical" : order.priority === "high" ? "warning" : "neutral"}>{order.priority}</Badge>
            {order.completedHour !== null && <Badge tone="healthy">Delivered</Badge>}
          </div>
          <KeyValue k="Product" v={state.products.find((p) => p.id === order.productId)?.name} />
          <KeyValue k="Quantity" v={fmtInt(order.quantity)} />
          <KeyValue k="Fulfilled" v={fmtInt(order.fulfilled)} />
          <KeyValue k="Due" v={fmtRelHours(state, order.dueHour)} />
          <KeyValue k="Late penalty" v={`$${order.penaltyPerLateUnit}/unit`} />
        </div>
      )}
    </div>
  );
}


/** A mobile robot from the simulated intralogistics layer (from the Twin Builder spec, or the demo's derived fleet). */
function AmrPanel({ state, id, onClose }: { state: FactoryState; id: string; onClose: () => void }) {
  const fleet = useMemo(() => amrFleet(state), [state]);
  const amr = fleet.find((a) => a.id === id);
  const route = useMemo(() => amrPaths(layoutIso(isoModelFromState(state)), fleet, state.lines.map((l) => l.id)).find((p) => p.amr.id === id), [state, fleet, id]);
  if (!amr) return null;
  const util = route ? amrUtilisation(amr, 2 * route.length) : null;
  return (
    <div className="p-4" data-testid="amr-panel">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <span className="rounded-lg border border-line bg-surface-2 p-2 text-ink-2">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <p className="font-mono text-[11.5px] text-muted">{amr.id}</p>
            <p className="text-[15px] font-semibold text-ink">{amr.name}</p>
            <p className="text-[11.5px] text-muted">
              {ROBOT_TYPE[amr.robotType].name} · {amr.fleetName} · {amr.lineName}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close panel">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Badge tone={amr.status === "active" ? "healthy" : "warning"}>{amr.status === "active" ? "On mission" : "Parked"}</Badge>
        <Badge tone="neutral">{amr.fleetName}</Badge>
      </div>
      {amr.reason && <p className="mb-3 rounded-lg border border-warning/40 bg-warning/5 p-2 text-[12px] text-ink-2">{amr.reason}</p>}
      <div className="space-y-1">
        <KeyValue k="Mission" v={MISSION[amr.mission].description} />
        <KeyValue k="From" v={amr.from} />
        <KeyValue k="To" v={amr.to} />
        <KeyValue k="Payload" v={amr.payload} />
        <KeyValue k="Per trip" v={`${amr.unitsPerTrip} units`} />
        <KeyValue k="Line output" v={`${fmtInt(amr.lineRate)} units/h`} />
        <KeyValue k="Trips" v={`${amr.tripsPerHour} per hour`} />
        {route && <KeyValue k="Route" v={`${Math.round(route.length * METRES_PER_UNIT)} m each way`} />}
        <KeyValue k="Speed" v={`${amr.speedMps.toFixed(1)} m/s`} />
        {util !== null && <KeyValue k="Busy" v={`${Math.round(util * 100)}% of the hour`} />}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Trips follow the line&apos;s output{amr.configured ? " and are shared across the fleet" : ""}; the robot parks when its line stops or a part runs out.
      </p>
    </div>
  );
}

function AddAssetDialog({ open, onOpenChange, state, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; state: FactoryState; onAdded: (id: string) => void }) {
  const addAsset = useFactory((s) => s.addAsset);
  const busy = useFactory((s) => s.busy.addAsset);
  const [lineId, setLineId] = useState(state.lines[0]?.id ?? "");
  const [kind, setKind] = useState<AssetKind>("camera");
  const [name, setName] = useState("");
  const line = state.lines.find((l) => l.id === lineId);
  const [position, setPosition] = useState<number>(line?.assetIds.length ?? 0);
  useEffect(() => setPosition(line?.assetIds.length ?? 0), [lineId]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    const id = await addAsset({ lineId, kind, name: name || undefined, position });
    if (id) {
      onOpenChange(false);
      setName("");
      onAdded(id);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add asset to the twin"
      description="The asset joins the line's material flow and starts reporting telemetry."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} loading={busy}>
            <Plus className="h-3.5 w-3.5" /> Add asset
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="add-line">Production line</Label>
            <Select id="add-line" className="w-full" value={lineId} onChange={(e) => setLineId(e.target.value)}>
              {state.lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="add-kind">Asset type</Label>
            <Select id="add-kind" className="w-full" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>
              {(Object.keys(ASSET_KIND_LABEL) as AssetKind[]).map((k) => (
                <option key={k} value={k}>
                  {ASSET_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="add-name">Name (optional)</Label>
          <Input id="add-name" placeholder="e.g. Secondary AOI Camera" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="add-pos">Position in flow</Label>
          <Select id="add-pos" className="w-full" value={position} onChange={(e) => setPosition(Number(e.target.value))}>
            {(line?.assetIds ?? []).map((id, i) => (
              <option key={id} value={i}>
                Before {id}
              </option>
            ))}
            <option value={line?.assetIds.length ?? 0}>At end of line</option>
          </Select>
        </div>
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <LayoutGrid className="h-3.5 w-3.5" /> Nameplate rate defaults to the line&apos;s qualified rate, so throughput is unchanged unless you edit it.
        </p>
      </div>
    </Dialog>
  );
}
