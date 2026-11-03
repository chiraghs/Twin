"use client";

import { useState } from "react";
import { Bot, Boxes, Cable, Plus, Trash2, Wrench } from "lucide-react";
import type { SpecOp } from "@/domain/builder/ops";
import type { SpecRule, TwinSpec } from "@/domain/builder/spec";
import type { RuleRuntime } from "@/domain/types";
import type { PlaygroundSelection } from "@/client/playground";
import { SectionLabel } from "@/components/page";
import { Badge, Button, Switch } from "@/components/ui/primitives";
import { NumField, SelectField } from "./fields";
import { MISSION, ROBOT_TYPE } from "../ui/labels";

type Kind = SpecRule["kind"];

/** Plain-language summary of a rule, as it will run. */
export function describeRule(spec: TwinSpec, r: SpecRule): string {
  const line = (id: string | null) => spec.lines.find((l) => l.id === id)?.name ?? "?";
  if (r.kind === "inventory") {
    const m = spec.materials.find((x) => x.id === r.materialId);
    return `Order ${r.orderQty != null ? `${r.orderQty.toLocaleString("en-US")} ${m?.unit ?? ""}`.trim() : "about a day's use"} of ${m?.name ?? r.materialId} when stock plus open orders falls below ${r.below != null ? r.below.toLocaleString("en-US") : "its reorder point"}.`;
  }
  if (r.kind === "maintenance") {
    const m = spec.lines.flatMap((l) => l.machines).find((x) => x.id === r.machineId);
    return `${m ? m.name : "Any machine"}: propose preventive maintenance when ${r.metric === "health" ? `health drops below ${r.threshold}` : `vibration rises above ${r.threshold} mm/s`}. A person approves it.`;
  }
  const when = r.when === "upstream-stops" ? "stops" : r.when === "downstream-stops" ? "can't hand over because packing stopped" : `has ${r.bufferUnits ?? 200}+ units waiting before packing`;
  const action = r.action === "divert" ? `${line(r.toLineId)} takes over its work until it restarts` : r.action === "slow" ? `slow it to ${r.speedPct ?? 60}%` : "pause it until that clears";
  return `When ${line(r.lineId)} ${when}: ${action}.`;
}

const SECTIONS: { kind: Kind; title: string; Icon: typeof Cable; empty: string }[] = [
  { kind: "connector", title: "Connector actions", Icon: Cable, empty: "What should happen between lines when one stops or the buffer before packing fills up." },
  { kind: "inventory", title: "Inventory triggers", Icon: Boxes, empty: "Automatic purchase orders when a material runs low." },
  { kind: "maintenance", title: "Maintenance rules", Icon: Wrench, empty: "Propose maintenance when a machine's health or vibration crosses a limit." },
];

