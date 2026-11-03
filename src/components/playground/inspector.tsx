"use client";

import { ArrowRight, Eraser, MousePointerClick, RotateCw, Route, Scissors, Trash2 } from "lucide-react";
import { ASSET_KINDS } from "@/domain/archetypes";
import type { SpecOp } from "@/domain/builder/ops";
import { ROBOT_MISSIONS, ROBOT_TYPES, type TwinSpec } from "@/domain/builder/spec";
import type { ValidationResult } from "@/domain/builder/validate";
import type { PlaygroundSelection } from "@/client/playground";
import { KeyValue, SectionLabel } from "@/components/page";
import { Badge, Button } from "@/components/ui/primitives";
import { NumField, SelectField, TextField } from "./fields";
import { KIND_SHORT } from "./model";import { MISSION, ROBOT_TYPE } from "../ui/labels";


export function Inspector({
  spec,
  validation,
  selection,
  onSelect,
  edit,
  remove,
  rotate,
  routeFleet,
  setRouteFleet,
}: {
  spec: TwinSpec;
  validation: ValidationResult;
  selection: PlaygroundSelection;
  onSelect: (s: PlaygroundSelection) => void;
  edit: (ops: SpecOp[]) => void;
  remove: () => void;
  rotate: () => void;
  routeFleet: string | null;
  setRouteFleet: (id: string | null) => void;
}) {
  const machines = spec.lines.flatMap((l) => l.machines.map((m, i) => ({ m, line: l, index: i })));

  if (selection?.kind === "machine") {
    const hit = machines.find((x) => x.m.id === selection.id);
    if (!hit) return <Nothing spec={spec} onSelect={onSelect} />;
    const { m, line, index } = hit;
    const next = line.machines[index + 1];
    const rate = validation.lines.find((l) => l.id === line.id)?.machineRates[m.id];
    return (
      <div className="space-y-3" data-testid="pg-inspector">
        <Head title={m.name} sub={`${KIND_SHORT[m.archetype]} · ${line.name}, step ${index + 1} of ${line.machines.length}`} />
        <TextField label="Name" value={m.name} onCommit={(name) => edit([{ op: "update_machine", machineId: m.id, name }])} />
        <SelectField label="Machine type" value={m.archetype} onChange={(archetype) => edit([{ op: "update_machine", machineId: m.id, archetype }])}>
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_SHORT[k]}
            </option>
          ))}
        </SelectField>
        <NumField
          label="Rate"
          unit="/h"
          value={m.ratePerHour}
          placeholder={rate ? `${rate.rate} (derived)` : "derived"}
          min={0.1}
          allowEmpty
          onCommit={(v) => edit([v == null ? { op: "update_machine", machineId: m.id, clearRate: true } : { op: "update_machine", machineId: m.id, ratePerHour: v }])}
        />
        <div>
          <SectionLabel>Flow</SectionLabel>
          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-2">
            {next ? (
              <>
                Feeds <ArrowRight className="h-3 w-3" /> <button className="text-accent-ink hover:underline" onClick={() => onSelect({ kind: "machine", id: next.id })}>{next.name}</button>
              </>
            ) : line.role === "packing" ? (
              "Last step: packed goods go to the dock."
            ) : (
              "End of the line: product goes on to packing."
            )}
          </p>
          <SelectField
            className="mt-2"
            label="Feed into (moves that machine to follow this one)"
            value=""
            onChange={(targetId) => targetId && edit([{ op: "connect", machineId: m.id, targetId }])}
          >
            <option value="">Choose a machine…</option>
            {machines
              .filter((x) => x.m.id !== m.id && x.m.id !== next?.id)
              .map((x) => (
                <option key={x.m.id} value={x.m.id}>
                  {x.m.name} ({x.line.name})
                </option>
              ))}
          </SelectField>
          <p className="mt-1 text-[11px] text-muted">Or drag from the machine&apos;s output port (the dot on its outgoing side) to the next machine.</p>
        </div>
        <div>
          <SectionLabel>Floor</SectionLabel>
          <p className="mt-1 text-[12.5px] text-ink-2">{m.pos ? `x ${m.pos.x}, y ${m.pos.y} · facing ${m.pos.rot}°` : "Automatic layout (drag it to place it by hand)"}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="xs" onClick={rotate}>
            <RotateCw className="h-3.5 w-3.5" /> Rotate 90°
          </Button>
          {next && line.role === "process" && (
            <Button size="xs" onClick={() => edit([{ op: "disconnect", machineId: m.id }])}>
              <Scissors className="h-3.5 w-3.5" /> Split line after
            </Button>
          )}
          <Button size="xs" variant="danger" onClick={remove} data-testid="pg-delete">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>
    );
  }

  if (selection?.kind === "belt") {
    const hit = machines.find((x) => x.m.id === selection.id);
    const next = hit ? hit.line.machines[hit.index + 1] : undefined;
    if (!hit || !next) return <Nothing spec={spec} onSelect={onSelect} />;
    return (
      <div className="space-y-3" data-testid="pg-inspector">
        <Head title="Conveyor" sub={`${hit.m.name} → ${next.name} (${hit.line.name})`} />
        <p className="text-[12.5px] text-ink-2">Machines on a line run in series. Splitting here makes everything after {hit.m.name} a separate line that feeds packing on its own.</p>
        {hit.line.role === "process" ? (
          <Button size="xs" onClick={() => edit([{ op: "disconnect", machineId: hit.m.id }])}>
            <Scissors className="h-3.5 w-3.5" /> Split the line here
          </Button>
        ) : (
          <p className="text-[12px] text-muted">The packing area is a single line; move or delete its machines instead.</p>
        )}
      </div>
    );
  }

  if (selection?.kind === "line") {
    const line = spec.lines.find((l) => l.id === selection.id);
    if (!line) return <Nothing spec={spec} onSelect={onSelect} />;
    const sum = validation.lines.find((l) => l.id === line.id);
    return (
      <div className="space-y-3" data-testid="pg-inspector">
        <Head title={line.name} sub={`${line.role === "packing" ? "Packing line" : "Process line"} · ${line.machines.length} machine(s)${sum ? ` · planned ${sum.targetRate}/h` : ""}`} />
        <TextField label="Name" value={line.name} onCommit={(name) => edit([{ op: "update_line", lineId: line.id, name }])} />
        <SelectField label="Role" value={line.role} onChange={(role) => edit([{ op: "update_line", lineId: line.id, role: role as "process" | "packing" }])}>
          <option value="process">Process line (makes product)</option>
          <option value="packing">Packing / end of line</option>
        </SelectField>
        {line.role === "process" && (
          <div>
            <SectionLabel>Products made here</SectionLabel>
            <div className="mt-1.5 space-y-1">
              {spec.products.map((p) => {
                const on = line.productIds.includes(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-2 text-[12.5px] text-ink">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const ids = on ? line.productIds.filter((x) => x !== p.id) : [...line.productIds, p.id];
                        if (ids.length) edit([{ op: "update_line", lineId: line.id, productIds: ids }]);
                      }}
                    />
                    {p.name}
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <div>
          <SectionLabel>Machines in flow order</SectionLabel>
          <ol className="mt-1 space-y-0.5 text-[12.5px]">
            {line.machines.map((m, i) => (
              <li key={m.id}>
                <button className="text-ink-2 hover:text-accent-ink" onClick={() => onSelect({ kind: "machine", id: m.id })}>
                  {i + 1}. {m.name}
                </button>
              </li>
            ))}
          </ol>
        </div>
        <Button size="xs" variant="danger" onClick={remove} disabled={spec.lines.length <= 1}>
          <Trash2 className="h-3.5 w-3.5" /> Delete line
        </Button>
      </div>
    );
  }

  if (selection?.kind === "fleet") {
    const f = spec.mobileRobots.find((x) => x.id === selection.id);
    if (!f) return <Nothing spec={spec} onSelect={onSelect} />;
    const lines = spec.lines.filter((l) => (f.mission === "finished-goods" ? l.role === "packing" : l.role === "process"));
    const drawing = routeFleet === f.id;
    return (
      <div className="space-y-3" data-testid="pg-inspector">
        <Head title={f.name} sub={`${f.count} × ${ROBOT_TYPE[f.robotType].short} · ${MISSION[f.mission].route}`} />
        <TextField label="Name" value={f.name} onCommit={(name) => edit([{ op: "update_robot_fleet", fleetId: f.id, name }])} />
        <div className="grid grid-cols-2 gap-2">
          <SelectField label="Robot" value={f.robotType} onChange={(robotType) => edit([{ op: "update_robot_fleet", fleetId: f.id, robotType }])}>
            {ROBOT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ROBOT_TYPE[t].short}
              </option>
            ))}
          </SelectField>
          <NumField label="Count" value={f.count} min={1} max={12} step={1} onCommit={(count) => count && edit([{ op: "update_robot_fleet", fleetId: f.id, count: Math.round(count) }])} />
        </div>
        <SelectField label="Move" value={f.mission} onChange={(mission) => edit([{ op: "update_robot_fleet", fleetId: f.id, mission }])}>
          {ROBOT_MISSIONS.map((m) => (
            <option key={m} value={m}>
              {MISSION[m].route}
            </option>
          ))}
        </SelectField>
        {lines.length > 0 && (
          <SelectField label="Serves" value={f.lineId ?? ""} onChange={(lineId) => lineId && edit([{ op: "update_robot_fleet", fleetId: f.id, lineId }])}>
            <option value="">Automatic</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectField>
        )}
        <div>
          <SectionLabel>Movement rule</SectionLabel>
          <SelectField
            className="mt-1"
            label="A trip starts"
            value={f.trigger.kind}
            onChange={(k) => edit([{ op: "update_robot_fleet", fleetId: f.id, triggerKind: k as "output" | "schedule" }])}
          >
            <option value="output">When the line has made a load</option>
            <option value="schedule">On a fixed schedule</option>
          </SelectField>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {f.trigger.kind === "schedule" ? (
              <NumField label="Every" unit="min" value={f.trigger.everyMinutes} min={1} max={1440} onCommit={(v) => v && edit([{ op: "update_robot_fleet", fleetId: f.id, everyMinutes: v }])} />
            ) : (
              <NumField label="Units per trip" value={f.unitsPerTrip} placeholder="default" min={1} onCommit={(v) => v && edit([{ op: "update_robot_fleet", fleetId: f.id, unitsPerTrip: v }])} />
            )}
            <NumField label="Speed" unit="m/s" value={f.speedMps} placeholder="1.0" min={0.2} max={3} step={0.1} onCommit={(v) => v && edit([{ op: "update_robot_fleet", fleetId: f.id, speedMps: v }])} />
          </div>
        </div>
        <div>
          <SectionLabel>Route</SectionLabel>
          <p className="mt-1 text-[12.5px] text-ink-2">{f.route.length ? `${f.route.length} waypoint(s) between pick-up and drop-off.` : "Standard aisle route."}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button size="xs" variant={drawing ? "agent" : "secondary"} onClick={() => setRouteFleet(drawing ? null : f.id)}>
              {drawing ? <MousePointerClick className="h-3.5 w-3.5" /> : <Route className="h-3.5 w-3.5" />} {drawing ? "Done drawing" : "Draw route"}
            </Button>
            {f.route.length > 0 && (
              <>
                <Button size="xs" onClick={() => edit([{ op: "set_robot_route", fleetId: f.id, route: f.route.slice(0, -1) }])}>
                  Undo point
                </Button>
                <Button size="xs" onClick={() => edit([{ op: "set_robot_route", fleetId: f.id, route: [] }])}>
                  <Eraser className="h-3.5 w-3.5" /> Clear
                </Button>
              </>
            )}
          </div>
        </div>
        <Button size="xs" variant="danger" onClick={remove}>
          <Trash2 className="h-3.5 w-3.5" /> Delete fleet
        </Button>
      </div>
    );
  }

  return <Nothing spec={spec} onSelect={onSelect} />;
}

