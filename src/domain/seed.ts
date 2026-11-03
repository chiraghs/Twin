/**
 * Deterministic factory builder.
 *
 * `buildFactory(blueprint)` creates a complete, internally consistent factory: lines,
 * machines, products, BOMs, inventory, orders and maintenance history. It then runs the
 * plant model for 24 simulated hours of "pre-history" so that telemetry, production
 * records and energy history are produced by the same physics that drives the live twin.
 */
import { ARCHETYPES, ASSET_KIND_LABEL, ASSET_KINDS, machineTemplate, type MachineTemplate } from "./archetypes";
import { DEFAULT_COST_MODEL } from "./constants";
import { computeHealthScore, classifyStatus } from "./health";
import { createRng, gaussian, round } from "./math";
import { advanceFactory } from "./telemetry";
import type {
  Asset,
  AssetKind,
  Camera,
  CustomerOrder,
  DataSourceKind,
  FactoryState,
  InventoryItem,
  LineCapability,
  MaintenanceRecord,
  Product,
  ProductionLine,
} from "./types";

export const SCHEMA_VERSION = 4;
export const DEMO_SEED = 20261013;

export interface FactoryBlueprint {
  name: string;
  industry: string;
  location: string;
  productionType: string;
  dataSource: DataSourceKind;
  assemblyLines: number; // 1-3 (+ one packaging line)
  assetKinds: AssetKind[]; // machines on each assembly line
  seedIncident: boolean;
  isDemo: boolean;
}

export const DEMO_BLUEPRINT: FactoryBlueprint = {
  name: "Aurora Electronics — Plant 2",
  industry: "Electronics manufacturing",
  location: "Pune, India",
  productionType: "High-mix PCB assembly & packaging",
  dataSource: "demo",
  assemblyLines: 2,
  assetKinds: ["conveyor", "press", "robot", "camera"],
  seedIncident: true,
  isDemo: true,
};

const TEMPLATES = Object.fromEntries(ASSET_KINDS.map((k) => [k, machineTemplate(k)])) as Record<AssetKind, MachineTemplate>;

export { ASSET_KIND_LABEL };

const PRODUCTS: (Product & { bom: { itemId: string; qty: number }[]; rate: number })[] = [
  {
    id: "ECU-200",
    name: "EdgeController ECU-200",
    sku: "ECU-200-IND",
    unitMaterialCost: 42,
    unitPrice: 129,
    inspectionOpportunities: 186,
    rate: 120,
    bom: [
      { itemId: "MCU-7", qty: 1 },
      { itemId: "PCB-E2", qty: 1 },
      { itemId: "CON-24", qty: 2 },
    ],
  },
  {
    id: "SH-40",
    name: "SensorHub SH-40",
    sku: "SH-40-MOD",
    unitMaterialCost: 27,
    unitPrice: 84,
    inspectionOpportunities: 124,
    rate: 110,
    bom: [
      { itemId: "SNS-40", qty: 1 },
      { itemId: "PCB-S4", qty: 1 },
      { itemId: "CON-24", qty: 1 },
    ],
  },
  {
    id: "GW-10",
    name: "Gateway GW-10",
    sku: "GW-10-LTE",
    unitMaterialCost: 35,
    unitPrice: 109,
    inspectionOpportunities: 150,
    rate: 100,
    bom: [
      { itemId: "MCU-7", qty: 1 },
      { itemId: "LTE-M2", qty: 1 },
      { itemId: "CON-24", qty: 1 },
    ],
  },
];

