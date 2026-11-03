/**
 * TwinSpec → FactoryState. Fully deterministic: the same spec and seed always give the same twin.
 * Values the spec leaves open are filled with stated defaults, listed in the build audit entry.
 */
import { appendAudit } from "../audit";
import { consumptionPerHour } from "../kpis";
import { round } from "../math";
import { assetIdFor, buildFromPlan, type FactoryPlan, type PlanLine, type PlanOrder } from "../seed";
import type { DataConnection, FactoryState, InventoryItem, LineCapability, MobileRobot, PlantRule, Product } from "../types";
import { PROVENANCE, type ProvenanceSource, type TwinSpec } from "./spec";
import { validateSpec, type LineSummary } from "./validate";

export const isElectronics = (industry: string, productionType = "") => /electron|pcb|smt|semicon|circuit/i.test(`${industry} ${productionType}`);

const engineId = (s: string, max = 14) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "X";

const PACKING_MATERIAL = /carton|case|box|packag|shrink|film|pallet|label/i;

export interface CompiledIds {
  lines: Record<string, string>;
  machines: Record<string, string>;
  products: Record<string, string>;
  materials: Record<string, string>;
}

export interface CompileResult {
  plan: FactoryPlan;
  ids: CompiledIds;
  lines: LineSummary[];
  defaults: string[];
}