function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 text-[12px] text-muted">{sub}</p>
    </div>
  );
}

function Nothing({ spec, onSelect }: { spec: TwinSpec; onSelect: (s: PlaygroundSelection) => void }) {
  const machines = spec.lines.reduce((n, l) => n + l.machines.length, 0);
  const robots = spec.mobileRobots.reduce((n, f) => n + f.count, 0);
  return (
    <div className="space-y-3" data-testid="pg-inspector">
      <Head title={spec.site.name} sub="Select something on the floor to edit it." />
      <div>
        <KeyValue k="Lines" v={spec.lines.length} />
        <KeyValue k="Machines" v={machines} />
        <KeyValue k="Mobile robots" v={robots} />
        <KeyValue k="Rules" v={spec.rules.length} />
      </div>
      <div>
        <SectionLabel>Lines</SectionLabel>
        <div className="mt-1 flex flex-wrap gap-1">
          {spec.lines.map((l) => (
            <button key={l.id} onClick={() => onSelect({ kind: "line", id: l.id })}>
              <Badge tone={l.role === "packing" ? "maint" : "accent"}>{l.name}</Badge>
            </button>
          ))}
        </div>
      </div>
      {spec.mobileRobots.length > 0 && (
        <div>
          <SectionLabel>Robot fleets</SectionLabel>
          <div className="mt-1 flex flex-wrap gap-1">
            {spec.mobileRobots.map((f) => (
              <button key={f.id} onClick={() => onSelect({ kind: "fleet", id: f.id })}>
                <Badge tone="agent">
                  {f.count} × {f.name}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}
      <ul className="space-y-1 text-[12px] leading-relaxed text-muted">
        <li>• Drag machines from the palette onto the floor; drag them to move.</li>
        <li>• Drag from a machine&apos;s output port to the machine it should feed.</li>
        <li>• Delete or Backspace removes the selection; R rotates; Ctrl/⌘ Z undoes.</li>
      </ul>
    </div>
  );
}