const INVENTORY: InventoryItem[] = [
  {
    id: "MCU-7",
    name: "MCU-7 microcontroller",
    category: "component",
    unit: "pcs",
    onHand: 2900,
    reserved: 0,
    reorderPoint: 1500,
    unitCost: 9.4,
    supplier: "Lumen Semiconductor (demo)",
    leadTimeHours: 72,
    inbound: [{ poId: "PO-7781", qty: 2500, etaHour: 30 }],
    expediteCost: 3800,
    expediteEtaHours: 10,
  },
  {
    id: "PCB-E2",
    name: "ECU-200 PCB substrate",
    category: "raw",
    unit: "pcs",
    onHand: 6200,
    reserved: 0,
    reorderPoint: 2000,
    unitCost: 6.1,
    supplier: "Nordboard Circuits (demo)",
    leadTimeHours: 96,
    inbound: [],
    expediteCost: 2600,
    expediteEtaHours: 18,
  },
  {
    id: "PCB-S4",
    name: "SH-40 PCB substrate",
    category: "raw",
    unit: "pcs",
    onHand: 6000,
    reserved: 0,
    reorderPoint: 1800,
    unitCost: 4.2,
    supplier: "Nordboard Circuits (demo)",
    leadTimeHours: 96,
    inbound: [],
    expediteCost: 2400,
    expediteEtaHours: 18,
  },
  {
    id: "CON-24",
    name: "24-pin board connector",
    category: "component",
    unit: "pcs",
    onHand: 16400,
    reserved: 0,
    reorderPoint: 4000,
    unitCost: 1.2,
    supplier: "Pinwell Interconnect (demo)",
    leadTimeHours: 48,
    inbound: [{ poId: "PO-7786", qty: 8000, etaHour: 38 }],
    expediteCost: 900,
    expediteEtaHours: 12,
  },
  {
    id: "SNS-40",
    name: "MEMS sensor module",
    category: "component",
    unit: "pcs",
    onHand: 4300,
    reserved: 0,
    reorderPoint: 1500,
    unitCost: 7.8,
    supplier: "Kinetiq Sensors (demo)",
    leadTimeHours: 60,
    inbound: [{ poId: "PO-7790", qty: 3000, etaHour: 32 }],
    expediteCost: 2100,
    expediteEtaHours: 14,
  },
  {
    id: "LTE-M2",
    name: "LTE-M radio module",
    category: "component",
    unit: "pcs",
    onHand: 2400,
    reserved: 0,
    reorderPoint: 1200,
    unitCost: 11.5,
    supplier: "Kinetiq Sensors (demo)",
    leadTimeHours: 96,
    inbound: [],
    expediteCost: 2900,
    expediteEtaHours: 20,
  },
  {
    id: "CTN-S",
    name: "Anti-static carton",
    category: "packaging",
    unit: "pcs",
    onHand: 9200,
    reserved: 0,
    reorderPoint: 3000,
    unitCost: 0.65,
    supplier: "Corrupak (demo)",
    leadTimeHours: 24,
    inbound: [{ poId: "PO-7793", qty: 8000, etaHour: 30 }],
    expediteCost: 600,
    expediteEtaHours: 8,
  },
];

const CUSTOMERS = ["Kestrel Robotics", "Halden Energy Systems", "Corvid Medical Devices", "Meridian Mobility", "Brightwater Utilities"];

function makeAsset(kind: AssetKind, lineCode: string, index: number, lineName: string, rng: () => number): Asset {
  const t = TEMPLATES[kind];
  const id = assetIdFor(kind, lineCode, index);
  const jitter = (v: number, pct: number) => round(v * (1 + (rng() - 0.5) * pct), 2);
  const baseline = { vibration: jitter(t.baseline.vibration, 0.08), temperature: jitter(t.baseline.temperature, 0.04) };
  return {
    id,
    name: `${t.label} ${lineCode}${index + 1}`,
    kind,
    lineId: `LINE-${lineCode}`,
    manufacturer: t.manufacturer,
    model: t.model,
    criticality: t.criticality,
    mode: "running",
    speedPct: 100,
    nominalRate: t.nominalRate,
    ratedPowerKw: t.ratedPowerKw,
    idlePowerKw: t.idlePowerKw,
    baseline,
    thresholds: { ...t.thresholds },
    condition: { vibrationExcess: 0, vibrationSlope: 0, temperatureExcess: 0, temperatureSlope: 0, failureMode: null },
    sensors: t.sensors.map((s, i) => ({ ...s, id: `${id}-S${i + 1}` })),
    installedYear: 2019 + Math.floor(rng() * 5),
    lastMaintenanceHour: -Math.round(t.maintenanceIntervalHours * (0.2 + rng() * 0.6)),
    maintenanceIntervalHours: t.maintenanceIntervalHours,
    downUntil: null,
    maintenanceUntil: null,
    signal: { vibration: baseline.vibration, temperature: baseline.temperature, powerKw: t.idlePowerKw, throughput: 0 },
    status: "healthy",
    healthScore: 100,
    utilization: 0,
    documentIds: [],
  };
  void lineName;
}