export function planFromSpec(input: TwinSpec): CompileResult {
  const v = validateSpec(input);
  if (!v.ok || !v.spec) throw new Error(`Spec has errors: ${v.issues.filter((i) => i.level === "error").map((i) => i.message).join(" ")}`);
  const spec = v.spec;
  const summaries = new Map(v.lines.map((l) => [l.id, l]));
  const defaults: string[] = [];
  const electronics = isElectronics(spec.site.industry, spec.site.productionType);

  // Engine ids
  const taken = new Set<string>();
  const uniq = (base: string) => {
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base.slice(0, 11)}-${i}`;
    taken.add(id);
    return id;
  };
  const ids: CompiledIds = { lines: {}, machines: {}, products: {}, materials: {} };
  const process = spec.lines.filter((l) => l.role === "process");
  const packing = spec.lines.find((l) => l.role === "packing") ?? null;
  const letters = ["A", "B", "C", "D", "E"];
  [...process, ...(packing ? [packing] : [])].forEach((l, i) => {
    ids.lines[l.id] = `LINE-${letters[i]}`;
    l.machines.forEach((m, k) => (ids.machines[m.id] = assetIdFor(m.archetype, letters[i], k)));
  });
  for (const p of spec.products) ids.products[p.id] = uniq(engineId(p.id));
  for (const m of spec.materials) ids.materials[m.id] = uniq(engineId(m.id));

  // Products (prices default when unknown)
  const matCost = new Map(spec.materials.map((m) => [m.id, m.unitCost]));
  const products: Product[] = spec.products.map((p) => {
    const bomCost = p.materials.reduce((s, b) => s + (matCost.get(b.materialId) ?? 0) * b.qtyPerUnit, 0);
    const cost = p.unitMaterialCost ?? (bomCost > 0 ? round(bomCost, 2) : 10);
    const price = p.unitPrice ?? round(cost * 2.5, 2);
    if (p.unitMaterialCost == null && bomCost <= 0) defaults.push(`${p.name}: material cost 10 per unit`);
    if (p.unitPrice == null) defaults.push(`${p.name}: price ${price} per unit (2.5 × material cost)`);
    return { id: ids.products[p.id], name: p.name, sku: ids.products[p.id], unitMaterialCost: cost, unitPrice: price, inspectionOpportunities: electronics ? 150 : 20 };
  });

  // Every product needs at least one material for the supply model; packing needs packaging.
  const inventorySpecs = spec.materials.map((m) => ({ ...m }));
  const bomFor = new Map(spec.products.map((p) => [p.id, p.materials.map((b) => ({ itemId: ids.materials[b.materialId], qty: b.qtyPerUnit }))]));
  for (const p of spec.products) {
    if (bomFor.get(p.id)!.length) continue;
    const mid = uniq(engineId(`${p.id}-RAW`));
    inventorySpecs.push({ id: `${p.id}-raw`, name: `${p.name} raw material`, unit: "units", onHand: null, unitCost: null, leadTimeHours: null, supplier: null, prov: { source: "default" } });
    ids.materials[`${p.id}-raw`] = mid;
    bomFor.set(p.id, [{ itemId: mid, qty: 1 }]);
    defaults.push(`${p.name}: one unit of generic raw material per unit`);
  }
  let packItem: string | null = null;
  if (packing) {
    const existing = spec.materials.find((m) => PACKING_MATERIAL.test(m.name));
    if (existing) packItem = ids.materials[existing.id];
    else {
      packItem = uniq("PACK-MAT");
      inventorySpecs.push({ id: "packaging-material", name: "Packaging material", unit: "pcs", onHand: null, unitCost: 0.6, leadTimeHours: 24, supplier: null, prov: { source: "default" } });
      ids.materials["packaging-material"] = packItem;
      defaults.push("Packing consumes one unit of generic packaging material per product");
    }
  }

  // Lines
  const lines: PlanLine[] = [];
  const own = (lineId: string) => summaries.get(lineId)!;
  for (const l of process) {
    const s = own(l.id);
    const caps: LineCapability[] = l.productIds.map((pid) => {
      const rate = s.productRates[pid] ?? s.targetRate;
      return { productId: ids.products[pid], ratePerHour: rate, designRatePerHour: Math.round(rate * 1.12), changeoverHours: 0.75, bom: bomFor.get(pid)!.map((b) => ({ ...b })) };
    });
    if (spec.options.linesInterchangeable && process.length > 1) {
      for (const other of process) {
        if (other.id === l.id) continue;
        for (const pid of other.productIds) {
          if (caps.some((c) => c.productId === ids.products[pid])) continue;
          const rate = Math.round((own(other.id).productRates[pid] ?? own(other.id).targetRate) * 0.8);
          caps.push({ productId: ids.products[pid], ratePerHour: rate, designRatePerHour: Math.round(rate * 1.12), changeoverHours: 0.75, bom: bomFor.get(pid)!.map((b) => ({ ...b })) });
        }
      }
    }
    lines.push({
      code: ids.lines[l.id].slice(5),
      name: l.name,
      kind: "assembly",
      machines: l.machines.map((m) => ({ kind: m.archetype, name: m.name, nominalRate: s.machineRates[m.id].rate })),
      capabilities: caps,
      allocation: Object.fromEntries(l.productIds.map((pid) => [ids.products[pid], round(1 / l.productIds.length, 4)])),
      baseScrapRate: 0.015,
    });
  }
  if (spec.options.linesInterchangeable && process.length > 1) defaults.push("Process lines can run each other's products at 80% of the owner line's rate");
  if (packing) {
    const s = own(packing.id);
    lines.push({
      code: ids.lines[packing.id].slice(5),
      name: packing.name,
      kind: "packaging",
      machines: packing.machines.map((m) => ({ kind: m.archetype, name: m.name, nominalRate: s.machineRates[m.id].rate })),
      capabilities: spec.products.map((p) => ({ productId: ids.products[p.id], ratePerHour: s.targetRate, designRatePerHour: Math.round(s.targetRate * 1.12), changeoverHours: 0, bom: packItem ? [{ itemId: packItem, qty: 1 }] : [] })),
      allocation: Object.fromEntries(spec.products.map((p) => [ids.products[p.id], round(1 / spec.products.length, 4)])),
      baseScrapRate: 0.003,
    });
  }
  for (const s of v.lines) {
    const derived = Object.entries(s.machineRates).filter(([, r]) => r.derived).length;
    if (derived) defaults.push(`${s.name}: ${derived} machine rate(s) sized at 120% of the line's planned ${s.targetRate}/h`);
  }

  // Consumption per material (units/hour) at planned rates, for default stock levels.
  const consumption = new Map<string, number>();
  for (const l of lines) {
    for (const c of l.capabilities) {
      const share = l.allocation[c.productId] ?? 0;
      for (const b of c.bom) consumption.set(b.itemId, (consumption.get(b.itemId) ?? 0) + c.ratePerHour * share * b.qty);
    }
  }
  let po = 7800;
  let stockDefaulted = 0;
  const inventory: InventoryItem[] = inventorySpecs.map((m) => {
    const id = ids.materials[m.id];
    const perHour = consumption.get(id) ?? 0;
    if (m.onHand == null) stockDefaulted++;
    const unitCost = m.unitCost ?? 1;
    return {
      id,
      name: m.name,
      category: PACKING_MATERIAL.test(m.name) ? "packaging" : "raw",
      unit: m.unit,
      onHand: Math.round(m.onHand ?? Math.max(100, perHour * 36)),
      reserved: 0,
      reorderPoint: Math.round(Math.max(50, perHour * 12)),
      unitCost,
      supplier: m.supplier ?? "Not specified",
      leadTimeHours: m.leadTimeHours ?? 48,
      inbound: perHour > 0 ? [{ poId: `PO-${po++}`, qty: Math.round(perHour * 24), etaHour: 30 }] : [],
      expediteCost: Math.round(unitCost * perHour * 6 + 300),
      expediteEtaHours: 12,
    };
  });
  if (stockDefaulted) defaults.push(`${stockDefaulted} material(s): stock on hand set to 36 h of consumption, reorder point 12 h, one sample inbound PO`);

  // Sample order book so delivery risk can be computed until an ERP is connected.
  const orders: PlanOrder[] = [];
  spec.products.forEach((p, i) => {
    const line = process.find((l) => l.productIds.includes(p.id));
    const rate = line ? (own(line.id).productRates[p.id] ?? own(line.id).targetRate) / Math.max(1, line.productIds.length) : 50;
    const q = (h: number) => Math.max(10, Math.round((rate * h) / 10) * 10);
    if (i === 0) {
      orders.push({ productId: ids.products[p.id], quantity: q(18), dueHour: 24, priority: "critical", penaltyPerLateUnit: 12 });
      orders.push({ productId: ids.products[p.id], quantity: q(14), dueHour: 48, priority: "high", penaltyPerLateUnit: 6 });
    } else {
      orders.push({ productId: ids.products[p.id], quantity: q(16), dueHour: 36 + i * 4, priority: "high", penaltyPerLateUnit: 6 });
      orders.push({ productId: ids.products[p.id], quantity: q(10), dueHour: 60, priority: "standard", penaltyPerLateUnit: 3 });
    }
  });
  defaults.push(`${orders.length} sample customer orders (replace with your ERP order book)`);

  const kinds = new Set(spec.integrations.map((i) => i.kind));
  const plan: FactoryPlan = {
    profile: {
      name: spec.site.name,
      industry: spec.site.industry,
      location: spec.site.location || "Not specified",
      productionType: spec.site.productionType || spec.site.industry,
      dataSource: kinds.has("mqtt") ? "mqtt" : [...kinds].some((k) => k !== "simulated") ? "cloud" : "demo",
      isDemo: false,
    },
    lines,
    products,
    inventory,
    orders,
    seedIncident: spec.options.rehearsalIncident,
    backgroundWear: spec.options.rehearsalIncident,
    quality: electronics ? "electronics" : "generic",
    customers: ["Sample customer A", "Sample customer B", "Sample customer C", "Sample customer D"],
  };
  return { plan, ids, lines: v.lines, defaults };
}

