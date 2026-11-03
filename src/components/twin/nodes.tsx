"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Activity, Boxes, Cctv, Gauge, ScanEye, Thermometer, ThermometerSun, Truck, Waves, Wrench, Zap, ScanLine } from "lucide-react";
import type { AssetKind } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtInt } from "@/lib/format";
import { healthBand } from "@/domain/health";
import { KIND_ICON } from "../ui/asset-kind";
import { STATUS_COLOR } from "../ui/labels";
import { STATUS_META } from "../ui/status";
import type { CameraData, InventoryData, LineData, MachineData, OrderData, SensorData } from "./graph";

export { KIND_ICON };

const hidden = "!h-2 !w-2 !min-h-0 !min-w-0 !border-0 !bg-transparent";

function AllHandles() {
  return (
    <>
      <Handle type="target" position={Position.Left} id="l-in" className={hidden} />
      <Handle type="target" position={Position.Top} id="t-in" className={hidden} />
      <Handle type="target" position={Position.Bottom} id="b-in" className={hidden} />
      <Handle type="target" position={Position.Right} id="r-in" className={hidden} />
      <Handle type="source" position={Position.Right} id="r" className="!h-2 !w-2 !border-[1.5px] !border-surface !bg-line-strong opacity-0 transition-opacity group-hover:opacity-100" />
      <Handle type="source" position={Position.Bottom} id="b" className={hidden} />
      <Handle type="source" position={Position.Top} id="t" className={hidden} />
      <Handle type="source" position={Position.Left} id="l" className={hidden} />
    </>
  );
}

export const MachineNode = memo(function MachineNode({ data, selected }: NodeProps<Node<MachineData>>) {
  const a = data.asset;
  const meta = STATUS_META[a.status];
  const Icon = KIND_ICON[a.kind];
  const critical = a.status === "critical" || a.status === "offline";
  const healthColor = STATUS_COLOR[healthBand(a.healthScore)];
  return (
    <div
      className={cn(
        "group relative h-[96px] w-[188px] rounded-xl border bg-surface transition-[opacity,box-shadow,border-color] duration-300",
        data.dimmed && "opacity-35",
        selected ? "border-accent shadow-[0_0_0_3px_rgba(76,141,255,0.25)]" : "border-line-strong",
        a.status === "critical" && !selected && "border-critical/70 shadow-[0_0_0_3px_rgba(239,68,68,0.18),0_0_28px_-6px_rgba(239,68,68,0.55)]",
        a.status === "offline" && "border-offline/70 bg-surface-2 grayscale-[0.4]",
        a.status === "maintenance" && "border-maint/60 shadow-[0_0_0_3px_rgba(129,140,248,0.15)]",
        a.status === "warning" && !selected && "border-warning/50",
        data.role === "target" && "ring-2 ring-accent ring-offset-2 ring-offset-canvas",
        data.role === "reroute" && "ring-2 ring-accent-ink/70 ring-offset-1 ring-offset-canvas",
        data.role === "impacted" && "ring-1 ring-accent-ink/40",
      )}
      title={`${a.id} — ${a.name}`}
    >
      <AllHandles />
      <span className="absolute inset-y-2 left-0 w-[3px] rounded-r" style={{ background: data.lineColor }} />
      {data.roleLabel && (
        <span className="absolute -top-2.5 right-2 rounded-md border border-accent/50 bg-accent-soft px-1.5 py-px text-[9.5px] font-semibold tracking-wide text-accent-ink uppercase">
          {data.roleLabel}
        </span>
      )}
      <div className="flex h-full flex-col px-3 pt-2.5 pb-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 shrink-0 text-ink-2" />
            <span className="truncate font-mono text-[11px] font-medium text-ink">{a.id}</span>
          </div>
          <span className="flex items-center gap-1 text-[10px] font-medium" style={{ color: meta.color }}>
            <span className="relative flex h-1.5 w-1.5">
              {critical && <span className="absolute inset-0 rounded-full animate-pulse-ring" style={{ background: meta.color }} />}
              <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
            </span>
            {meta.label}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] font-medium text-ink-2">{a.name}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${a.healthScore}%`, background: healthColor }} />
          </div>
          <span className="tabular text-[10.5px] font-semibold text-ink">{a.healthScore.toFixed(0)}</span>
        </div>
        <div className="tabular mt-auto flex items-center justify-between text-[10.5px] text-muted">
          {a.mode === "maintenance" ? (
            <span className="flex items-center gap-1 text-maint">
              <Wrench className="h-3 w-3" /> {data.workOrder ?? "Maintenance"}
            </span>
          ) : a.mode === "down" ? (
            <span className="text-offline-ink">Unplanned stop</span>
          ) : (
            <>
              <span className="flex items-center gap-0.5">
                <Waves className="h-3 w-3" />
                {a.signal.vibration.toFixed(1)}
              </span>
              <span className="flex items-center gap-0.5">
                <Thermometer className="h-3 w-3" />
                {a.signal.temperature.toFixed(0)}°
              </span>
              <span className="flex items-center gap-0.5">
                <Gauge className="h-3 w-3" />
                {Math.round(a.signal.throughput)}/h
              </span>
            </>
          )}
          {data.workOrder && a.mode === "running" && <Wrench className="h-3 w-3 text-maint" aria-label="Work order scheduled" />}
        </div>
      </div>
    </div>
  );
});