const DOCS_BY_KIND: Partial<Record<AssetKind, string[]>> = {
  robot: ["ax6-maintenance-manual", "ax6-gearbox-bearing-bulletin"],
  press: ["pf60-press-manual"],
  packager: ["cp280-seal-heater-guide"],
};

/* ───────────────────────────── factory plan ───────────────────────────── */

/** A resolved, engine-ready description of a factory. Built from a blueprint (demo / wizard) or compiled from a TwinSpec. */
export interface PlanMachine {
  kind: AssetKind;
  name?: string;
  nominalRate?: number;
}

export interface PlanLine {
  code: string;
  name: string;
  kind: "assembly" | "packaging";
  machines: PlanMachine[];
  capabilities: LineCapability[];
  allocation: Record<string, number>;
  baseScrapRate: number;
}

export interface PlanOrder {
  productId: string;
  quantity: number;
  dueHour: number;
  priority: CustomerOrder["priority"];
  penaltyPerLateUnit: number;
}

export interface FactoryPlan {
  profile: { name: string; industry: string; location: string; productionType: string; dataSource: DataSourceKind; isDemo: boolean };
  /** Process ("assembly") lines first; an optional packaging line last receives their output. */
  lines: PlanLine[];
  products: Product[];
  inventory: InventoryItem[];
  orders: PlanOrder[];
  /** Rehearsal incident: degradation onset on the first line's most critical machine. */
  seedIncident: boolean;
  /** Mild background wear (packager seal drift, second-line press) that makes the demo realistic. */
  backgroundWear: boolean;
  /** Which acceptance criteria inspection cameras cite. */
  quality: "electronics" | "generic";
  customers?: string[];
}

/** Engine asset id for the machine at `index` on line `lineCode` (stable, used to map spec ids). */
export const assetIdFor = (kind: AssetKind, lineCode: string, index: number) => `${lineCode}-${TEMPLATES[kind].code}-${String(index + 1).padStart(2, "0")}`;