/** Count of spec elements by provenance (shown in the build audit and the review screen). */
export function provenanceCounts(spec: TwinSpec): Record<ProvenanceSource, number> {
  const counts = Object.fromEntries(PROVENANCE.map((p) => [p, 0])) as Record<ProvenanceSource, number>;
  const add = (s: ProvenanceSource) => counts[s]++;
  for (const l of spec.lines) {
    add(l.prov.source);
    for (const m of l.machines) add(m.prov.source);
  }
  for (const p of spec.products) add(p.prov.source);
  for (const m of spec.materials) add(m.prov.source);
  for (const i of spec.integrations) add(i.prov.source);
  for (const f of spec.mobileRobots) add(f.prov.source);
  return counts;
}

export function compileSpec(spec: TwinSpec, anchorISO: string, seed: number, nowISO: string, by: string): FactoryState {
  const { plan, ids, defaults } = planFromSpec(spec);
  const validated = validateSpec(spec).spec!;
  const state = buildFromPlan(plan, anchorISO, seed);
  const nameOf = (target: string) =>
    target === "site" ? "Site" : (validated.lines.find((l) => l.id === target)?.name ?? validated.lines.flatMap((l) => l.machines).find((m) => m.id === target)?.name ?? target);
  state.twinSpec = validated;
  state.dataPlan = validated.integrations.map(
    (i): DataConnection => ({
      id: i.id,
      target: i.target === "site" ? "site" : (ids.lines[i.target] ?? ids.machines[i.target] ?? i.target),
      targetName: nameOf(i.target),
      kind: i.kind,
      address: i.address,
      notes: i.notes ?? null,
      status: "planned",
    }),
  );
  // Mobile robots: one entry per robot, serving the compiled line.
  const ROBOT_PREFIX: Record<MobileRobot["robotType"], string> = { amr: "AMR", agv: "AGV", "forklift-agv": "AGF", tugger: "TUG" };
  const TRIP_DEFAULT: Record<MobileRobot["mission"], number> = { kitting: 60, "line-transfer": 60, "finished-goods": 120 };
  if (validated.mobileRobots.length) {
    const robots: MobileRobot[] = [];
    const used = new Set<string>();
    for (const f of validated.mobileRobots) {
      const lineId = f.lineId ? ids.lines[f.lineId] : undefined;
      if (!lineId) continue;
      const letter = lineId.replace("LINE-", "");
      for (let k = 0; k < f.count; k++) {
        let n = 1;
        while (used.has(`${ROBOT_PREFIX[f.robotType]}-${letter}${n}`)) n++;
        const id = `${ROBOT_PREFIX[f.robotType]}-${letter}${n}`;
        used.add(id);
        robots.push({
          id,
          name: f.count > 1 ? `${f.name} ${k + 1}` : f.name,
          fleetId: f.id,
          fleetName: f.name,
          robotType: f.robotType,
          mission: f.mission,
          lineId,
          unitsPerTrip: f.unitsPerTrip ?? TRIP_DEFAULT[f.mission],
          speedMps: f.speedMps ?? 1.0,
          ...(f.trigger.kind === "schedule" && f.trigger.everyMinutes ? { trigger: { kind: "schedule" as const, everyMinutes: f.trigger.everyMinutes } } : {}),
          ...(f.route.length ? { route: f.route.map((p) => ({ ...p })) } : {}),
        });
      }
      if (f.unitsPerTrip == null) defaults.push(`${f.name}: ${TRIP_DEFAULT[f.mission]} units per trip`);
      if (f.speedMps == null) defaults.push(`${f.name}: 1.0 m/s travel speed`);
    }
    state.mobileRobots = robots;
  }

  // Floor positions from the playground.
  const placed = validated.lines.flatMap((l) => l.machines.filter((m) => m.pos && ids.machines[m.id]).map((m) => [ids.machines[m.id], { ...m.pos! }] as const));
  if (placed.length) state.layout = Object.fromEntries(placed);

  // Automation rules, in engine ids. Inventory rules default to the item's reorder point and a day of use.
  const rules: PlantRule[] = [];
  for (const r of validated.rules) {
    if (r.kind === "inventory") {
      const item = state.inventory.find((i) => i.id === ids.materials[r.materialId]);
      if (!item) continue;
      const below = r.below ?? item.reorderPoint;
      const orderQty = r.orderQty ?? Math.max(item.reorderPoint * 2, Math.round(consumptionPerHour(state, item.id) * 24));
      rules.push({ id: r.id, name: r.name, kind: "inventory", enabled: r.enabled, itemId: item.id, below, orderQty, leadTimeHours: item.leadTimeHours });
      if (r.below == null || r.orderQty == null) defaults.push(`${r.name}: order ${orderQty} ${item.unit} when stock plus open orders fall below ${below}`);
    } else if (r.kind === "maintenance") {
      rules.push({ id: r.id, name: r.name, kind: "maintenance", enabled: r.enabled, assetId: r.machineId ? (ids.machines[r.machineId] ?? null) : null, metric: r.metric, threshold: r.threshold });
    } else {
      const lineId = ids.lines[r.lineId];
      if (!lineId) continue;
      rules.push({ id: r.id, name: r.name, kind: "connector", enabled: r.enabled, lineId, when: r.when, action: r.action, toLineId: r.toLineId ? (ids.lines[r.toLineId] ?? null) : null, speedPct: r.speedPct, bufferUnits: r.bufferUnits });
    }
  }
  if (rules.length) {
    state.rules = rules;
    state.ruleRuntime = { seq: 0, rules: {} };
  }

  const counts = provenanceCounts(validated);
  appendAudit(state, nowISO, {
    category: "system",
    actor: by,
    title: "Twin built from a reviewed spec (Twin Builder)",
    detail: `${validated.lines.length} lines, ${state.assets.length} machines, ${validated.products.length} products${state.mobileRobots?.length ? `, ${state.mobileRobots.length} mobile robot(s)` : ""}${state.rules?.length ? `, ${state.rules.length} automation rule(s)` : ""}. Sources: ${PROVENANCE.filter((p) => counts[p])
      .map((p) => `${counts[p]} from ${p}`)
      .join(", ")}; ${validated.references.length} cited reference(s). Defaults applied: ${defaults.join("; ")}.`,
    severity: "info",
    refs: {},
  });
  return state;
}
