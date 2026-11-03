/**
 * Edit operations on a TwinSpec. The agent's chat refinements and the review screen's manual edits
 * both go through these, so every change is explicit, validated and attributable.
 */
import { z } from "zod";
import { ASSET_KINDS } from "../archetypes";
import type { AssetKind } from "../types";
import { INTEGRATION_KINDS, ROBOT_MISSIONS, ROBOT_TYPES, RULE_KINDS, uniqueId, type Prov, type SpecRobotFleet, type SpecRule, type TwinSpec } from "./spec";

const ROBOT_LABEL: Record<SpecRobotFleet["robotType"], string> = { amr: "AMR", agv: "AGV", "forklift-agv": "Automated forklift", tugger: "Tugger" };
const MISSION_LABEL: Record<SpecRobotFleet["mission"], string> = { kitting: "kitting", "line-transfer": "line transfer", "finished-goods": "finished goods" };

const s = (max = 80) => z.string().trim().max(max);
const opt = <T extends z.ZodTypeAny>(t: T) => t.nullish();

export const SpecOpSchema = z.object({
  op: z.enum([
    "add_machine",
    "update_machine",
    "remove_machine",
    "move_machine",
    "add_line",
    "update_line",
    "remove_line",
    "add_product",
    "update_product",
    "remove_product",
    "add_material",
    "update_material",
    "add_integration",
    "remove_integration",
    "update_site",
    "answer_question",
    "add_assumption",
    "set_option",
    "add_robot_fleet",
    "update_robot_fleet",
    "remove_robot_fleet",
    "set_robot_route",
    "place_machine",
    "connect",
    "disconnect",
    "add_rule",
    "update_rule",
    "remove_rule",
  ]),
  lineId: opt(s(40)),
  machineId: opt(s(40)),
  productId: opt(s(40)),
  materialId: opt(s(40)),
  integrationId: opt(s(40)),
  questionId: opt(s(40)),
  fleetId: opt(s(40)),
  robotType: opt(s(20)),
  mission: opt(s(20)),
  count: opt(z.number().int().min(1).max(50)),
  unitsPerTrip: opt(z.number().finite().positive().max(100000)),
  speedMps: opt(z.number().finite().positive().max(3)),
  /** Floor position (layout units) and rotation in degrees. */
  x: opt(z.number().finite().min(-200).max(200)),
  y: opt(z.number().finite().min(-200).max(200)),
  rot: opt(z.number().finite()),
  /** connect: the machine that should come next in the flow. */
  targetId: opt(s(40)),
  route: opt(z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).max(12)),
  triggerKind: opt(z.enum(["output", "schedule"])),
  everyMinutes: opt(z.number().finite().min(1).max(1440)),
  ruleId: opt(s(40)),
  ruleKind: opt(z.enum(RULE_KINDS)),
  enabled: opt(z.boolean()),
  below: opt(z.number().finite().min(0)),
  orderQty: opt(z.number().finite().positive()),
  metric: opt(z.enum(["health", "vibration"])),
  threshold: opt(z.number().finite().min(0).max(100)),
  when: opt(z.enum(["upstream-stops", "downstream-stops", "buffer-full"])),
  action: opt(z.enum(["divert", "slow", "pause"])),
  toLineId: opt(s(40)),
  speedPct: opt(z.number().finite().min(5).max(100)),
  bufferUnits: opt(z.number().finite().positive()),
  position: opt(z.number().int().min(0).max(20)),
  name: opt(s()),
  archetype: opt(s(20)),
  ratePerHour: opt(z.number().finite().positive().max(200000)),
  clearRate: opt(z.boolean()),
  role: opt(z.enum(["process", "packing"])),
  productIds: opt(z.array(s(40)).max(4)),
  unit: opt(s(20)),
  unitPrice: opt(z.number().finite().positive()),
  unitMaterialCost: opt(z.number().finite().positive()),
  materials: opt(z.array(z.object({ materialId: s(40), qtyPerUnit: z.number().finite().positive() })).max(8)),
  unitCost: opt(z.number().finite().positive()),
  leadTimeHours: opt(z.number().finite().positive()),
  onHand: opt(z.number().finite().min(0)),
  target: opt(s(40)),
  kind: opt(s(20)),
  address: opt(s(200)),
  industry: opt(s()),
  location: opt(s()),
  productionType: opt(s(120)),
  text: opt(s(400)),
  option: opt(z.enum(["rehearsalIncident", "linesInterchangeable"])),
  value: opt(z.boolean()),
});
export type SpecOp = z.infer<typeof SpecOpSchema>;