/** The blueprint used by the demo and the template wizard (electronics product library). */
export function planFromBlueprint(blueprint: FactoryBlueprint): FactoryPlan {
  const assemblyCount = Math.max(1, Math.min(3, Math.round(blueprint.assemblyLines)));
  const letters = ["A", "B", "C", "D"];
  const kinds = (blueprint.assetKinds.length ? blueprint.assetKinds : DEMO_BLUEPRINT.assetKinds).filter((k) => k !== "packager" && k !== "labeler");
  const usedProducts = PRODUCTS.slice(0, Math.min(PRODUCTS.length, assemblyCount));
  const lines: PlanLine[] = [];
  for (let li = 0; li < assemblyCount; li++) {
    const primary = usedProducts[li];
    const capabilities: LineCapability[] = [
      { productId: primary.id, ratePerHour: primary.rate, designRatePerHour: Math.round(primary.rate * 1.12), changeoverHours: 0.75, bom: primary.bom.map((b) => ({ ...b })) },
    ];
    // Each line can also build the previous line's product at a reduced rate (tooling-compatible).
    const alt = usedProducts[(li + usedProducts.length - 1) % usedProducts.length];
    if (alt && alt.id !== primary.id) {
      const altRate = Math.round(alt.rate * 0.8);
      capabilities.push({ productId: alt.id, ratePerHour: altRate, designRatePerHour: Math.round(altRate * 1.12), changeoverHours: 0.75, bom: alt.bom.map((b) => ({ ...b })) });
    }
    lines.push({
      code: letters[li],
      name: `Assembly Line ${letters[li]}`,
      kind: "assembly",
      machines: (kinds.length ? kinds : (["robot"] as AssetKind[])).map((kind) => ({ kind })),
      capabilities,
      allocation: { [primary.id]: 1 },
      baseScrapRate: li === 0 ? 0.015 : 0.018,
    });
  }
  const pc = letters[assemblyCount];
  lines.push({
    code: pc,
    name: `Packaging Line ${pc}`,
    kind: "packaging",
    machines: [
      { kind: "conveyor", name: `Merge Conveyor ${pc}1`, nominalRate: 300 },
      { kind: "packager" },
      { kind: "labeler" },
      { kind: "camera", name: `Final Inspection ${pc}4`, nominalRate: 320 },
    ],
    capabilities: usedProducts.map((p) => ({ productId: p.id, ratePerHour: 260, designRatePerHour: 290, changeoverHours: 0, bom: [{ itemId: "CTN-S", qty: 1 }] })),
    allocation: Object.fromEntries(usedProducts.map((p) => [p.id, 1 / usedProducts.length])),
    baseScrapRate: 0.003,
  });

  const itemIds = new Set<string>(["CTN-S"]);
  for (const p of usedProducts) for (const b of p.bom) itemIds.add(b.itemId);
  const inventory = INVENTORY.filter((i) => itemIds.has(i.id)).map((i) => ({ ...i, inbound: i.inbound.map((s) => ({ ...s })) }));

  // Orders: the primary line's product carries the critical, tight-deadline order.
  const orderPlan: { productIdx: number; qtyHours: number; due: number; priority: CustomerOrder["priority"]; penalty: number }[] = [
    { productIdx: 0, qtyHours: 21.7, due: 24, priority: "critical", penalty: 18 },
    { productIdx: 1, qtyHours: 16.4, due: 40, priority: "high", penalty: 8 },
    { productIdx: 0, qtyHours: 7.5, due: 56, priority: "high", penalty: 10 },
    { productIdx: 1, qtyHours: 12.7, due: 64, priority: "standard", penalty: 5 },
    { productIdx: 2, qtyHours: 18, due: 36, priority: "high", penalty: 9 },
  ];
  const orders: PlanOrder[] = [];
  for (const o of orderPlan) {
    const p = usedProducts[o.productIdx];
    if (!p) continue;
    orders.push({ productId: p.id, quantity: Math.round((p.rate * o.qtyHours) / 100) * 100, dueHour: o.due, priority: o.priority, penaltyPerLateUnit: o.penalty });
  }

  return {
    profile: { name: blueprint.name, industry: blueprint.industry, location: blueprint.location, productionType: blueprint.productionType, dataSource: blueprint.dataSource, isDemo: blueprint.isDemo },
    lines,
    products: usedProducts.map(({ id, name, sku, unitMaterialCost, unitPrice, inspectionOpportunities }) => ({ id, name, sku, unitMaterialCost, unitPrice, inspectionOpportunities })),
    inventory,
    orders,
    seedIncident: blueprint.seedIncident,
    backgroundWear: true,
    quality: "electronics",
  };
}

export function buildFactory(blueprint: FactoryBlueprint, anchorISO: string, seed = DEMO_SEED): FactoryState {
  return buildFromPlan(planFromBlueprint(blueprint), anchorISO, seed);
}

