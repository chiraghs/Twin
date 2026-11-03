/**
 * Deterministic checks and normalisation of a TwinSpec. The model may propose anything; only a
 * spec that passes here can be compiled. Fixable problems are repaired and reported; the rest
 * are errors the person must resolve.
 */
import { ARCHETYPES } from "../archetypes";
import { TwinSpecSchema, uniqueId, type SpecLine, type TwinSpec } from "./spec";

export interface SpecIssue {
  level: "error" | "warning" | "info";
  path: string;
  message: string;
}

export interface LineSummary {
  id: string;
  name: string;
  role: SpecLine["role"];
  /** Planned rate of the line in product units/hour. */
  targetRate: number;
  /** Rate per machine after defaults (explicit or derived). */
  machineRates: Record<string, { rate: number; derived: boolean }>;
  bottleneck: { machineId: string; name: string; rate: number } | null;
  productRates: Record<string, number>;
}

export interface ValidationResult {
  ok: boolean;
  spec: TwinSpec | null;
  issues: SpecIssue[];
  lines: LineSummary[];
}

const MAX_PROCESS_LINES = 4;

/** Line and machine rates: explicit values win; the rest are derived the same way every time. */
export function deriveRates(spec: TwinSpec): LineSummary[] {
  const product = new Map(spec.products.map((p) => [p.id, p]));
  const summaries: LineSummary[] = [];
  const process = spec.lines.filter((l) => l.role === "process");
  for (const line of spec.lines) {
    let target: number;
    const productRates: Record<string, number> = {};
    if (line.role === "process") {
      const explicitMachines = line.machines.filter((m) => m.ratePerHour).map((m) => m.ratePerHour!);
      // Without a stated rate, size the line from its most critical machine's typical rate.
      const critical = [...line.machines].sort((a, b) => ARCHETYPES[a.archetype].template.criticality.localeCompare(ARCHETYPES[b.archetype].template.criticality))[0];
      const base = explicitMachines.length ? Math.min(...explicitMachines) * 0.85 : ARCHETYPES[critical.archetype].template.nominalRate * 0.85;
      const rates = line.productIds.map((pid) => product.get(pid)?.ratePerHour ?? null);
      for (const pid of line.productIds) productRates[pid] = Math.round(product.get(pid)?.ratePerHour ?? base);
      target = Math.round(Math.max(...rates.map((r) => r ?? 0), rates.some((r) => r === null) || !rates.length ? base : 0));
    } else {
      const upstream = summaries.filter((s) => s.role === "process").reduce((s, l) => s + l.targetRate, 0) || process.length * 100;
      const explicit = line.machines.filter((m) => m.ratePerHour).map((m) => m.ratePerHour!);
      target = Math.round(explicit.length ? Math.min(Math.min(...explicit) * 0.9, upstream * 1.1) : upstream * 1.1);
    }
    const machineRates: LineSummary["machineRates"] = {};
    for (const m of line.machines) machineRates[m.id] = m.ratePerHour ? { rate: m.ratePerHour, derived: false } : { rate: Math.round(target * 1.2), derived: true };
    const slowest = [...line.machines].sort((a, b) => machineRates[a.id].rate - machineRates[b.id].rate)[0];
    summaries.push({
      id: line.id,
      name: line.name,
      role: line.role,
      targetRate: target,
      machineRates,
      bottleneck: slowest ? { machineId: slowest.id, name: slowest.name, rate: machineRates[slowest.id].rate } : null,
      productRates,
    });
  }
  return summaries;
}

