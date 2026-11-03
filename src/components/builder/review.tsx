"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowDown, ArrowUp, Bot, Factory, Hammer, Info, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useBuilder } from "@/client/builder";
import { provenanceCounts } from "@/domain/builder/compile";
import { ROBOT_MISSIONS, ROBOT_TYPES, type SpecLine, type TwinSpec } from "@/domain/builder/spec";
import type { LineSummary } from "@/domain/builder/validate";
import type { AssetKind } from "@/domain/types";
import { cn } from "@/lib/cn";
import { fmtInt } from "@/lib/format";
import { IsoScene } from "../iso/iso-scene";
import { isoModelFromSpec, type IsoMachine } from "../iso/model";
import { KIND_ICON } from "../ui/asset-kind";
import { Badge, Button, Card, CardBody, CardHeader, Input, Select, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/primitives";
import { AgentPanel, BlueprintPanel, ChecksPanel, ConnectionsPanel, ProductsPanel, SourcesPanel } from "./panels";
import { AgentStages } from "./progress";
import { ProvBadge, ProvLegend } from "./prov";import { SERIES } from "../charts/kit";
import { MISSION, ROBOT_TYPE } from "../ui/labels";


export function ReviewWorkspace() {
  const router = useRouter();
  const spec = useBuilder((s) => s.spec)!;
  const validation = useBuilder((s) => s.validation);
  const meta = useBuilder((s) => s.meta);
  const edit = useBuilder((s) => s.edit);
  const build = useBuilder((s) => s.build);
  const restart = useBuilder((s) => s.restart);
  const busy = useBuilder((s) => s.busy.build);
  const mode = useBuilder((s) => s.mode);
  const reading = useBuilder((s) => s.reading);
  const [selected, setSelected] = useState<string | null>(null);
  const summaries = useMemo(() => new Map((validation?.lines ?? []).map((l) => [l.id, l])), [validation]);
  const rates = useMemo(() => Object.fromEntries((validation?.lines ?? []).flatMap((l) => Object.entries(l.machineRates).map(([id, r]) => [id, r.rate]))), [validation]);
  const model = useMemo(() => isoModelFromSpec(spec, rates), [spec, rates]);
  const counts = useMemo(() => provenanceCounts(spec), [spec]);
  const errors = validation?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = validation?.issues.filter((i) => i.level === "warning") ?? [];
  const open = spec.questions.filter((q) => !q.answer).length;

  const onBuild = async () => {
    if (await build()) router.push("/twin");
  };

  return (
    <div className="space-y-4" data-testid="builder-review">
      <AgentStages compact />

      <Card>
        <CardBody className="flex flex-col gap-3 pt-4 lg:flex-row lg:items-center">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
            <Input aria-label="Factory name" defaultValue={spec.site.name} key={`n-${spec.site.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== spec.site.name && edit([{ op: "update_site", name: e.target.value }])} />
            <Input aria-label="Industry" defaultValue={spec.site.industry} key={`i-${spec.site.industry}`} onBlur={(e) => e.target.value.trim() && e.target.value !== spec.site.industry && edit([{ op: "update_site", industry: e.target.value }])} />
            <Input aria-label="Location" defaultValue={spec.site.location} key={`l-${spec.site.location}`} placeholder="Location" onBlur={(e) => e.target.value !== spec.site.location && edit([{ op: "update_site", location: e.target.value }])} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={restart}>
              <RotateCcw className="h-3.5 w-3.5" /> Start over
            </Button>
            <Button variant="primary" size="md" loading={busy} disabled={!validation?.ok} onClick={onBuild} data-testid="builder-build">
              <Factory className="h-4 w-4" /> Build my digital twin
            </Button>
          </div>
        </CardBody>
        <CardBody className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12px]">
          <span className="text-muted">Where each element came from:</span>
          <ProvLegend counts={counts} />
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            {mode === "template" && <Badge tone="warning">Drafted from a template</Badge>}
            {errors.length ? <Badge tone="critical">{errors.length} error(s) to fix</Badge> : <Badge tone="healthy">Ready to build</Badge>}
            {warnings.length > 0 && <Badge tone="warning">{warnings.length} warning(s)</Badge>}
            {open > 0 && <Badge tone="agent">{open} open question(s)</Badge>}
          </span>
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Layout preview" description="Rendered from the spec as you edit it. Click a machine to find it below." />
            <div className="h-[340px] overflow-hidden rounded-b-[var(--radius-card)] bg-deep grid-bg">
              <IsoScene model={model} labels="all" labelFor={previewLabel} selectedId={selected} onSelect={(id) => setSelected(id)} className="h-full w-full p-4" title="Preview of the drafted twin" />
            </div>
          </Card>
          {spec.lines.map((l, i) => (
            <LineEditor key={l.id} spec={spec} line={l} index={i} summary={summaries.get(l.id)} selected={selected} onSelect={setSelected} archetypes={meta?.archetypes ?? []} />
          ))}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => edit([{ op: "add_line", role: "process", name: `Line ${spec.lines.filter((l) => l.role === "process").length + 1}`, archetype: "conveyor", text: "Infeed conveyor" }])}>
              <Plus className="h-3.5 w-3.5" /> Add process line
            </Button>
            {!spec.lines.some((l) => l.role === "packing") && (
              <Button size="sm" variant="secondary" onClick={() => edit([{ op: "add_line", role: "packing", name: "Packing", archetype: "packager", text: "Packaging machine" }])}>
                <Plus className="h-3.5 w-3.5" /> Add packing line
              </Button>
            )}
          </div>
          <RobotsEditor spec={spec} />
          <Card>
            <CardBody className="space-y-3 pt-4">
              <OptionRow
                label="Rehearsal incident"
                help="Start the twin with a developing fault on the first line's most critical machine, so you can try the AI agents and what-if simulator straight away."
                checked={spec.options.rehearsalIncident}
                onChange={(v) => edit([{ op: "set_option", option: "rehearsalIncident", value: v }])}
              />
              <OptionRow
                label="Lines can run each other's products"
                help="Lets the what-if simulator reroute production between process lines (at 80% of the owner line's rate)."
                checked={spec.options.linesInterchangeable}
                onChange={(v) => edit([{ op: "set_option", option: "linesInterchangeable", value: v }])}
              />
            </CardBody>
          </Card>
        </div>

        <Card className="min-w-0 self-start">
          <Tabs defaultValue={open ? "agent" : errors.length || warnings.length ? "checks" : "agent"}>
            <div className="overflow-x-auto px-4 pt-4">
              <TabsList className="[&>button]:px-2">
                <TabsTrigger value="agent">Agent</TabsTrigger>
                {reading && <TabsTrigger value="blueprint">Blueprint</TabsTrigger>}
                <TabsTrigger value="sources">Sources</TabsTrigger>
                <TabsTrigger value="products">Products</TabsTrigger>
                <TabsTrigger value="connections">Connections</TabsTrigger>
                <TabsTrigger value="checks">
                  Checks
                  {errors.length + warnings.length > 0 && <span className="ml-1 rounded bg-warning/20 px-1 text-[10px] text-warning-ink">{errors.length + warnings.length}</span>}
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="p-4">
              <TabsContent value="agent">
                <AgentPanel />
              </TabsContent>
              {reading && (
                <TabsContent value="blueprint">
                  <BlueprintPanel selected={selected} onSelect={setSelected} />
                </TabsContent>
              )}
              <TabsContent value="sources">
                <SourcesPanel />
              </TabsContent>
              <TabsContent value="products">
                <ProductsPanel />
              </TabsContent>
              <TabsContent value="connections">
                <ConnectionsPanel />
              </TabsContent>
              <TabsContent value="checks">
                <ChecksPanel />
              </TabsContent>
            </div>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

const previewLabel = (m: IsoMachine) => ({ title: m.name.length > 20 ? `${m.name.slice(0, 19)}…` : m.name, sub: m.throughput ? `${fmtInt(m.throughput)}/h` : "rate from line" });


/** Mobile robot fleets in the spec: added from the requirements or the blueprint, editable here or by chat. */
function RobotsEditor({ spec }: { spec: TwinSpec }) {
  const edit = useBuilder((s) => s.edit);
  const process = spec.lines.filter((l) => l.role === "process");
  const packing = spec.lines.find((l) => l.role === "packing") ?? null;
  const total = spec.mobileRobots.reduce((n, f) => n + f.count, 0);
  return (
    <Card data-testid="robots-editor">
      <CardHeader
        title={`Mobile robots${total ? ` · ${total}` : ""}`}
        description="AMRs, AGVs, automated forklifts and tuggers that move material. Added when your requirements or drawing mention them; their trips follow line output in the twin."
        icon={<Bot className="h-4 w-4" />}
      />
      <CardBody className="space-y-2">
        {spec.mobileRobots.length === 0 && (
          <p className="text-[12.5px] text-muted">
            None in this plant. Add a fleet below, or ask the agent, for example &ldquo;add 3 AMRs for kitting on {process[0]?.name ?? "line 1"}&rdquo;.
          </p>
        )}
        {spec.mobileRobots.map((f) => (
          <div key={f.id} className="rounded-xl border border-line bg-shell p-2.5" data-testid="robot-fleet">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="h-4 w-4 shrink-0 text-muted" />
              <Input
                aria-label="Fleet name"
                className="h-7 min-w-[160px] flex-1 text-[12.5px]"
                defaultValue={f.name}
                key={`fn-${f.id}-${f.name}`}
                onBlur={(e) => e.target.value.trim() && e.target.value !== f.name && edit([{ op: "update_robot_fleet", fleetId: f.id, name: e.target.value }])}
              />
              <ProvBadge prov={f.prov} spec={spec} />
              <div className="flex items-center rounded-lg border border-line">
                <button aria-label="Fewer robots" className="px-1.5 py-1 text-muted hover:text-ink disabled:opacity-40" disabled={f.count <= 1} onClick={() => edit([{ op: "update_robot_fleet", fleetId: f.id, count: f.count - 1 }])}>
                  <Minus className="h-3 w-3" />
                </button>
                <span className="tabular w-6 text-center text-[12.5px] text-ink" aria-label="Robots in this fleet">
                  {f.count}
                </span>
                <button aria-label="More robots" className="px-1.5 py-1 text-muted hover:text-ink disabled:opacity-40" disabled={f.count >= 12} onClick={() => edit([{ op: "update_robot_fleet", fleetId: f.id, count: f.count + 1 }])}>
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <button className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-critical" aria-label={`Remove ${f.name}`} onClick={() => edit([{ op: "remove_robot_fleet", fleetId: f.id }])}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Select aria-label="Robot type" className="w-full" value={f.robotType} onChange={(e) => edit([{ op: "update_robot_fleet", fleetId: f.id, robotType: e.target.value }])}>
                {ROBOT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ROBOT_TYPE[t].short}
                  </option>
                ))}
              </Select>
              <Select aria-label="Material move" className="w-full" value={f.mission} onChange={(e) => edit([{ op: "update_robot_fleet", fleetId: f.id, mission: e.target.value }])}>
                {ROBOT_MISSIONS.map((m) => (
                  <option key={m} value={m} disabled={m === "line-transfer" && !packing}>
                    {MISSION[m].route}
                  </option>
                ))}
              </Select>
              {f.mission === "finished-goods" ? (
                <span className="flex h-8 items-center px-1 text-[12px] text-muted">From {packing?.name ?? process[process.length - 1]?.name}</span>
              ) : (
                <Select aria-label="Line served" className="w-full" value={f.lineId ?? ""} onChange={(e) => edit([{ op: "update_robot_fleet", fleetId: f.id, lineId: e.target.value }])}>
                  {process.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            {f.prov.note && <p className="mt-1.5 text-[11px] leading-snug text-muted">{f.prov.note}</p>}
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          disabled={!process.length || spec.mobileRobots.length >= 10}
          onClick={() => edit([{ op: "add_robot_fleet", mission: "kitting", robotType: "amr", lineId: process[0]?.id, count: 1 }])}
          data-testid="add-robot-fleet"
        >
          <Plus className="h-3.5 w-3.5" /> Add mobile robots
        </Button>
      </CardBody>
    </Card>
  );
}

function OptionRow({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="text-[11.5px] leading-snug text-muted">{help}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function LineEditor({
  spec,
  line,
  index,
  summary,
  selected,
  onSelect,
  archetypes,
}: {
  spec: TwinSpec;
  line: SpecLine;
  index: number;
  summary: LineSummary | undefined;
  selected: string | null;
  onSelect: (id: string) => void;
  archetypes: { kind: string; name: string; covers: string }[];
}) {
  const edit = useBuilder((s) => s.edit);
  const [newKind, setNewKind] = useState("conveyor");
  const series = SERIES;
  return (
    <Card data-testid="line-editor">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: series[index % series.length] }} />
        <Input className="h-8 w-auto min-w-0 flex-1 font-medium sm:max-w-[240px]" aria-label="Line name" defaultValue={line.name} key={line.name} onBlur={(e) => e.target.value.trim() && e.target.value !== line.name && edit([{ op: "update_line", lineId: line.id, name: e.target.value }])} />
        <Select className="h-8 text-[12.5px]" aria-label="Line role" value={line.role} onChange={(e) => edit([{ op: "update_line", lineId: line.id, role: e.target.value as SpecLine["role"] }])}>
          <option value="process">Process line</option>
          <option value="packing">Packing / end of line</option>
        </Select>
        <ProvBadge prov={line.prov} spec={spec} compact />
        {summary && (
          <span className="text-[11.5px] text-muted">
            plans <span className="tabular font-medium text-ink">{fmtInt(summary.targetRate)}/h</span>
            {summary.bottleneck && summary.bottleneck.rate < summary.targetRate && <span className="text-warning-ink"> · limited by {summary.bottleneck.name}</span>}
          </span>
        )}
        <Button size="icon" variant="ghost" className="ml-auto" aria-label={`Remove ${line.name}`} onClick={() => edit([{ op: "remove_line", lineId: line.id }])}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {line.role === "process" && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 text-[12px]">
          <span className="text-muted">Makes:</span>
          {spec.products.map((p) => {
            const on = line.productIds.includes(p.id);
            return (
              <button
                key={p.id}
                aria-pressed={on}
                onClick={() => edit([{ op: "update_line", lineId: line.id, productIds: on ? line.productIds.filter((x) => x !== p.id) : [...line.productIds, p.id] }])}
                className={cn("rounded-full border px-2 py-0.5", on ? "border-accent/50 bg-accent/12 text-accent-ink" : "border-line text-muted hover:text-ink")}
              >
                {p.name}
              </button>
            );
          })}
        </div>
      )}
      <ol className="divide-y divide-line">
        {line.machines.map((m, i) => {
          const Icon = KIND_ICON[m.archetype];
          const r = summary?.machineRates[m.id];
          return (
            <li key={m.id} className={cn("grid grid-cols-[20px_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 px-4 py-2 sm:grid-cols-[20px_minmax(0,1.4fr)_minmax(0,1fr)_96px_auto_auto]", selected === m.id && "bg-accent/8")} onClick={() => onSelect(m.id)}>
              <Icon className="h-4 w-4 text-muted" />
              <Input className="h-8 text-[12.5px]" aria-label="Machine name" defaultValue={m.name} key={m.name} onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && edit([{ op: "update_machine", machineId: m.id, name: e.target.value }])} />
              <Select className="col-start-2 h-8 text-[12.5px] sm:col-start-auto" aria-label="Machine type" value={m.archetype} onChange={(e) => edit([{ op: "update_machine", machineId: m.id, archetype: e.target.value }])}>
                {archetypes.map((a) => (
                  <option key={a.kind} value={a.kind} title={a.covers}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Input
                className="col-start-2 h-8 text-[12.5px] sm:col-start-auto"
                aria-label="Rate per hour"
                inputMode="decimal"
                defaultValue={m.ratePerHour ?? ""}
                key={`${m.id}-${m.ratePerHour}`}
                placeholder={r ? `auto ${fmtInt(r.rate)}/h` : "auto"}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v && m.ratePerHour !== null) edit([{ op: "update_machine", machineId: m.id, clearRate: true }]);
                  else if (v && Number(v) > 0 && Number(v) !== m.ratePerHour) edit([{ op: "update_machine", machineId: m.id, ratePerHour: Number(v) }]);
                }}
              />
              <span className="col-start-2 sm:col-start-auto">
                <ProvBadge prov={m.prov} spec={spec} />
              </span>
              <span className="col-start-2 flex gap-0.5 sm:col-start-auto">
                <Button size="icon" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => edit([{ op: "move_machine", machineId: m.id, position: i - 1 }])}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Move down" disabled={i === line.machines.length - 1} onClick={() => edit([{ op: "move_machine", machineId: m.id, position: i + 1 }])}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => edit([{ op: "remove_machine", machineId: m.id }])}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        <Select className="h-8 text-[12.5px]" aria-label="New machine type" value={newKind} onChange={(e) => setNewKind(e.target.value)}>
          {archetypes.map((a) => (
            <option key={a.kind} value={a.kind}>
              {a.name}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="secondary" disabled={line.machines.length >= 8} onClick={() => edit([{ op: "add_machine", lineId: line.id, archetype: newKind as AssetKind, name: archetypes.find((a) => a.kind === newKind)?.name }])}>
          <Hammer className="h-3.5 w-3.5" /> Add machine
        </Button>
        <span className="text-[11px] text-muted">
          {line.machines.length >= 8 ? (
            <span className="flex items-center gap-1 text-warning-ink">
              <AlertTriangle className="h-3 w-3" /> 8 machines max per line
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Info className="h-3 w-3" /> Machines run in series in flow order. Leave a rate empty to size it from the line.
            </span>
          )}
        </span>
      </div>
    </Card>
  );
}