export function RulesPanel({ spec, edit, onSelect, runtime }: { spec: TwinSpec; edit: (ops: SpecOp[]) => void; onSelect: (s: PlaygroundSelection) => void; runtime: RuleRuntime | null }) {
  const [adding, setAdding] = useState<Kind | null>(null);
  return (
    <div className="space-y-5" data-testid="pg-rules">
      <p className="text-[12px] leading-relaxed text-muted">Rules run every step, in the live twin and in What-If runs.</p>

      <section>
        <div className="flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-agent-ink" />
          <SectionLabel>Robot movements</SectionLabel>
        </div>
        {spec.mobileRobots.length ? (
          <ul className="mt-1.5 space-y-1.5">
            {spec.mobileRobots.map((f) => (
              <li key={f.id}>
                <button onClick={() => onSelect({ kind: "fleet", id: f.id })} className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-left hover:border-agent/50">
                  <span className="block text-[12.5px] font-medium text-ink">
                    {f.count} × {ROBOT_TYPE[f.robotType].short} · {f.name}
                  </span>
                  <span className="block text-[11.5px] text-muted">
                    {MISSION[f.mission].route} · {f.trigger.kind === "schedule" ? `a trip every ${f.trigger.everyMinutes} min` : "a trip per load of output"} · {f.route.length ? `${f.route.length} waypoints` : "standard route"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[12px] text-muted">No robots yet. Drag a robot from the palette onto a line.</p>
        )}
      </section>

      {SECTIONS.map(({ kind, title, Icon, empty }) => {
        const rules = spec.rules.filter((r) => r.kind === kind);
        return (
          <section key={kind}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-ink-2" />
                <SectionLabel>{title}</SectionLabel>
              </div>
              <Button size="xs" variant="ghost" onClick={() => setAdding(adding === kind ? null : kind)} data-testid={`pg-add-${kind}`}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {!rules.length && adding !== kind && <p className="mt-1 text-[12px] text-muted">{empty}</p>}
            <ul className="mt-1.5 space-y-1.5">
              {rules.map((r) => {
                const rt = runtime?.rules[r.id];
                return (
                  <li key={r.id} className="rounded-lg border border-line bg-surface px-2.5 py-2" data-testid="pg-rule">
                    <div className="flex items-start gap-2">
                      <Switch checked={r.enabled} onCheckedChange={(enabled) => edit([{ op: "update_rule", ruleId: r.id, enabled }])} aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.name}`} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-medium text-ink">{r.name}</p>
                        <p className="text-[11.5px] leading-snug text-muted">{describeRule(spec, r)}</p>
                        {rt && rt.fired > 0 && (
                          <Badge tone={rt.active ? "warning" : "neutral"} className="mt-1">
                            Live: fired {rt.fired}×{rt.active ? " · active now" : ""}
                          </Badge>
                        )}
                      </div>
                      <button onClick={() => edit([{ op: "remove_rule", ruleId: r.id }])} aria-label={`Delete ${r.name}`} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-critical-ink">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {adding === kind && (
              <AddRule
                kind={kind}
                spec={spec}
                onAdd={(op) => {
                  edit([op]);
                  setAdding(null);
                }}
                onCancel={() => setAdding(null)}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

function AddRule({ kind, spec, onAdd, onCancel }: { kind: Kind; spec: TwinSpec; onAdd: (op: SpecOp) => void; onCancel: () => void }) {
  const process = spec.lines.filter((l) => l.role === "process");
  const machines = spec.lines.flatMap((l) => l.machines);
  const [lineId, setLineId] = useState(process[0]?.id ?? "");
  const [when, setWhen] = useState<"upstream-stops" | "downstream-stops" | "buffer-full">(process.length > 1 ? "upstream-stops" : "buffer-full");
  const [action, setAction] = useState<"divert" | "slow" | "pause">(process.length > 1 ? "divert" : "pause");
  const [toLineId, setToLineId] = useState(process.find((l) => l.id !== lineId)?.id ?? "");
  const [speedPct, setSpeedPct] = useState<number | null>(60);
  const [bufferUnits, setBufferUnits] = useState<number | null>(200);
  const [materialId, setMaterialId] = useState(spec.materials[0]?.id ?? "");
  const [below, setBelow] = useState<number | null>(null);
  const [orderQty, setOrderQty] = useState<number | null>(null);
  const [machineId, setMachineId] = useState("");
  const [metric, setMetric] = useState<"health" | "vibration">("health");
  const [threshold, setThreshold] = useState<number | null>(50);

  const pickWhen = (w: typeof when) => {
    setWhen(w);
    setAction(w === "upstream-stops" ? "divert" : w === "buffer-full" ? "pause" : "slow");
  };

  let op: SpecOp | null = null;
  let why = "";
  if (kind === "connector") {
    if (!lineId) why = "Add a process line first.";
    else if (action === "divert" && (!toLineId || toLineId === lineId)) why = "Divert needs a second process line to take over.";
    else op = { op: "add_rule", ruleKind: "connector", lineId, when, action, ...(action === "divert" ? { toLineId } : {}), ...(action === "slow" && speedPct ? { speedPct } : {}), ...(when === "buffer-full" && bufferUnits ? { bufferUnits } : {}) };
  } else if (kind === "inventory") {
    if (!materialId) why = "Add a material first.";
    else op = { op: "add_rule", ruleKind: "inventory", materialId, ...(below != null ? { below } : {}), ...(orderQty ? { orderQty } : {}) };
  } else {
    if (threshold == null) why = "Set a threshold.";
    else op = { op: "add_rule", ruleKind: "maintenance", ...(machineId ? { machineId } : {}), metric, threshold };
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-2.5" data-testid={`pg-form-${kind}`}>
      {kind === "connector" && (
        <>
          <SelectField label="Line" value={lineId} onChange={setLineId}>
            {process.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="When" value={when} onChange={(w) => pickWhen(w as typeof when)}>
            <option value="upstream-stops">The line stops (breakdown or maintenance)</option>
            <option value="downstream-stops">Packing stops</option>
            <option value="buffer-full">The buffer before packing is full</option>
          </SelectField>
          <SelectField label="Then" value={action} onChange={(a) => setAction(a as typeof action)}>
            {when === "upstream-stops" ? (
              <option value="divert">Another line takes over its work</option>
            ) : (
              <>
                <option value="slow">Slow this line down</option>
                <option value="pause">Pause this line</option>
              </>
            )}
          </SelectField>
          {action === "divert" && (
            <SelectField label="Line that takes over" value={toLineId} onChange={setToLineId}>
              <option value="">Choose…</option>
              {process
                .filter((l) => l.id !== lineId)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </SelectField>
          )}
          {action === "slow" && <NumField label="Speed" unit="%" value={speedPct} min={5} max={100} onCommit={setSpeedPct} />}
          {when === "buffer-full" && <NumField label="Full at" unit="units" value={bufferUnits} min={1} onCommit={setBufferUnits} />}
        </>
      )}
      {kind === "inventory" && (
        <>
          <SelectField label="Material" value={materialId} onChange={setMaterialId}>
            {spec.materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-2">
            <NumField label="Reorder below" value={below} placeholder="reorder point" min={0} allowEmpty onCommit={setBelow} />
            <NumField label="Order quantity" value={orderQty} placeholder="a day's use" min={1} allowEmpty onCommit={setOrderQty} />
          </div>
        </>
      )}
      {kind === "maintenance" && (
        <>
          <SelectField label="Machine" value={machineId} onChange={setMachineId}>
            <option value="">Any machine</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </SelectField>
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="Watch"
              value={metric}
              onChange={(m) => {
                setMetric(m as typeof metric);
                setThreshold(m === "health" ? 50 : 7.1);
              }}
            >
              <option value="health">Health below</option>
              <option value="vibration">Vibration above</option>
            </SelectField>
            <NumField label="Limit" unit={metric === "health" ? "/100" : "mm/s"} value={threshold} min={0} max={100} step={metric === "health" ? 1 : 0.1} onCommit={setThreshold} />
          </div>
        </>
      )}
      {why && <p className="text-[11.5px] text-warning-ink">{why}</p>}
      <div className="flex justify-end gap-1.5">
        <Button size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="xs" variant="primary" disabled={!op} onClick={() => op && onAdd(op)} data-testid="pg-save-rule">
          Add rule
        </Button>
      </div>
    </div>
  );
}
