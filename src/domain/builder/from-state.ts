/**
 * The running twin as an editable spec, so the playground can start from whatever is live. A twin
 * built with the Twin Builder keeps its reviewed spec; the demo plant, which predates the builder,
 * is read back from its lines, machines, products, stock, robots and rules.
 */
import { amrFleet } from "../intralogistics";
import type { FactoryState } from "../types";
import { uniqueId, type Prov, type SpecRule, type TwinSpec } from "./spec";

export function specFromState(state: FactoryState): TwinSpec {
  if (state.twinSpec) return structuredClone(state.twinSpec);
  const prov: Prov = { source: "user", note: `Read from the running twin "${state.profile.name}".`, refs: [] };
  const taken = new Set<string>();
  const lineIds: Record<string, string> = {};
  const machineIds: Record<string, string> = {};
  const productIds: Record<string, string> = {};
  const materialIds: Record<string, string> = {};

  const ordered = [...state.lines.filter((l) => l.kind === "assembly").slice(0, 4), ...state.lines.filter((l) => l.kind === "packaging").slice(0, 1)];
  for (const p of state.products.slice(0, 6)) productIds[p.id] = uniqueId(p.name, taken);
  for (const i of state.inventory.slice(0, 12)) materialIds[i.id] = uniqueId(i.name, taken);

  const lines = ordered.map((l) => {
    const id = (lineIds[l.id] = uniqueId(l.name, taken));
    const assets = l.assetIds.map((a) => state.assets.find((x) => x.id === a)).filter((a): a is NonNullable<typeof a> => !!a);
    return {
      id,
      name: l.name,
      role: l.kind === "packaging" ? ("packing" as const) : ("process" as const),
      productIds: l.kind === "packaging" ? [] : Object.entries(l.allocation).filter(([pid, s]) => s > 0 && productIds[pid]).map(([pid]) => productIds[pid]).slice(0, 4),
      box: null,
      prov,
      machines: assets.slice(0, 8).map((a) => ({
        id: (machineIds[a.id] = uniqueId(`${l.code} ${a.name}`, taken)),
        name: a.name,
        archetype: a.kind,
        ratePerHour: a.nominalRate > 0 ? Math.round(a.nominalRate) : null,
        notes: null,
        box: null,
        pos: state.layout?.[a.id] ? { ...state.layout[a.id] } : null,
        prov,
      })),
    };
  });

  // A product's rate and materials come from the line that owns it (the first that allocates it).
  const owner = (pid: string) => state.lines.find((l) => l.kind === "assembly" && (l.allocation[pid] ?? 0) > 0) ?? state.lines.find((l) => l.kind === "assembly" && l.capabilities.some((c) => c.productId === pid));
  const products = state.products.slice(0, 6).map((p) => {
    const cap = owner(p.id)?.capabilities.find((c) => c.productId === p.id);
    return {
      id: productIds[p.id],
      name: p.name,
      unit: "units",
      ratePerHour: cap ? Math.round(cap.ratePerHour) : null,
      unitPrice: p.unitPrice,
      unitMaterialCost: p.unitMaterialCost,
      materials: (cap?.bom ?? []).filter((b) => materialIds[b.itemId]).map((b) => ({ materialId: materialIds[b.itemId], qtyPerUnit: b.qty })),
      prov,
    };
  });

  const materials = state.inventory.slice(0, 12).map((i) => ({
    id: materialIds[i.id],
    name: i.name,
    unit: i.unit,
    onHand: Math.round(i.onHand),
    unitCost: i.unitCost > 0 ? i.unitCost : null,
    leadTimeHours: i.leadTimeHours > 0 ? i.leadTimeHours : null,
    supplier: i.supplier || null,
    prov,
  }));

  // Robots: the demo's derived fleet becomes explicit fleets that can be edited.
  const fleets = new Map<string, TwinSpec["mobileRobots"][number]>();
  for (const a of amrFleet(state)) {
    const f = fleets.get(a.fleetId);
    if (f) {
      f.count += 1;
      continue;
    }
    fleets.set(a.fleetId, {
      id: uniqueId(`${a.fleetName} ${a.lineName}`, taken),
      name: `${a.fleetName} · ${a.lineName}`,
      robotType: a.robotType,
      mission: a.mission,
      lineId: lineIds[a.lineId] ?? null,
      count: 1,
      unitsPerTrip: a.unitsPerTrip,
      speedMps: a.speedMps,
      trigger: a.everyMinutes ? { kind: "schedule", everyMinutes: a.everyMinutes } : { kind: "output", everyMinutes: null },
      route: a.route.map((p) => ({ ...p })),
      prov,
    });
  }

  const rules: SpecRule[] = [];
  for (const r of state.rules ?? []) {
    if (r.kind === "inventory" && materialIds[r.itemId]) rules.push({ id: r.id, name: r.name, kind: "inventory", enabled: r.enabled, materialId: materialIds[r.itemId], below: r.below, orderQty: r.orderQty, prov });
    else if (r.kind === "maintenance") rules.push({ id: r.id, name: r.name, kind: "maintenance", enabled: r.enabled, machineId: r.assetId ? (machineIds[r.assetId] ?? null) : null, metric: r.metric, threshold: r.threshold, prov });
    else if (r.kind === "connector" && lineIds[r.lineId])
      rules.push({ id: r.id, name: r.name, kind: "connector", enabled: r.enabled, lineId: lineIds[r.lineId], when: r.when, action: r.action, toLineId: r.toLineId ? (lineIds[r.toLineId] ?? null) : null, speedPct: r.speedPct, bufferUnits: r.bufferUnits, prov });
  }

  // Lines run each other's products when any process line can make a product it isn't allocated.
  const interchangeable = state.lines.some((l) => l.kind === "assembly" && l.capabilities.some((c) => !(l.allocation[c.productId] > 0)));

  return {
    version: 1,
    site: { name: state.profile.name, industry: state.profile.industry, location: state.profile.location === "Not specified" ? "" : state.profile.location, productionType: state.profile.productionType, prov },
    lines,
    products,
    materials,
    integrations: [],
    mobileRobots: [...fleets.values()],
    rules,
    references: [],
    assumptions: [`Read from the running twin "${state.profile.name}". Applying it rebuilds the twin from this layout; telemetry history starts fresh.`],
    questions: [],
    blueprint: null,
    options: { rehearsalIncident: false, linesInterchangeable: interchangeable },
  };
}