export function validateSpec(input: unknown): ValidationResult {
  const issues: SpecIssue[] = [];
  const parsed = TwinSpecSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 20)) issues.push({ level: "error", path: i.path.join("."), message: i.message });
    return { ok: false, spec: null, issues, lines: [] };
  }
  const spec: TwinSpec = structuredClone(parsed.data);

  // Unique ids everywhere.
  const dedupe = <T extends { id: string; name?: string }>(items: T[], what: string, taken = new Set<string>()) => {
    for (const it of items) {
      if (taken.has(it.id)) {
        const old = it.id;
        it.id = uniqueId(it.name ?? it.id, taken);
        issues.push({ level: "warning", path: what, message: `Duplicate id "${old}" renamed to "${it.id}".` });
      } else taken.add(it.id);
    }
  };
  dedupe(spec.lines, "lines");
  dedupe(
    spec.lines.flatMap((l) => l.machines),
    "machines",
  );
  dedupe(spec.products, "products");
  dedupe(spec.materials, "materials");
  dedupe(spec.integrations, "integrations");
  dedupe(spec.mobileRobots, "mobileRobots");
  dedupe(spec.rules, "rules");

  // Line structure: process lines feed at most one packing line, which runs last.
  const packing = spec.lines.filter((l) => l.role === "packing");
  const process = spec.lines.filter((l) => l.role === "process");
  if (!process.length) issues.push({ level: "error", path: "lines", message: "Add at least one process line (a packing line alone cannot make product)." });
  if (packing.length > 1) issues.push({ level: "error", path: "lines", message: `Only one packing / end-of-line area is supported; found ${packing.length}. Merge them or mark extras as process lines.` });
  if (process.length > MAX_PROCESS_LINES) issues.push({ level: "error", path: "lines", message: `Up to ${MAX_PROCESS_LINES} process lines are supported; found ${process.length}.` });
  if (packing.length === 1 && spec.lines[spec.lines.length - 1].role !== "packing") {
    spec.lines = [...process, ...packing];
    issues.push({ level: "info", path: "lines", message: "Moved the packing line to the end of the flow." });
  }

  // Products.
  if (!spec.products.length) {
    spec.products.push({ id: "product", name: "Finished product", unit: "units", ratePerHour: null, unitPrice: null, unitMaterialCost: null, materials: [], prov: { source: "default", note: "No product was specified." } });
    issues.push({ level: "warning", path: "products", message: 'No products were specified; added a placeholder "Finished product".' });
  }
  const productIds = new Set(spec.products.map((p) => p.id));
  for (const line of spec.lines) {
    const unknown = line.productIds.filter((p) => !productIds.has(p));
    if (unknown.length) {
      line.productIds = line.productIds.filter((p) => productIds.has(p));
      issues.push({ level: "warning", path: `lines.${line.id}`, message: `Removed unknown product(s) ${unknown.join(", ")} from ${line.name}.` });
    }
    if (line.role === "process" && !line.productIds.length) {
      line.productIds = [spec.products[0].id];
      issues.push({ level: "warning", path: `lines.${line.id}`, message: `${line.name} had no product; assigned ${spec.products[0].name}.` });
    }
    if (line.role === "packing" && line.productIds.length) line.productIds = [];
  }
  for (const p of spec.products) {
    if (!process.some((l) => l.productIds.includes(p.id))) issues.push({ level: "warning", path: `products.${p.id}`, message: `${p.name} is not made on any process line.` });
  }

  // Materials referenced by products must exist.
  const materialIds = new Set(spec.materials.map((m) => m.id));
  for (const p of spec.products) {
    for (const m of p.materials) {
      if (!materialIds.has(m.materialId)) {
        spec.materials.push({ id: m.materialId, name: m.materialId.replace(/-/g, " "), unit: "pcs", onHand: null, unitCost: null, leadTimeHours: null, supplier: null, prov: { source: "default", note: `Created because ${p.name} uses it.` } });
        materialIds.add(m.materialId);
        issues.push({ level: "warning", path: `products.${p.id}`, message: `Material "${m.materialId}" was missing; added it with default stock values.` });
      }
    }
  }

  // References used in provenance must exist.
  const refIds = new Set(spec.references.map((r) => r.id));
  const checkRefs = (prov: { refs?: string[] | null }, path: string) => {
    const bad = (prov.refs ?? []).filter((r) => !refIds.has(r));
    if (bad.length) {
      prov.refs = (prov.refs ?? []).filter((r) => refIds.has(r));
      issues.push({ level: "warning", path, message: `Removed citation(s) ${bad.join(", ")} that are not in the reference list.` });
    }
  };
  checkRefs(spec.site.prov, "site");
  for (const l of spec.lines) {
    checkRefs(l.prov, `lines.${l.id}`);
    for (const m of l.machines) checkRefs(m.prov, `machines.${m.id}`);
  }
  for (const p of spec.products) checkRefs(p.prov, `products.${p.id}`);
  for (const f of spec.mobileRobots) checkRefs(f.prov, `mobileRobots.${f.id}`);

  // Integrations must point at something that exists.
  const targets = new Set(["site", ...spec.lines.map((l) => l.id), ...spec.lines.flatMap((l) => l.machines.map((m) => m.id))]);
  spec.integrations = spec.integrations.filter((i) => {
    if (targets.has(i.target)) return true;
    issues.push({ level: "warning", path: `integrations.${i.id}`, message: `Removed connection ${i.kind} to unknown target "${i.target}".` });
    return false;
  });
  for (const i of spec.integrations) {
    if (i.kind !== "simulated" && !i.address) issues.push({ level: "info", path: `integrations.${i.id}`, message: `${i.kind.toUpperCase()} connection on ${i.target} has no address yet; it stays planned.` });
  }

  // Mobile robots: each fleet serves a line that suits its move.
  const packingLine = spec.lines.find((l) => l.role === "packing") ?? null;
  const processLines = spec.lines.filter((l) => l.role === "process");
  spec.mobileRobots = spec.mobileRobots.filter((f) => {
    const line = spec.lines.find((l) => l.id === f.lineId) ?? null;
    const path = `mobileRobots.${f.id}`;
    if (f.mission === "finished-goods") {
      const from = packingLine ?? processLines[processLines.length - 1] ?? null;
      if (from && line?.id !== from.id) {
        if (line) issues.push({ level: "info", path, message: `${f.name}: finished goods leave from ${from.name}, so the robots serve that line.` });
        f.lineId = from.id;
      }
      return !!from;
    }
    if (f.mission === "line-transfer" && !packingLine) {
      issues.push({ level: "warning", path, message: `${f.name}: moving product between lines needs a packing line; removed. Add a packing line or choose kitting.` });
      return false;
    }
    if (!line || line.role !== "process") {
      const first = processLines[0];
      if (!first) return false;
      f.lineId = first.id;
      issues.push({
        level: processLines.length > 1 ? "warning" : "info",
        path,
        message: processLines.length > 1 ? `${f.name}: no process line was named; assigned to ${first.name}. Change it if another line is served.` : `${f.name}: serves ${first.name}.`,
      });
    }
    return true;
  });
  for (const f of spec.mobileRobots) {
    if (f.trigger.kind === "schedule" && !f.trigger.everyMinutes) f.trigger.everyMinutes = 20;
    if (f.trigger.kind === "output") f.trigger.everyMinutes = null;
  }
  const robots = spec.mobileRobots.reduce((n, f) => n + f.count, 0);
  if (robots > 24) issues.push({ level: "error", path: "mobileRobots", message: `${robots} mobile robots requested; up to 24 are simulated. Reduce the fleet sizes.` });
  else if (robots) issues.push({ level: "info", path: "mobileRobots", message: `${robots} mobile robot(s) will be simulated from line output; no fleet manager is connected yet.` });

  // Rules: every reference must exist, and the action must make sense for the line.
  const lineById = new Map(spec.lines.map((l) => [l.id, l]));
  const machineIds = new Set(spec.lines.flatMap((l) => l.machines.map((m) => m.id)));
  spec.rules = spec.rules.filter((r) => {
    const path = `rules.${r.id}`;
    const drop = (why: string) => {
      issues.push({ level: "warning", path, message: `Rule "${r.name}" removed: ${why}` });
      return false;
    };
    if (r.kind === "inventory") {
      if (!materialIds.has(r.materialId)) return drop(`material "${r.materialId}" doesn't exist.`);
      return true;
    }
    if (r.kind === "maintenance") {
      if (r.machineId && !machineIds.has(r.machineId)) return drop(`machine "${r.machineId}" doesn't exist.`);
      if (r.metric === "vibration" && r.threshold > 30) issues.push({ level: "warning", path, message: `${r.name}: vibration above ${r.threshold} mm/s never happens in the simulation, so the rule won't fire.` });
      return true;
    }
    const line = lineById.get(r.lineId);
    if (!line) return drop(`line "${r.lineId}" doesn't exist.`);
    if (r.action === "divert") {
      const to = r.toLineId ? lineById.get(r.toLineId) : undefined;
      if (!to || to.id === line.id) return drop("divert needs another line to take over.");
      if (line.role !== "process" || to.role !== "process") return drop("only process lines can take over each other's work.");
      if (!spec.options.linesInterchangeable && !to.productIds.some((p) => line.productIds.includes(p)))
        issues.push({ level: "warning", path, message: `${r.name}: ${to.name} doesn't make ${line.name}'s products, so it takes over the work at its own product mix.` });
      if (r.when !== "upstream-stops") {
        r.when = "upstream-stops";
        issues.push({ level: "info", path, message: `${r.name}: divert fires when ${line.name} stops.` });
      }
    }
    if (r.action === "slow" && !r.speedPct) r.speedPct = 60;
    if (r.when === "buffer-full" && !r.bufferUnits) r.bufferUnits = 200;
    if (r.when === "downstream-stops" && !spec.lines.some((l) => l.role === "packing") && processLines.length < 2)
      issues.push({ level: "info", path, message: `${r.name}: the line has nothing downstream except finished goods, so "downstream stops" means a packing stop.` });
    return true;
  });
  if (spec.rules.length) issues.push({ level: "info", path: "rules", message: `${spec.rules.filter((r) => r.enabled).length} automation rule(s) run in the simulation; they never send commands to real equipment.` });

  // Floor positions: two machines can't sit in the same spot.
  const placed = spec.lines.flatMap((l) => l.machines.filter((m) => m.pos).map((m) => ({ m, line: l })));
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i].m.pos!;
      const b = placed[j].m.pos!;
      if (Math.abs(a.x - b.x) < 1.6 && Math.abs(a.y - b.y) < 1.6) issues.push({ level: "warning", path: `machines.${placed[j].m.id}`, message: `${placed[i].m.name} and ${placed[j].m.name} overlap on the floor.` });
    }

  // Rates: typical ranges and bottlenecks.
  const lines = deriveRates(spec);
  for (const line of spec.lines) {
    for (const m of line.machines) {
      const [lo, hi] = ARCHETYPES[m.archetype].rateRange;
      if (m.ratePerHour && (m.ratePerHour < lo || m.ratePerHour > hi)) {
        const kind = ARCHETYPES[m.archetype].name.toLowerCase();
        issues.push({ level: "warning", path: `machines.${m.id}`, message: `${m.name}: ${m.ratePerHour}/h is outside the typical range for ${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} (${lo}–${hi}/h). Check the unit.` });
      }
    }
    const sum = lines.find((s) => s.id === line.id)!;
    if (sum.bottleneck && sum.bottleneck.rate < sum.targetRate) {
      issues.push({ level: "warning", path: `lines.${line.id}`, message: `${sum.bottleneck.name} (${sum.bottleneck.rate}/h) limits ${line.name} below its planned ${sum.targetRate}/h.` });
    }
  }

  const open = spec.questions.filter((q) => !q.answer);
  if (open.length) issues.push({ level: "info", path: "questions", message: `${open.length} open question(s) from the agent. The twin can be built now and refined later.` });
  if (spec.lines.some((l) => l.machines.length > 1)) {
    issues.push({ level: "info", path: "lines", message: "Machines on a line run in series; parallel stations are modelled by their combined rate." });
  }

  return { ok: !issues.some((i) => i.level === "error"), spec, issues, lines };
}