const LINE_STATE_LABEL: Record<string, { label: string; color: string }> = {
  running: { label: "Running", color: "#10b981" },
  starved: { label: "Waiting for input", color: "#8a94a8" },
  changeover: { label: "Changeover", color: "#4c8dff" },
  maintenance: { label: "Maintenance", color: "#818cf8" },
  down: { label: "Down", color: "#ef4444" },
  idle: { label: "Idle", color: "#8a94a8" },
};

export const LineNode = memo(function LineNode({ data }: NodeProps<Node<LineData>>) {
  const l = data.line;
  const st = LINE_STATE_LABEL[l.state] ?? LINE_STATE_LABEL.idle;
  const product = Object.entries(l.allocation)
    .filter(([, s]) => s > 0)
    .map(([p, s]) => (l.kind === "packaging" ? p : `${p}${s < 1 ? ` ${Math.round(s * 100)}%` : ""}`))
    .join(" · ");
  return (
    <div
      className={cn(
        "h-full w-full rounded-2xl border bg-deep/80 transition-opacity duration-300",
        data.dimmed ? "border-line opacity-50" : "border-line-strong",
        data.role === "reroute" && "border-accent-ink/60 bg-accent-soft/80",
        data.role === "impacted" && "border-accent-ink/35",
      )}
    >
      <div className="flex h-10 items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: data.color }} />
          <span className="truncate text-[12.5px] font-semibold text-ink">{data.vertical ? l.name.replace("Packaging ", "Pkg ") : l.name}</span>
          {!data.vertical && <span className="truncate text-[11px] text-muted">{product}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          {data.roleLabel && <span className="rounded border border-accent/50 bg-accent-soft px-1.5 text-[9.5px] font-semibold tracking-wide text-accent-ink uppercase">{data.roleLabel}</span>}
          {!data.vertical && <span className="tabular text-ink-2">{fmtInt(data.throughput)} u/h</span>}
          <span className="flex items-center gap-1" style={{ color: st.color }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
            {st.label}
          </span>
        </div>
      </div>
    </div>
  );
});

export const InventoryNode = memo(function InventoryNode({ data, selected }: NodeProps<Node<InventoryData>>) {
  const i = data.item;
  const cover = data.coverageHours;
  const low = i.onHand < i.reorderPoint || cover < 24;
  return (
    <div
      className={cn(
        "group relative w-[200px] rounded-xl border bg-surface px-3 py-2 transition-opacity duration-300",
        data.dimmed && "opacity-35",
        selected ? "border-accent" : low ? "border-warning/50" : "border-line-strong",
        data.role === "supply" && "ring-2 ring-accent-ink/60",
      )}
    >
      <Handle type="source" position={Position.Right} id="r" className="!h-2 !w-2 !border-[1.5px] !border-surface !bg-line-strong opacity-0 group-hover:opacity-100" />
      <Handle type="target" position={Position.Left} id="l-in" className={hidden} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-ink">
          <Boxes className="h-3.5 w-3.5 text-ink-2" /> {i.id}
        </span>
        <span className={cn("tabular text-[10.5px]", low ? "text-warning" : "text-muted")}>{Number.isFinite(cover) ? `${cover.toFixed(0)} h cover` : "—"}</span>
      </div>
      <p className="mt-0.5 truncate text-[11.5px] text-ink-2">{i.name}</p>
      <p className="tabular mt-0.5 text-[10.5px] text-muted">
        {fmtInt(i.onHand)} on hand · ROP {fmtInt(i.reorderPoint)}
      </p>
    </div>
  );
});

export const OrderNode = memo(function OrderNode({ data, selected }: NodeProps<Node<OrderData>>) {
  const o = data.order;
  const pct = (o.fulfilled / o.quantity) * 100;
  const done = o.completedHour !== null;
  return (
    <div
      className={cn(
        "group relative w-[196px] rounded-xl border bg-surface px-3 py-2 transition-opacity duration-300",
        data.dimmed && "opacity-35",
        selected ? "border-accent" : data.atRisk ? "border-critical/60" : "border-line-strong",
        data.role === "order" && "ring-2 ring-accent-ink/60",
      )}
    >
      <Handle type="target" position={Position.Left} id="l-in" className={hidden} />
      <Handle type="target" position={Position.Top} id="t-in" className={hidden} />
      <Handle type="source" position={Position.Right} id="r" className={hidden} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium text-ink">
          <Truck className="h-3.5 w-3.5 text-ink-2" /> {o.id}
        </span>
        <span className={cn("text-[10px] font-semibold uppercase", o.priority === "critical" ? "text-critical-ink" : o.priority === "high" ? "text-warning-ink" : "text-muted")}>{o.priority}</span>
      </div>
      <p className="mt-0.5 truncate text-[11.5px] text-ink-2">{o.customer}</p>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
        <div className={cn("h-full rounded-full", done ? "bg-healthy" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>
      <p className="tabular mt-1 flex justify-between text-[10.5px] text-muted">
        <span>
          {fmtInt(o.fulfilled)}/{fmtInt(o.quantity)}
        </span>
        <span className={data.atRisk ? "text-critical-ink" : undefined}>{done ? "Delivered" : data.hoursToDue > 0 ? `due in ${data.hoursToDue.toFixed(0)} h` : "overdue"}</span>
      </p>
    </div>
  );
});

const SENSOR_ICON = { vibration: Activity, temperature: Thermometer, power: Zap, counter: Gauge, vision: ScanLine } as const;

export const SensorNode = memo(function SensorNode({ data }: NodeProps<Node<SensorData>>) {
  const Icon = SENSOR_ICON[data.sensor.kind];
  return (
    <div
      className={cn("flex h-[26px] w-[42px] items-center justify-center gap-0.5 rounded-md border border-line-strong bg-shell text-[9px] text-ink-2", data.dimmed && "opacity-35")}
      title={`${data.sensor.model} · ${data.sensor.kind} · ${data.sensor.sampleRateHz} Hz`}
    >
      <Handle type="source" position={Position.Top} id="t" className={hidden} />
      <Handle type="source" position={Position.Left} id="l" className={hidden} />
      <Icon className="h-2.5 w-2.5 text-agent" />
      <span className="tabular truncate">{data.value}</span>
    </div>
  );
});

const CAMERA_ICON = { area: Cctv, inspection: ScanEye, thermal: ThermometerSun, dock: Truck } as const;

export const CameraNode = memo(function CameraNode({ data, selected }: NodeProps<Node<CameraData>>) {
  const Icon = CAMERA_ICON[data.camera.kind];
  return (
    <div
      className={cn(
        "flex h-6 w-[132px] cursor-pointer items-center gap-1.5 rounded-full border bg-shell px-2 text-[10.5px] shadow-sm transition-colors",
        selected ? "border-accent ring-2 ring-accent/30" : data.alert ? "border-critical/60" : "border-line-strong hover:border-accent/50",
        data.dimmed && !selected && "opacity-60",
      )}
      title={`${data.camera.name} — ${data.headline}`}
    >
      <Handle type="source" position={Position.Bottom} id="b" className={hidden} />
      <Handle type="source" position={Position.Left} id="l" className={hidden} />
      <Icon className={cn("h-3 w-3 shrink-0", data.alert ? "text-critical" : "text-accent")} />
      <span className="truncate font-mono text-ink">{data.camera.id}</span>
      <span className={cn("ml-auto h-1.5 w-1.5 shrink-0 rounded-full", data.alert ? "bg-critical animate-pulse" : "bg-healthy")} />
    </div>
  );
});

export const nodeTypes = { machine: MachineNode, line: LineNode, inventory: InventoryNode, order: OrderNode, sensor: SensorNode, camera: CameraNode };
