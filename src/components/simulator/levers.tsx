"use client";

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import type { SharedAssumptions } from "@/domain/scenarios";
import type { FactoryState, OrderPriority, ScenarioDefinition, ScenarioParams } from "@/domain/types";
import { SectionLabel } from "../page";
import { Label, Select, Slider, Switch, Tip } from "../ui/primitives";

export function Lever({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  display: ReactNode;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "pointer-events-none opacity-40" : undefined}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[12px] text-ink-2">
          {label}
          {hint && (
            <Tip content={hint}>
              <Info className="h-3 w-3 text-muted" />
            </Tip>
          )}
        </span>
        <span className="tabular text-[12px] font-semibold text-ink">{display}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} aria-label={label} />
    </div>
  );
}

function ToggleRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-[12.5px] font-medium text-ink">
        {label}
        {hint && <span className="block text-[11px] font-normal text-muted">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function PlanLevers({ state, def, onChange }: { state: FactoryState; def: ScenarioDefinition; onChange: (p: ScenarioParams) => void }) {
  const p = def.params;
  const target = state.assets.find((a) => a.id === p.targetAssetId);
  const altLines = state.lines.filter((l) => l.kind === "assembly" && l.id !== target?.lineId);
  if (def.kind === "baseline") {
    return (
      <p className="rounded-lg border border-line bg-shell/60 p-3 text-[12px] leading-relaxed text-muted">
        The reference plan assumes {p.targetAssetId} is healthy. It is the scoring baseline and has no plan levers. Select another scenario to edit it.
      </p>
    );
  }
  const set = (patch: Partial<ScenarioParams>) => onChange({ ...p, ...patch });
  const maintOn = p.maintenanceStartHour !== null;
  return (
    <div className="space-y-4">
      <Lever
        label={`${p.targetAssetId} operating speed`}
        hint="Wear rate scales with speed²; lower speed slows degradation but also throughput. Applies until maintenance completes."
        value={p.targetSpeedPct}
        display={`${p.targetSpeedPct}%`}
        min={50}
        max={110}
        step={5}
        onChange={(v) => set({ targetSpeedPct: v })}
      />
      <div className="space-y-3 rounded-xl border border-line bg-shell/50 p-3">
        <ToggleRow
          label="Preventive maintenance"
          hint="Planned stop that restores condition to baseline"
          checked={maintOn}
          onChange={(v) => set({ maintenanceStartHour: v ? 0.25 : null })}
        />
        <Lever label="Start" value={p.maintenanceStartHour ?? 0} display={`h+${(p.maintenanceStartHour ?? 0).toFixed(2)}`} min={0} max={36} step={0.25} onChange={(v) => set({ maintenanceStartHour: v })} disabled={!maintOn} />
        <Lever label="Duration" value={p.maintenanceDurationHours} display={`${p.maintenanceDurationHours} h`} min={1} max={16} step={0.5} onChange={(v) => set({ maintenanceDurationHours: v })} disabled={!maintOn} />
      </div>
      <div className="space-y-3 rounded-xl border border-line bg-shell/50 p-3">
        <ToggleRow
          label="Reroute production"
          hint="Build the affected line's product on a qualified alternate line"
          checked={p.reroute.enabled}
          onChange={(v) => set({ reroute: { ...p.reroute, enabled: v, toLineId: p.reroute.toLineId ?? altLines[0]?.id ?? null } })}
        />
        <div className={!p.reroute.enabled ? "pointer-events-none space-y-3 opacity-40" : "space-y-3"}>
          <div className="space-y-1">
            <Label htmlFor="reroute-line">Alternate line</Label>
            <Select
              id="reroute-line"
              className="h-8 w-full text-[12.5px]"
              value={p.reroute.toLineId ?? ""}
              onChange={(e) => set({ reroute: { ...p.reroute, toLineId: e.target.value } })}
            >
              {altLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <Lever
            label="Line allocation to rerouted product"
            hint="Share of the alternate line's time given to the rerouted product; the rest stays on its native product."
            value={p.reroute.sharePct}
            display={`${p.reroute.sharePct}%`}
            min={10}
            max={100}
            step={5}
            onChange={(v) => set({ reroute: { ...p.reroute, sharePct: v } })}
          />
          <Lever label="Window start" value={p.reroute.startHour} display={`h+${p.reroute.startHour.toFixed(2)}`} min={0} max={24} step={0.25} onChange={(v) => set({ reroute: { ...p.reroute, startHour: v } })} />
          <Lever label="Window length" value={p.reroute.durationHours} display={`${p.reroute.durationHours.toFixed(2)} h`} min={1} max={24} step={0.25} onChange={(v) => set({ reroute: { ...p.reroute, durationHours: v } })} />
        </div>
      </div>
    </div>
  );
}

export function AssumptionsPanel({
  state,
  shared,
  onChange,
  bindingItemId,
  criticalOrderId,
}: {
  state: FactoryState;
  shared: SharedAssumptions;
  onChange: (s: SharedAssumptions) => void;
  bindingItemId: string | null;
  criticalOrderId: string | null;
}) {
  const item = state.inventory.find((i) => i.id === bindingItemId);
  const order = state.orders.find((o) => o.id === criticalOrderId);
  const avail = bindingItemId ? (shared.inventoryAvailabilityPct[bindingItemId] ?? 100) : 100;
  const ov = criticalOrderId ? shared.orderOverrides[criticalOrderId] : undefined;
  const set = (patch: Partial<SharedAssumptions>) => onChange({ ...shared, ...patch });
  return (
    <div className="space-y-4">
      <SectionLabel>Shared assumptions · apply to every scenario</SectionLabel>
      <Lever label="Planning horizon" value={shared.horizonHours} display={`${shared.horizonHours} h`} min={24} max={72} step={6} onChange={(v) => set({ horizonHours: v })} />
      <Lever
        label="Machine downtime if it trips"
        hint="Unplanned corrective repair duration applied when a machine reaches its trip threshold."
        value={shared.unplannedRepairHours}
        display={`${shared.unplannedRepairHours} h`}
        min={4}
        max={36}
        step={1}
        onChange={(v) => set({ unplannedRepairHours: v })}
      />
      {item && (
        <div className="space-y-3 rounded-xl border border-line bg-shell/50 p-3">
          <Lever
            label={`${item.id} usable stock`}
            hint="Scales recorded on-hand stock, e.g. to model a quality hold or count discrepancy."
            value={avail}
            display={`${avail}% · ${Math.round((item.onHand * avail) / 100).toLocaleString("en-US")}`}
            min={50}
            max={120}
            step={5}
            onChange={(v) => set({ inventoryAvailabilityPct: { ...shared.inventoryAvailabilityPct, [item.id]: v } })}
          />
          <ToggleRow
            label={`Expedite ${item.inbound[0]?.poId ?? "spot buy"}`}
            hint={`$${item.expediteCost.toLocaleString("en-US")} → arrives h+${item.expediteEtaHours}`}
            checked={shared.expediteItemIds.includes(item.id)}
            onChange={(v) => set({ expediteItemIds: v ? [...shared.expediteItemIds, item.id] : shared.expediteItemIds.filter((x) => x !== item.id) })}
          />
        </div>
      )}
      {order && (
        <div className="space-y-3 rounded-xl border border-line bg-shell/50 p-3">
          <Lever
            label={`${order.id} quantity`}
            value={ov?.quantity ?? order.quantity}
            display={(ov?.quantity ?? order.quantity).toLocaleString("en-US")}
            min={Math.max(100, Math.round(order.fulfilled / 100) * 100)}
            max={Math.round(order.quantity * 1.4)}
            step={100}
            onChange={(v) => set({ orderOverrides: { ...shared.orderOverrides, [order.id]: { ...ov, quantity: v } } })}
          />
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ord-pri">{order.id} priority</Label>
            <Select
              id="ord-pri"
              className="h-8 text-[12.5px]"
              value={ov?.priority ?? order.priority}
              onChange={(e) => set({ orderOverrides: { ...shared.orderOverrides, [order.id]: { ...ov, priority: e.target.value as OrderPriority } } })}
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="standard">Standard</option>
            </Select>
          </div>
        </div>
      )}
      <Lever label="Energy price" value={shared.energyPricePerKwh} display={`$${shared.energyPricePerKwh.toFixed(2)}/kWh`} min={0.05} max={0.5} step={0.01} onChange={(v) => set({ energyPricePerKwh: v })} />
      <Lever
        label="Idle power draw"
        hint="Fraction of rated idle power drawn while machines wait. Lower values model auto-standby."
        value={shared.idlePowerFactor}
        display={`${Math.round(shared.idlePowerFactor * 100)}%`}
        min={0.2}
        max={1.2}
        step={0.05}
        onChange={(v) => set({ idlePowerFactor: v })}
      />
    </div>
  );
}