export function buildFromPlan(plan: FactoryPlan, anchorISO: string, seed = DEMO_SEED): FactoryState {
  const rng = createRng(seed);
  const lines: ProductionLine[] = [];
  const assets: Asset[] = [];
  const pkgPlan = plan.lines.find((l) => l.kind === "packaging");
  const packagingLineId = pkgPlan ? `LINE-${pkgPlan.code}` : null;

  for (const pl of plan.lines) {
    const lineId = `LINE-${pl.code}`;
    const lineAssets = pl.machines.map((m, i) => {
      const a = makeAsset(m.kind, pl.code, i, pl.name, rng);
      if (m.name) a.name = m.name;
      if (m.nominalRate) a.nominalRate = m.nominalRate;
      a.documentIds = DOCS_BY_KIND[m.kind] ?? [];
      return a;
    });
    assets.push(...lineAssets);
    lines.push({
      id: lineId,
      code: pl.code,
      name: pl.name,
      kind: pl.kind,
      assetIds: lineAssets.map((a) => a.id),
      capabilities: pl.capabilities.map((c) => ({ ...c, bom: c.bom.map((b) => ({ ...b })) })),
      allocation: { ...pl.allocation },
      baseScrapRate: pl.baseScrapRate,
      downstreamLineId: pl.kind === "assembly" ? packagingLineId : null,
      changeoverUntil: null,
      buffer: {},
      state: "running",
    });
  }
  const inventory = plan.inventory.map((i) => ({ ...i, inbound: i.inbound.map((s) => ({ ...s })) }));

  let orderNo = 1042;
  const customers = plan.customers?.length ? plan.customers : CUSTOMERS;
  const orders: CustomerOrder[] = plan.orders.map((o) => ({
    id: `ORD-${orderNo}`,
    customer: customers[(orderNo++ - 1042) % customers.length],
    productId: o.productId,
    quantity: o.quantity,
    fulfilled: 0,
    dueHour: o.dueHour,
    priority: o.priority,
    penaltyPerLateUnit: o.penaltyPerLateUnit,
    completedHour: null,
  }));

  // Maintenance history (past ~6 months)
  const maintenanceHistory: MaintenanceRecord[] = [];
  let mr = 4000;
  const techs = ["R. Iyer", "M. Chen", "S. Okafor", "L. Novak", "A. Haddad"];
  for (const a of assets) {
    const count = 3 + Math.floor(rng() * 2);
    for (let k = 0; k < count; k++) {
      const hour = a.lastMaintenanceHour - k * a.maintenanceIntervalHours * (0.45 + rng() * 0.2);
      const type: MaintenanceRecord["type"] = k === 0 ? "preventive" : rng() < 0.25 ? "inspection" : rng() < 0.15 ? "corrective" : "preventive";
      maintenanceHistory.push({
        id: `MR-${++mr}`,
        assetId: a.id,
        type,
        hour: Math.round(hour),
        durationHours: type === "inspection" ? 1 : type === "corrective" ? 9 : 4 + Math.round(rng() * 3),
        technician: techs[Math.floor(rng() * techs.length)],
        notes:
          type === "inspection"
            ? "Routine condition inspection — no defects found."
            : type === "corrective"
              ? `Corrective repair: ${TEMPLATES[a.kind].failureMode.toLowerCase()}.`
              : "Scheduled PM: lubrication, fastener torque check, sensor calibration.",
        cost: type === "inspection" ? 220 : type === "corrective" ? 14500 : 2600 + Math.round(rng() * 900),
      });
    }
  }
  maintenanceHistory.sort((x, y) => y.hour - x.hour);

  const state: FactoryState = {
    schemaVersion: SCHEMA_VERSION,
    seed,
    profile: {
      id: plan.profile.isDemo ? "demo-plant-2" : `factory-${seed.toString(36)}`,
      name: plan.profile.name,
      industry: plan.profile.industry,
      location: plan.profile.location,
      productionType: plan.profile.productionType,
      dataSource: plan.profile.dataSource,
      createdAt: anchorISO,
      isDemo: plan.profile.isDemo,
    },
    clock: { hour: -24, tick: 0, anchorISO, liveTelemetry: true, lastTickAt: 0, lastHistoryHour: -24 },
    lines,
    assets,
    connections: [],
    products: plan.products.map((p) => ({ ...p })),
    inventory,
    orders: [],
    telemetry: Object.fromEntries(assets.map((a) => [a.id, []])),
    latest: {},
    healthHistory: {},
    production: [],
    finishedGoods: {},
    maintenanceHistory,
    workOrders: [],
    directives: [],
    incidents: [],
    analyses: [],
    scenarioRuns: [],
    recommendations: [],
    cameras: buildCameras(lines, assets, plan.quality),
    visionReviews: [],
    audit: [],
    costModel: { ...DEFAULT_COST_MODEL },
    counters: {},
  };

  // Seed incident: degradation onset on the first line's robot (or its most critical machine).
  const firstLine = lines[0];
  const target =
    assets.find((a) => a.lineId === firstLine.id && a.kind === "robot") ??
    assets.find((a) => a.lineId === firstLine.id && a.criticality === "A") ??
    assets.find((a) => a.lineId === firstLine.id);
  if (plan.backgroundWear) {
    const packer = assets.find((a) => a.lineId === packagingLineId && a.kind === "packager");
    if (packer) {
      packer.condition.temperatureExcess = 2;
      packer.condition.temperatureSlope = 0.11;
      packer.condition.failureMode = TEMPLATES.packager.failureMode;
    }
    const secondPress = assets.find((a) => a.lineId === lines[1]?.id && a.kind === "press");
    if (secondPress) secondPress.condition.vibrationExcess = 0.5;
  }
  if (target && plan.seedIncident) {
    target.lastMaintenanceHour = -(target.maintenanceIntervalHours + 52);
  }

  // Inventory during pre-history is abundant; actual stock levels are set at t0.
  const t0Inventory = inventory.map((i) => ({ onHand: i.onHand }));
  for (const i of state.inventory) i.onHand = 1e6;
  for (const a of state.assets) a.signal.powerKw = a.idlePowerKw;

  const onsetHour = -16;
  let onsetApplied = false;
  advanceFactory(state, 24, {
    nowISO: anchorISO,
    recordEvents: false,
    beforeStep: (world) => {
      if (!onsetApplied && target && plan.seedIncident && world.hour >= onsetHour - 1e-9) {
        const m = world.machines[target.id];
        m.vibSlope = 0.22;
        m.tempSlope = 0.25;
        m.failureMode = TEMPLATES[target.kind].failureMode;
        onsetApplied = true;
      }
    },
  });

  // t0: open order book, actual stock levels, empty finished goods.
  state.clock.hour = 0;
  state.inventory.forEach((i, idx) => (i.onHand = t0Inventory[idx].onHand));
  state.orders = orders;
  state.finishedGoods = Object.fromEntries(plan.products.map((p) => [p.id, 0]));

  // 30-day daily health history (seeded, consistent with today's condition).
  for (const a of state.assets) {
    const today = a.healthScore;
    const series: { day: number; score: number }[] = [];
    for (let d = -29; d <= 0; d++) {
      const noise = gaussian(seed, `${a.id}:hh:${d}`) * 1.2;
      let score: number;
      if (a.id === target?.id && plan.seedIncident) {
        score = d >= -1 ? today + (d === -1 ? 14 : 0) : 94 - (29 + d) * 0.18 + noise;
      } else {
        score = Math.min(99.5, today + (-d) * 0.04 + noise);
      }
      series.push({ day: d, score: round(Math.max(0, Math.min(100, d === 0 ? today : score)), 1) });
    }
    state.healthHistory[a.id] = series;
  }

  // Make derived status consistent with smoothed signals.
  for (const a of state.assets) {
    a.healthScore = computeHealthScore(a.signal.vibration, a.signal.temperature, a.baseline, a.thresholds);
    a.status = classifyStatus(a.mode, a.signal.vibration, a.signal.temperature, a.healthScore, a.thresholds);
  }

  // Seeded open incident for the degrading asset.
  if (target && plan.seedIncident) {
    state.incidents.push({
      id: "INC-2041",
      assetId: target.id,
      title: `${target.name} — rising vibration trend`,
      severity: target.status === "critical" ? "critical" : "warning",
      status: "open",
      openedHour: -3.5,
      resolvedHour: null,
      source: "telemetry",
      summary: `Vibration up from ${target.baseline.vibration.toFixed(1)} to ${target.signal.vibration.toFixed(1)} mm/s over the last shift; joint temperature trending up. Preventive maintenance is ${Math.round(-target.lastMaintenanceHour - target.maintenanceIntervalHours)} h overdue.`,
    });
    state.counters["INC"] = 2041;
  }

  state.audit = [];
  if (target && plan.seedIncident) {
    state.audit.push({
      id: "EVT-10001",
      hour: -3.5,
      at: anchorISO,
      category: "telemetry-alert",
      actor: "Telemetry monitor",
      title: `${target.id} vibration trend alert`,
      detail: `Incident INC-2041 opened: ${target.name} vibration ${target.signal.vibration.toFixed(2)} mm/s (baseline ${target.baseline.vibration}).`,
      severity: "warning",
      refs: { assetIds: [target.id], incidentId: "INC-2041" },
    });
  }
  state.audit.unshift({
    id: "EVT-10002",
    hour: 0,
    at: anchorISO,
    category: "system",
    actor: "System",
    title: plan.profile.isDemo ? "Demo factory loaded" : "Digital twin created",
    detail: `${plan.profile.name}: ${state.lines.length} lines, ${state.assets.length} assets, ${state.orders.length} open orders. Data source: ${plan.profile.dataSource === "demo" ? "simulated demo telemetry" : plan.profile.dataSource.toUpperCase() + " selected (not connected — simulated telemetry in use)"}.`,
    severity: "info",
    refs: {},
  });
  state.counters["EVT"] = 10002;
  state.clock.lastTickAt = 0;
  return state;
}