export interface ApplyResult {
  spec: TwinSpec;
  applied: string[];
  rejected: string[];
}

/** Apply operations in order. Invalid operations are rejected with a reason; the rest still apply. */
export function applyOps(input: TwinSpec, ops: SpecOp[], prov: Prov): ApplyResult {
  const spec = structuredClone(input);
  const applied: string[] = [];
  const rejected: string[] = [];
  const taken = new Set<string>([
    ...spec.lines.map((l) => l.id),
    ...spec.lines.flatMap((l) => l.machines.map((m) => m.id)),
    ...spec.products.map((p) => p.id),
    ...spec.materials.map((m) => m.id),
    ...spec.integrations.map((i) => i.id),
    ...spec.mobileRobots.map((f) => f.id),
    ...spec.rules.map((r) => r.id),
  ]);
  const posOf = (o: { x?: number | null; y?: number | null; rot?: number | null }, fallback?: { rot: number } | null) =>
    o.x != null && o.y != null ? { x: Math.round(o.x * 100) / 100, y: Math.round(o.y * 100) / 100, rot: (((Math.round((o.rot ?? fallback?.rot ?? 0) / 90) * 90) % 360) + 360) % 360 } : null;
  const robotType = (t: string | null | undefined) => (t && (ROBOT_TYPES as readonly string[]).includes(t) ? (t as SpecRobotFleet["robotType"]) : null);
  const mission = (m: string | null | undefined) => (m && (ROBOT_MISSIONS as readonly string[]).includes(m) ? (m as SpecRobotFleet["mission"]) : null);
  // A line needs one machine, so add_line creates a placeholder; it is replaced by the first real add_machine.
  const placeholders = new Map<string, string>();
  const archetype = (a: string | null | undefined): AssetKind | null => (a && (ASSET_KINDS as string[]).includes(a) ? (a as AssetKind) : null);
  const findLine = (id?: string | null) => spec.lines.find((l) => l.id === id);
  const findMachine = (id?: string | null) => {
    for (const l of spec.lines) {
      const i = l.machines.findIndex((m) => m.id === id);
      if (i >= 0) return { line: l, index: i, machine: l.machines[i] };
    }
    return null;
  };
  /** Anything that pointed at removed lines or machines goes with them (fleets fall back to a default line). */
  const dropRefs = (gone: Set<string>) => {
    spec.integrations = spec.integrations.filter((i) => !gone.has(i.target));
    spec.rules = spec.rules.filter((r) => !(r.kind === "connector" ? gone.has(r.lineId) || (r.toLineId != null && gone.has(r.toLineId)) : r.kind === "maintenance" ? r.machineId != null && gone.has(r.machineId) : false));
    for (const f of spec.mobileRobots) if (f.lineId && gone.has(f.lineId)) f.lineId = null;
  };

  for (const raw of ops) {
    const parsed = SpecOpSchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push(`Invalid operation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
      continue;
    }
    const o = parsed.data;
    const fail = (why: string) => rejected.push(`${o.op}: ${why}`);
    switch (o.op) {
      case "add_machine": {
        const line = findLine(o.lineId);
        // Models sometimes put the machine type in `kind`; accept it only if it is a valid machine type.
        const kind = archetype(o.archetype) ?? archetype(o.kind);
        if (!line) fail(`line "${o.lineId}" not found`);
        else if (!kind) fail(`"${o.archetype}" is not a supported machine type`);
        else if (line.machines.length >= 8) fail(`${line.name} already has 8 machines`);
        else {
          const name = o.name || kind;
          const ph = placeholders.get(line.id);
          if (ph && line.machines.length === 1 && line.machines[0].id === ph) line.machines = [];
          placeholders.delete(line.id);
          const m = { id: uniqueId(`${line.name} ${name}`, taken), name, archetype: kind, ratePerHour: o.ratePerHour ?? null, notes: null, box: null, pos: posOf(o), prov };
          const at = o.position == null ? line.machines.length : Math.min(o.position, line.machines.length);
          line.machines.splice(at, 0, m);
          applied.push(`Added ${name} to ${line.name}`);
        }
        break;
      }
      case "update_machine": {
        const hit = findMachine(o.machineId);
        if (!hit) fail(`machine "${o.machineId}" not found`);
        else {
          const kind = o.archetype ? archetype(o.archetype) : null;
          if (o.archetype && !kind) {
            fail(`"${o.archetype}" is not a supported machine type`);
            break;
          }
          if (o.name) hit.machine.name = o.name;
          if (kind) hit.machine.archetype = kind;
          if (o.ratePerHour) hit.machine.ratePerHour = o.ratePerHour;
          if (o.clearRate) hit.machine.ratePerHour = null;
          hit.machine.prov = prov;
          applied.push(`Updated ${hit.machine.name}`);
        }
        break;
      }
      case "remove_machine": {
        const hit = findMachine(o.machineId);
        if (!hit) fail(`machine "${o.machineId}" not found`);
        else if (hit.line.machines.length === 1) fail(`${hit.line.name} needs at least one machine; remove the line instead`);
        else {
          hit.line.machines.splice(hit.index, 1);
          dropRefs(new Set([hit.machine.id]));
          applied.push(`Removed ${hit.machine.name} from ${hit.line.name}`);
        }
        break;
      }
      case "move_machine": {
        const hit = findMachine(o.machineId);
        if (!hit || o.position == null) fail("machine or position missing");
        else {
          const [m] = hit.line.machines.splice(hit.index, 1);
          hit.line.machines.splice(Math.min(o.position, hit.line.machines.length), 0, m);
          applied.push(`Moved ${m.name} to position ${Math.min(o.position, hit.line.machines.length - 1) + 1}`);
        }
        break;
      }
      case "add_line": {
        const kind = archetype(o.archetype) ?? "workstation";
        if (spec.lines.length >= 5) fail("at most 5 lines are supported");
        else {
          const name = o.name || `Line ${spec.lines.length + 1}`;
          const id = uniqueId(name, taken);
          const role = o.role ?? "process";
          const productIds = role === "process" ? (o.productIds ?? (spec.products[0] ? [spec.products[0].id] : [])) : [];
          const line = { id, name, role, productIds, box: null, prov, machines: [{ id: uniqueId(`${name} ${kind}`, taken), name: o.text || kind, archetype: kind, ratePerHour: null, notes: null, box: null, pos: posOf(o), prov }] };
          if (!o.archetype && !o.text) placeholders.set(id, line.machines[0].id);
          if (role === "packing") spec.lines.push(line);
          else {
            const firstPacking = spec.lines.findIndex((l) => l.role === "packing");
            spec.lines.splice(firstPacking < 0 ? spec.lines.length : firstPacking, 0, line);
          }
          applied.push(`Added ${role} line ${name}`);
        }
        break;
      }
      case "update_line": {
        const line = findLine(o.lineId);
        if (!line) fail(`line "${o.lineId}" not found`);
        else {
          if (o.name) line.name = o.name;
          if (o.role) line.role = o.role;
          if (o.productIds) line.productIds = o.productIds.filter((p) => spec.products.some((x) => x.id === p));
          line.prov = prov;
          applied.push(`Updated ${line.name}`);
        }
        break;
      }
      case "remove_line": {
        const line = findLine(o.lineId);
        if (!line) fail(`line "${o.lineId}" not found`);
        else if (spec.lines.length === 1) fail("a twin needs at least one line");
        else {
          spec.lines = spec.lines.filter((l) => l.id !== line.id);
          dropRefs(new Set([line.id, ...line.machines.map((m) => m.id)]));
          applied.push(`Removed ${line.name}`);
        }
        break;
      }
      case "add_product": {
        if (spec.products.length >= 6) fail("at most 6 products are supported");
        else {
          const name = o.name || `Product ${spec.products.length + 1}`;
          const id = uniqueId(name, taken);
          spec.products.push({ id, name, unit: o.unit || "units", ratePerHour: o.ratePerHour ?? null, unitPrice: o.unitPrice ?? null, unitMaterialCost: o.unitMaterialCost ?? null, materials: o.materials ?? [], prov });
          const line = findLine(o.lineId);
          if (line && line.role === "process" && line.productIds.length < 4) line.productIds.push(id);
          applied.push(`Added product ${name}${line ? ` on ${line.name}` : ""}`);
        }
        break;
      }
      case "update_product": {
        const p = spec.products.find((x) => x.id === o.productId);
        if (!p) fail(`product "${o.productId}" not found`);
        else {
          if (o.name) p.name = o.name;
          if (o.unit) p.unit = o.unit;
          if (o.ratePerHour) p.ratePerHour = o.ratePerHour;
          if (o.clearRate) p.ratePerHour = null;
          if (o.unitPrice) p.unitPrice = o.unitPrice;
          if (o.unitMaterialCost) p.unitMaterialCost = o.unitMaterialCost;
          if (o.materials) p.materials = o.materials;
          p.prov = prov;
          applied.push(`Updated product ${p.name}`);
        }
        break;
      }
      case "remove_product": {
        const p = spec.products.find((x) => x.id === o.productId);
        if (!p) fail(`product "${o.productId}" not found`);
        else {
          spec.products = spec.products.filter((x) => x.id !== p.id);
          for (const l of spec.lines) l.productIds = l.productIds.filter((x) => x !== p.id);
          applied.push(`Removed product ${p.name}`);
        }
        break;
      }
      case "add_material": {
        if (spec.materials.length >= 12) fail("at most 12 materials are supported");
        else {
          const name = o.name || `Material ${spec.materials.length + 1}`;
          spec.materials.push({ id: uniqueId(name, taken), name, unit: o.unit || "pcs", onHand: o.onHand ?? null, unitCost: o.unitCost ?? null, leadTimeHours: o.leadTimeHours ?? null, supplier: null, prov });
          applied.push(`Added material ${name}`);
        }
        break;
      }
      case "update_material": {
        const m = spec.materials.find((x) => x.id === o.materialId);
        if (!m) fail(`material "${o.materialId}" not found`);
        else {
          if (o.name) m.name = o.name;
          if (o.unit) m.unit = o.unit;
          if (o.unitCost) m.unitCost = o.unitCost;
          if (o.leadTimeHours) m.leadTimeHours = o.leadTimeHours;
          if (o.onHand != null) m.onHand = o.onHand;
          m.prov = prov;
          applied.push(`Updated material ${m.name}`);
        }
        break;
      }
      case "add_integration": {
        const kind = o.kind as (typeof INTEGRATION_KINDS)[number];
        const validTarget = o.target === "site" || !!findLine(o.target) || !!findMachine(o.target);
        if (!(INTEGRATION_KINDS as readonly string[]).includes(o.kind ?? "")) fail(`"${o.kind}" is not a supported connection type`);
        else if (!validTarget) fail(`target "${o.target}" not found`);
        else {
          spec.integrations.push({ id: uniqueId(`conn ${kind} ${o.target}`, taken), target: o.target!, kind, address: o.address ?? null, notes: o.text ?? null, prov });
          applied.push(`Planned ${kind.toUpperCase()} connection for ${o.target}`);
        }
        break;
      }
      case "remove_integration": {
        const before = spec.integrations.length;
        spec.integrations = spec.integrations.filter((i) => i.id !== o.integrationId);
        if (spec.integrations.length === before) fail(`connection "${o.integrationId}" not found`);
        else applied.push("Removed a planned connection");
        break;
      }
      case "update_site": {
        if (o.name) spec.site.name = o.name;
        if (o.industry) spec.site.industry = o.industry;
        if (o.location != null) spec.site.location = o.location;
        if (o.productionType != null) spec.site.productionType = o.productionType;
        spec.site.prov = prov;
        applied.push("Updated site details");
        break;
      }
      case "answer_question": {
        const q = spec.questions.find((x) => x.id === o.questionId);
        if (!q) fail(`question "${o.questionId}" not found`);
        else {
          q.answer = o.text ?? "";
          applied.push(`Answered: ${q.text.slice(0, 60)}`);
        }
        break;
      }
      case "add_assumption": {
        if (o.text) {
          spec.assumptions.push(o.text);
          applied.push("Recorded an assumption");
        } else fail("text missing");
        break;
      }
      case "add_robot_fleet": {
        const m = mission(o.mission);
        const t = o.robotType ? robotType(o.robotType) : "amr";
        const line = o.lineId ? findLine(o.lineId) : undefined;
        if (!m) fail(`"${o.mission}" is not a supported move (${ROBOT_MISSIONS.join(", ")})`);
        else if (!t) fail(`"${o.robotType}" is not a supported robot type (${ROBOT_TYPES.join(", ")})`);
        else if (o.lineId && !line) fail(`line "${o.lineId}" not found`);
        else if (spec.mobileRobots.length >= 10) fail("at most 10 robot fleets are supported");
        else {
          const count = Math.min(12, o.count ?? 1);
          const name = o.name || `${line ? `${line.name} ` : ""}${MISSION_LABEL[m]} ${ROBOT_LABEL[t]}s`;
          spec.mobileRobots.push({ id: uniqueId(name, taken), name, robotType: t, mission: m, lineId: line?.id ?? null, count, unitsPerTrip: o.unitsPerTrip ?? null, speedMps: o.speedMps ?? null, trigger: { kind: "output", everyMinutes: null }, route: [], prov });
          applied.push(`Added ${count} ${ROBOT_LABEL[t]}${count > 1 ? "s" : ""} for ${MISSION_LABEL[m]}${line ? ` on ${line.name}` : ""}`);
        }
        break;
      }
      case "update_robot_fleet": {
        const f = spec.mobileRobots.find((x) => x.id === o.fleetId);
        const t = o.robotType ? robotType(o.robotType) : null;
        const m = o.mission ? mission(o.mission) : null;
        const line = o.lineId ? findLine(o.lineId) : undefined;
        if (!f) fail(`robot fleet "${o.fleetId}" not found`);
        else if (o.robotType && !t) fail(`"${o.robotType}" is not a supported robot type`);
        else if (o.mission && !m) fail(`"${o.mission}" is not a supported move`);
        else if (o.lineId && !line) fail(`line "${o.lineId}" not found`);
        else {
          if (o.name) f.name = o.name;
          if (t) f.robotType = t;
          if (m) f.mission = m;
          if (line) f.lineId = line.id;
          if (o.count) f.count = Math.min(12, o.count);
          if (o.unitsPerTrip) f.unitsPerTrip = o.unitsPerTrip;
          if (o.speedMps) f.speedMps = Math.max(0.2, o.speedMps);
          if (o.triggerKind) f.trigger = { kind: o.triggerKind, everyMinutes: o.triggerKind === "schedule" ? (o.everyMinutes ?? f.trigger.everyMinutes ?? 20) : null };
          else if (o.everyMinutes && f.trigger.kind === "schedule") f.trigger = { kind: "schedule", everyMinutes: o.everyMinutes };
          f.prov = prov;
          applied.push(`Updated ${f.name}`);
        }
        break;
      }
      case "remove_robot_fleet": {
        const f = spec.mobileRobots.find((x) => x.id === o.fleetId);
        if (!f) fail(`robot fleet "${o.fleetId}" not found`);
        else {
          spec.mobileRobots = spec.mobileRobots.filter((x) => x.id !== f.id);
          applied.push(`Removed ${f.name}`);
        }
        break;
      }
      case "place_machine": {
        const hit = findMachine(o.machineId);
        const pos = hit ? posOf(o, hit.machine.pos) : null;
        if (!hit) fail(`machine "${o.machineId}" not found`);
        else if (!pos && o.rot == null) fail("x and y (or rot) are required");
        else {
          hit.machine.pos = pos ?? { x: hit.machine.pos?.x ?? 0, y: hit.machine.pos?.y ?? 0, rot: ((((Math.round((o.rot ?? 0) / 90) * 90) % 360) + 360) % 360) };
          applied.push(`Placed ${hit.machine.name}`);
        }
        break;
      }
      case "connect": {
        const from = findMachine(o.machineId);
        const to = findMachine(o.targetId);
        if (!from || !to) fail("both machines must exist");
        else if (from.machine.id === to.machine.id) fail("a machine can't feed itself");
        else if (from.line.id !== to.line.id && from.line.machines.length >= 8) fail(`${from.line.name} already has 8 machines`);
        else if (to.line.machines.length === 1 && spec.lines.length === 1) fail("a twin needs at least one line");
        else {
          // The target moves to directly after the source, in the source's line.
          to.line.machines.splice(to.index, 1);
          if (!to.line.machines.length) {
            spec.lines = spec.lines.filter((l) => l.id !== to.line.id);
            dropRefs(new Set([to.line.id]));
          }
          const at = from.line.machines.findIndex((m) => m.id === from.machine.id) + 1;
          from.line.machines.splice(at, 0, to.machine);
          applied.push(`${from.machine.name} now feeds ${to.machine.name}`);
        }
        break;
      }
      case "disconnect": {
        const hit = findMachine(o.machineId);
        if (!hit) fail(`machine "${o.machineId}" not found`);
        else if (hit.index === hit.line.machines.length - 1) fail(`${hit.machine.name} is the end of its line; nothing to disconnect`);
        else if (hit.line.role === "packing") fail("there is one packing area, so it can't be split; move or delete its machines instead");
        else if (spec.lines.length >= 5) fail("at most 5 lines are supported, so the line can't be split");
        else {
          const tail = hit.line.machines.splice(hit.index + 1);
          const name = `${hit.line.name} (part 2)`;
          const line = { id: uniqueId(name, taken), name, role: "process" as const, productIds: [...hit.line.productIds], box: null, prov, machines: tail };
          spec.lines.splice(spec.lines.indexOf(hit.line) + 1, 0, line);
          applied.push(`Split ${hit.line.name} after ${hit.machine.name}; the rest is now ${name}`);
        }
        break;
      }
      case "set_robot_route": {
        const f = spec.mobileRobots.find((x) => x.id === o.fleetId);
        if (!f) fail(`robot fleet "${o.fleetId}" not found`);
        else {
          f.route = (o.route ?? []).map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));
          f.prov = prov;
          applied.push(f.route.length ? `Routed ${f.name} through ${f.route.length} waypoint(s)` : `${f.name} takes the standard route`);
        }
        break;
      }
      case "add_rule": {
        if (spec.rules.length >= 30) {
          fail("at most 30 rules are supported");
          break;
        }
        const base = { enabled: o.enabled ?? true, prov };
        let rule: SpecRule | null = null;
        if (o.ruleKind === "inventory") {
          const mat = spec.materials.find((m) => m.id === o.materialId);
          if (!mat) fail(`material "${o.materialId}" not found`);
          else rule = { ...base, id: uniqueId(o.name || `reorder ${mat.name}`, taken), name: o.name || `Reorder ${mat.name}`, kind: "inventory", materialId: mat.id, below: o.below ?? null, orderQty: o.orderQty ?? null };
        } else if (o.ruleKind === "maintenance") {
          const m = o.machineId ? findMachine(o.machineId) : null;
          if (o.machineId && !m) fail(`machine "${o.machineId}" not found`);
          else {
            const metric = o.metric ?? "health";
            const threshold = o.threshold ?? (metric === "health" ? 50 : 7.1);
            const what = m ? m.machine.name : "any machine";
            rule = { ...base, id: uniqueId(o.name || `maintain ${what}`, taken), name: o.name || `Propose maintenance: ${what} ${metric === "health" ? `health < ${threshold}` : `vibration > ${threshold} mm/s`}`, kind: "maintenance", machineId: m?.machine.id ?? null, metric, threshold };
          }
        } else if (o.ruleKind === "connector") {
          const line = findLine(o.lineId);
          const when = o.when ?? "downstream-stops";
          const action = o.action ?? (when === "upstream-stops" ? "divert" : when === "buffer-full" ? "pause" : "slow");
          if (!line) fail(`line "${o.lineId}" not found`);
          else if (action === "divert" && !findLine(o.toLineId)) fail("divert needs toLineId (the line that takes over)");
          else
            rule = {
              ...base,
              id: uniqueId(o.name || `${line.name} ${when}`, taken),
              name: o.name || `${line.name}: ${when === "upstream-stops" ? "if it stops" : when === "downstream-stops" ? "if packing stops" : "if the buffer fills"}, ${action === "divert" ? `divert to ${findLine(o.toLineId)?.name ?? "another line"}` : action}`,
              kind: "connector",
              lineId: line.id,
              when,
              action,
              toLineId: action === "divert" ? (o.toLineId ?? null) : null,
              speedPct: action === "slow" ? (o.speedPct ?? 60) : null,
              bufferUnits: when === "buffer-full" ? (o.bufferUnits ?? 200) : null,
            };
        } else fail(`"${o.ruleKind}" is not a supported rule kind (${RULE_KINDS.join(", ")})`);
        if (rule) {
          spec.rules.push(rule);
          applied.push(`Added rule: ${rule.name}`);
        }
        break;
      }
      case "update_rule": {
        const r = spec.rules.find((x) => x.id === o.ruleId);
        if (!r) fail(`rule "${o.ruleId}" not found`);
        else {
          if (o.name) r.name = o.name;
          if (o.enabled != null) r.enabled = o.enabled;
          if (r.kind === "inventory") {
            if (o.below != null) r.below = o.below;
            if (o.orderQty != null) r.orderQty = o.orderQty;
          } else if (r.kind === "maintenance") {
            if (o.metric) r.metric = o.metric;
            if (o.threshold != null) r.threshold = o.threshold;
            if (o.machineId !== undefined) r.machineId = o.machineId && findMachine(o.machineId) ? o.machineId : null;
          } else {
            if (o.when) r.when = o.when;
            if (o.action) r.action = o.action;
            if (o.toLineId) r.toLineId = o.toLineId;
            if (o.speedPct != null) r.speedPct = o.speedPct;
            if (o.bufferUnits != null) r.bufferUnits = o.bufferUnits;
          }
          r.prov = prov;
          applied.push(`Updated rule: ${r.name}`);
        }
        break;
      }
      case "remove_rule": {
        const r = spec.rules.find((x) => x.id === o.ruleId);
        if (!r) fail(`rule "${o.ruleId}" not found`);
        else {
          spec.rules = spec.rules.filter((x) => x.id !== r.id);
          applied.push(`Removed rule: ${r.name}`);
        }
        break;
      }
      case "set_option": {
        if (!o.option || o.value == null) fail("option or value missing");
        else {
          spec.options[o.option] = o.value;
          applied.push(`${o.option} ${o.value ? "on" : "off"}`);
        }
        break;
      }
    }
  }
  return { spec, applied, rejected };
}
