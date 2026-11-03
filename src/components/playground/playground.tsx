"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Box, CircleAlert, Layers, Redo2, RotateCcw, Rocket, Undo2 } from "lucide-react";
import { usePlayground, type PlaygroundSelection } from "@/client/playground";
import { useFactory } from "@/client/store";
import { specFromState } from "@/domain/builder/from-state";
import type { SpecOp } from "@/domain/builder/ops";
import type { TwinSpec } from "@/domain/builder/spec";
import { TEMPLATES } from "@/domain/builder/templates";
import { validateSpec } from "@/domain/builder/validate";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, Dialog, Select, Tabs, TabsContent, TabsList, TabsTrigger, type Tone } from "@/components/ui/primitives";
import { Assistant } from "./assistant";
import { Floor, type PaletteItem } from "./floor";
import { Inspector } from "./inspector";
import { dropTarget, floorModel, KIND_SHORT, pinOps, rotOf, snap } from "./model";
import { Palette } from "./palette";
import { Preview3D } from "./preview-3d";
import { RulesPanel } from "./rules-panel";

const LEVEL_TONE: Record<string, Tone> = { error: "critical", warning: "warning", info: "neutral" };
const idsOf = (spec: TwinSpec) => ({ machines: new Set(spec.lines.flatMap((l) => l.machines.map((m) => m.id))), fleets: new Set(spec.mobileRobots.map((f) => f.id)) });
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function Playground() {
  const router = useRouter();
  // Narrow subscriptions: the page must not re-render on every telemetry tick.
  const liveRules = useFactory((s) => s.state?.ruleRuntime ?? null);
  const spec = usePlayground((s) => s.spec);
  const source = usePlayground((s) => s.source);
  const dirty = usePlayground((s) => s.dirty);
  const canUndo = usePlayground((s) => s.past.length > 0);
  const canRedo = usePlayground((s) => s.future.length > 0);
  const selection = usePlayground((s) => s.selection);
  const applying = usePlayground((s) => s.busy.apply);
  const { load, edit: rawEdit, undo, redo, select, apply } = usePlayground.getState();
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<"floor" | "3d">("floor");
  const [tab, setTab] = useState("inspect");
  const [routeFleet, setRouteFleet] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "apply" } | { kind: "replace"; spec: TwinSpec; source: string }>(null);

  // The draft lives in this browser; start from the live twin the first time.
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const live = useFactory.getState().state;
    if (mounted && live && !usePlayground.getState().spec) load(specFromState(live), `Live twin: ${live.profile.name}`);
  }, [mounted, load]);

  const validation = useMemo(() => (spec ? validateSpec(spec) : null), [spec]);
  const fleetLines = useMemo(() => Object.fromEntries((validation?.spec?.mobileRobots ?? []).map((f) => [f.id, f.lineId])), [validation]);
  const model = useMemo(() => (spec ? floorModel(spec, fleetLines) : null), [spec, fleetLines]);
  const errors = validation?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = validation?.issues.filter((i) => i.level === "warning") ?? [];

  /** Apply edits and select whatever they created. */
  const edit = useCallback(
    (ops: SpecOp[]) => {
      const before = usePlayground.getState().spec;
      const r = rawEdit(ops);
      const after = usePlayground.getState().spec;
      if (before && after && r.applied.length) {
        const a = idsOf(before);
        const b = idsOf(after);
        const m = [...b.machines].find((id) => !a.machines.has(id));
        const f = [...b.fleets].find((id) => !a.fleets.has(id));
        if (m) select({ kind: "machine", id: m });
        else if (f) select({ kind: "fleet", id: f });
      }
      return r;
    },
    [rawEdit, select],
  );

  const onSelect = useCallback(
    (s: PlaygroundSelection) => {
      select(s);
      if (s && s.kind !== "rule") setTab("inspect");
      if (s?.kind !== "fleet") setRouteFleet(null);
    },
    [select],
  );

  const remove = useCallback(() => {
    const s = usePlayground.getState().selection;
    const cur = usePlayground.getState().spec;
    if (!s || !cur) return;
    let ops: SpecOp[] = [];
    if (s.kind === "machine") {
      const line = cur.lines.find((l) => l.machines.some((m) => m.id === s.id));
      ops = line && line.machines.length === 1 ? [{ op: "remove_line", lineId: line.id }] : [{ op: "remove_machine", machineId: s.id }];
    } else if (s.kind === "line") ops = [{ op: "remove_line", lineId: s.id }];
    else if (s.kind === "fleet") ops = [{ op: "remove_robot_fleet", fleetId: s.id }];
    else if (s.kind === "rule") ops = [{ op: "remove_rule", ruleId: s.id }];
    else if (s.kind === "belt") ops = [{ op: "disconnect", machineId: s.id }];
    if (rawEdit(ops).applied.length) {
      select(null);
      setRouteFleet(null);
    }
  }, [rawEdit, select]);

  const rotate = useCallback(() => {
    const s = usePlayground.getState().selection;
    const cur = usePlayground.getState().spec;
    if (s?.kind !== "machine" || !cur || !model) return;
    const pm = model.layout.machines.find((m) => m.m.id === s.id);
    if (!pm) return;
    rawEdit([...pinOps(cur, model.layout, s.id), { op: "place_machine", machineId: s.id, x: snap(pm.x), y: snap(pm.y), rot: (rotOf(pm) + 90) % 360 }]);
  }, [model, rawEdit]);

  // Keyboard: delete, rotate, undo/redo, escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (usePlayground.getState().selection) {
          e.preventDefault();
          remove();
        }
      } else if (e.key === "r" || e.key === "R") rotate();
      else if (e.key === "Escape") {
        if (routeFleet) setRouteFleet(null);
        else select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, remove, rotate, select, routeFleet]);

  const freeLayout = !!spec?.lines.some((l) => l.machines.some((m) => m.pos));

  const onDropItem = useCallback(
    (item: PaletteItem, x: number, y: number) => {
      const cur = usePlayground.getState().spec;
      if (!cur || !model) return;
      const { layout } = model;
      if (item.type === "machine") {
        const t = dropTarget(cur, layout, x, y);
        const name = KIND_SHORT[item.archetype];
        const ref = t ? layout.machines.find((m) => m.lineId === t.lineId) : undefined;
        edit([
          ...pinOps(cur, layout),
          t
            ? { op: "add_machine", lineId: t.lineId, archetype: item.archetype, name, position: t.position, x, y, rot: ref ? rotOf(ref) : 0 }
            : { op: "add_line", role: "process", archetype: item.archetype, text: name, name: `Line ${cur.lines.length + 1}`, x, y, rot: 0 },
        ]);
      } else {
        const bay = layout.bays.find((b) => x >= b.x0 - 1 && x <= b.x1 + 1 && y >= b.y0 - 1 && y <= b.y1 + 1);
        const line = cur.lines.find((l) => l.id === bay?.id);
        const lineId = item.mission === "finished-goods" ? (cur.lines.find((l) => l.role === "packing")?.id ?? null) : line?.role === "process" ? line.id : null;
        edit([{ op: "add_robot_fleet", mission: item.mission, robotType: item.robotType, ...(lineId ? { lineId } : {}), count: 1 }]);
      }
    },
    [edit, model],
  );

  /** Click in the palette: add next to the selection (or to the first process line). */
  const onAdd = useCallback(
    (item: PaletteItem) => {
      const cur = usePlayground.getState().spec;
      const s = usePlayground.getState().selection;
      if (!cur || !model) return;
      const { layout } = model;
      const selLine = s?.kind === "line" ? cur.lines.find((l) => l.id === s.id) : s?.kind === "machine" ? cur.lines.find((l) => l.machines.some((m) => m.id === s.id)) : undefined;
      if (item.type === "fleet") {
        const lineId = item.mission === "finished-goods" ? null : selLine?.role === "process" ? selLine.id : null;
        edit([{ op: "add_robot_fleet", mission: item.mission, robotType: item.robotType, ...(lineId ? { lineId } : {}), count: 1 }]);
        return;
      }
      const line = selLine ?? cur.lines.find((l) => l.role === "process") ?? cur.lines[0];
      const after = s?.kind === "machine" ? line.machines.findIndex((m) => m.id === s.id) : line.machines.length - 1;
      const name = KIND_SHORT[item.archetype];
      const op: SpecOp = { op: "add_machine", lineId: line.id, archetype: item.archetype, name, position: after + 1 };
      if (freeLayout) {
        const ref = layout.machines.find((m) => m.m.id === line.machines[after]?.id);
        if (ref) {
          const r = rotOf(ref);
          const step = 2.7;
          Object.assign(op, { x: snap(ref.x + (r === 0 ? step : r === 180 ? -step : 0)), y: snap(ref.y + (r === 90 ? step : r === 270 ? -step : 0)), rot: r });
        }
        edit([...pinOps(cur, layout), op]);
      } else edit([op]);
    },
    [edit, model, freeLayout],
  );

  const startFrom = (value: string) => {
    if (value === "live") {
      const live = useFactory.getState().state!;
      const next = specFromState(live);
      const label = `Live twin: ${live.profile.name}`;
      if (dirty) setConfirm({ kind: "replace", spec: next, source: label });
      else load(next, label);
      return;
    }
    const t = TEMPLATES.find((x) => x.id === value);
    if (!t) return;
    if (dirty) setConfirm({ kind: "replace", spec: t.spec, source: `Template: ${t.name}` });
    else load(t.spec, `Template: ${t.name}`);
  };

  if (!mounted || !spec || !validation || !model) return <div className="h-[60vh] animate-pulse rounded-xl bg-surface-2/50" />;

  const machines = spec.lines.reduce((n, l) => n + l.machines.length, 0);
  const robots = spec.mobileRobots.reduce((n, f) => n + f.count, 0);

  return (
    <div className="animate-fade-in space-y-3">
      <PageHeader
        title="Playground"
        eyebrow={
          <Badge tone={dirty ? "warning" : "neutral"}>
            {dirty ? "Draft · not applied" : "In sync with its source"} · {source}
          </Badge>
        }
        description="A sandbox copy of the twin. Place and delete machines, wire the flow, add robots and the rules they follow, or ask the AI. The live twin changes only when you apply."
        actions={
          <>
            <Select aria-label="Start from" value="" onChange={(e) => e.target.value && startFrom(e.target.value)} className="h-8 w-44 text-[13px]">
              <option value="">Start from…</option>
              <option value="live">The live twin</option>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  Template: {t.name}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={undo} disabled={!canUndo} aria-label="Undo">
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={redo} disabled={!canRedo} aria-label="Redo">
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="primary" onClick={() => setConfirm({ kind: "apply" })} disabled={!validation.ok} data-testid="pg-apply">
              <Rocket className="h-3.5 w-3.5" /> Apply to twin
            </Button>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-[168px_minmax(0,1fr)_320px]">
        <Card className="max-h-[calc(100vh-190px)] overflow-y-auto p-3 lg:sticky lg:top-3">
          <Palette onAdd={onAdd} />
        </Card>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-lg border border-line bg-surface p-0.5">
              {(
                [
                  ["floor", "Floor plan", Layers],
                  ["3d", "3D preview", Box],
                ] as const
              ).map(([k, label, Icon]) => (
                <button key={k} onClick={() => setView(k)} aria-pressed={view === k} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] ${view === k ? "bg-surface-3 text-ink" : "text-ink-2 hover:text-ink"}`}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-muted">
              <span>
                {spec.lines.length} lines · {machines} machines · {robots} robots · {spec.rules.length} rules
              </span>
              <button onClick={() => setTab("checks")}>
                <Badge tone={errors.length ? "critical" : warnings.length ? "warning" : "healthy"}>{errors.length ? `${errors.length} error(s)` : warnings.length ? `${warnings.length} warning(s)` : "Ready to apply"}</Badge>
              </button>
            </div>
          </div>
          <div className="h-[calc(100vh-240px)] min-h-[440px]">
            {view === "floor" ? (
              <Floor spec={spec} model={model} selection={selection} onSelect={onSelect} edit={(ops) => void rawEdit(ops)} routeFleet={routeFleet} onDropItem={onDropItem} />
            ) : (
              <Preview3D spec={validation.spec ?? spec} ok={validation.ok} />
            )}
          </div>
        </div>

        <Card className="flex max-h-[calc(100vh-190px)] min-h-[440px] flex-col p-3 lg:sticky lg:top-3">
          <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mb-3 grid grid-cols-4">
              <TabsTrigger value="inspect">Inspect</TabsTrigger>
              <TabsTrigger value="rules">Rules</TabsTrigger>
              <TabsTrigger value="ai">AI help</TabsTrigger>
              <TabsTrigger value="checks">Checks</TabsTrigger>
            </TabsList>
            <TabsContent value="inspect" className="min-h-0 flex-1 overflow-y-auto pr-1">
              <Inspector spec={spec} validation={validation} selection={selection} onSelect={onSelect} edit={(ops) => void edit(ops)} remove={remove} rotate={rotate} routeFleet={routeFleet} setRouteFleet={setRouteFleet} />
            </TabsContent>
            <TabsContent value="rules" className="min-h-0 flex-1 overflow-y-auto pr-1">
              <RulesPanel spec={spec} edit={(ops) => void rawEdit(ops)} onSelect={onSelect} runtime={liveRules} />
            </TabsContent>
            <TabsContent value="ai" className="min-h-0 flex-1">
              <Assistant />
            </TabsContent>
            <TabsContent value="checks" className="min-h-0 flex-1 overflow-y-auto pr-1">
              <ul className="space-y-1.5" data-testid="pg-checks">
                {validation.issues.map((i, k) => (
                  <li key={k} className="flex items-start gap-2 text-[12.5px] text-ink-2">
                    <Badge tone={LEVEL_TONE[i.level]} className="mt-0.5 shrink-0">
                      {i.level}
                    </Badge>
                    <span>{i.message}</span>
                  </li>
                ))}
                {!validation.issues.length && <li className="text-[12.5px] text-muted">No issues.</li>}
              </ul>
            </TabsContent>
          </Tabs>
        </Card>
      </div>

      <Dialog
        open={confirm?.kind === "apply"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Apply the playground to the live twin?"
        description={`This rebuilds "${spec.site.name}" from the playground: ${spec.lines.length} lines, ${machines} machines, ${robots} robots and ${spec.rules.length} rules. The current twin's telemetry history restarts.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={applying}
              data-testid="pg-apply-confirm"
              onClick={async () => {
                if (await apply()) {
                  setConfirm(null);
                  router.push("/twin");
                }
              }}
            >
              <Rocket className="h-3.5 w-3.5" /> Apply
            </Button>
          </>
        }
      >
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" />
          The demo plant can be restored at any time from the Twin Builder.
        </p>
      </Dialog>

      <Dialog
        open={confirm?.kind === "replace"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Replace the current draft?"
        description="Your playground edits haven't been applied. Starting over discards them."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm?.kind === "replace") load(confirm.spec, confirm.source);
                setConfirm(null);
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Discard and start over
            </Button>
          </>
        }
      />
    </div>
  );
}