/**
 * Camera layout for any generated factory: an area CCTV per line, the AOI / final-inspection
 * stations as vision cameras, a radiometric thermal camera on the first robot cell, and
 * dock / stores cameras. Inspection placement follows IPC-A-610 practice: inspect after every
 * step that can introduce a defect, and verify labels/barcodes at final pack-out.
 */
function buildCameras(lines: ProductionLine[], assets: Asset[], quality: FactoryPlan["quality"] = "electronics"): Camera[] {
  const cams: Camera[] = [];
  const privacy = { faceBlur: true, retentionDays: 30 };
  for (const l of lines) {
    cams.push({
      id: `CCTV-${l.code}1`,
      name: `${l.name} overview`,
      kind: "area",
      purpose: "Line overview: unit counting, line state and lock-out zone monitoring",
      standard: "ONVIF Profile S stream · advisory analytics only (not a safety function)",
      zone: l.name,
      lineId: l.id,
      assetId: null,
      covers: [...l.assetIds],
      analytics: ["counting", "line-state", "zone"],
      resolution: "1920×1080",
      fps: 15,
      onvifProfile: "S",
      stream: { kind: "simulated", url: null },
      privacy,
    });
    for (const a of assets.filter((x) => x.lineId === l.id && x.kind === "camera")) {
      const pack = l.kind === "packaging";
      cams.push({
        id: `VIS-${a.id}`,
        name: pack ? `${a.name} (pack-out verification)` : quality === "electronics" ? `${a.name} (post-placement AOI)` : `${a.name} (inline inspection)`,
        kind: "inspection",
        purpose: pack
          ? "100% final inspection: label OCR, barcode grade, carton seal and count"
          : quality === "electronics"
            ? "100% automated optical inspection after placement and press-fit"
            : "100% inline inspection of the line's output against the product specification",
        standard: pack
          ? "ISO/IEC 15416 / 15415 barcode print quality · label & seal criteria"
          : quality === "electronics"
            ? "IPC-A-610J Class 2 acceptance · J-STD-001 soldering requirements"
            : "Product specification and visual inspection standard (site-defined)",
        zone: l.name,
        lineId: l.id,
        assetId: a.id,
        covers: [a.id],
        analytics: pack ? ["defects", "ocr-barcode"] : ["defects"],
        resolution: "12 MP",
        fps: 30,
        onvifProfile: "T",
        stream: { kind: "simulated", url: null },
        privacy: { faceBlur: false, retentionDays: 90 },
      });
    }
  }
  // Thermal camera on the first process line's hottest-running critical cell (the robot cell in the demo).
  const firstAssembly = lines.find((l) => l.kind === "assembly");
  const hot = (a: Asset) => a.kind !== "camera" && a.sensors.some((x) => x.kind === "temperature");
  const lineAssets = assets.filter((a) => a.lineId === firstAssembly?.id);
  const focus = lineAssets.find((a) => a.kind === "robot") ?? lineAssets.find((a) => a.criticality === "A" && hot(a)) ?? lineAssets.find(hot);
  if (firstAssembly && focus) {
    const covers = focus.kind === "robot" ? lineAssets.filter((a) => a.kind === "robot" || a.kind === "press") : lineAssets.filter(hot).slice(0, 3);
    cams.push({
      id: `THM-${firstAssembly.code}1`,
      name: `${firstAssembly.name} ${focus.kind === "robot" ? "robot" : ARCHETYPES[focus.kind].name.toLowerCase()} cell (thermal)`,
      kind: "thermal",
      purpose: "Radiometric thermography of drive trains and motors — early warning for friction and overheating",
      standard: "ISO 18434-1 condition-monitoring thermography",
      zone: firstAssembly.name,
      lineId: firstAssembly.id,
      assetId: null,
      covers: covers.map((a) => a.id),
      analytics: ["thermal"],
      resolution: "640×480 radiometric",
      fps: 9,
      onvifProfile: "S",
      stream: { kind: "simulated", url: null },
      privacy: { faceBlur: false, retentionDays: 30 },
    });
  }
  cams.push(
    {
      id: "CCTV-DOCK",
      name: "Shipping dock",
      kind: "dock",
      purpose: "Dock occupancy and truck loading progress",
      standard: "ONVIF Profile S stream · advisory analytics only",
      zone: "Shipping dock",
      lineId: null,
      assetId: null,
      covers: [],
      analytics: ["occupancy", "counting"],
      resolution: "1920×1080",
      fps: 15,
      onvifProfile: "S",
      stream: { kind: "simulated", url: null },
      privacy,
    },
    {
      id: "CCTV-STORES",
      name: "Component stores",
      kind: "area",
      purpose: "Rack occupancy and restricted-zone access for component stores",
      standard: "ONVIF Profile S stream · advisory analytics only",
      zone: "Component stores",
      lineId: null,
      assetId: null,
      covers: [],
      analytics: ["occupancy", "zone"],
      resolution: "1920×1080",
      fps: 15,
      onvifProfile: "S",
      stream: { kind: "simulated", url: null },
      privacy,
    },
  );
  return cams;
}

/** Seed for a newly created factory's simulated noise (changes every second). */
export const newFactorySeed = (nowMs = Date.now()) => Math.floor(nowMs / 1000) % 2147483647;

/** Anchor demo time at the top of the current hour so the "shift clock" reads naturally. */
export function defaultAnchor(now = new Date()) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

export function buildDemoFactory(anchorISO = defaultAnchor()) {
  return buildFactory(DEMO_BLUEPRINT, anchorISO, DEMO_SEED);
}
