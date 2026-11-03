/**
 * Plant model — the physics of the digital twin.
 *
 * `stepWorld` advances a `SimWorld` by `dt` hours: it applies scheduled directives
 * (maintenance, line re-allocation, speed changes), receives inbound inventory,
 * wears machines, produces and packages units subject to material constraints,
 * meters energy and allocates finished goods to customer orders.
 *
 * The SAME function powers the live factory (small dt + measurement noise) and the
 * What-If simulator (dt = 0.25 h, noise-free, estimated machine condition). This is
 * what keeps dashboards, forecasts and scenarios mutually consistent.
 */
import { PRIORITY_RANK, POWER_PER_VIB_EXCESS, TEMP_PER_VIB_EXCESS } from "./constants";
import { scrapContribution } from "./health";
import type {
  AssetKind,
  Directive,
  FactoryState,
  InboundShipment,
  LineCapability,
  LineState,
  MachineMode,
  OrderPriority,
  PlantRule,
  RuleRuntime,
  Thresholds,
  TimelineEvent,
} from "./types";

export interface MachineSim {
  id: string;
  name: string;
  lineId: string;
  kind: AssetKind;
  mode: MachineMode;
  speedPct: number;
  nominalRate: number;
  ratedPowerKw: number;
  idlePowerKw: number;
  baseVibration: number;
  baseTemperature: number;
  vibExcess: number;
  vibSlope: number;
  tempDrift: number;
  tempSlope: number;
  thresholds: Thresholds;
  downUntil: number | null;
  maintenanceUntil: number | null;
  failureMode: string | null;
  alarmed: boolean;
  // last-step outputs
  productiveFraction: number;
  throughput: number;
  powerKw: number;
  // accumulators
  plannedDownHours: number;
  unplannedDownHours: number;
  failures: number;
  maintenanceCompleted: number;
}

export interface LineSim {
  id: string;
  name: string;
  kind: "assembly" | "packaging";
  machineIds: string[];
  capabilities: Record<string, LineCapability>;
  allocation: Record<string, number>;
  baseScrapRate: number;
  downstreamLineId: string | null;
  changeoverUntil: number | null;
  buffer: Record<string, number>;
  state: LineState;
  throughput: number; // good units/hour last step
}

export interface LineAcc {
  plannedHours: number;
  runHours: number;
  plannedDownHours: number;
  unplannedDownHours: number;
  changeoverHours: number;
  starvedHours: number;
  idealUnits: number;
  goodUnits: number;
  scrapUnits: number;
  targetUnits: number;
  energyKwh: number;
  idleEnergyKwh: number;
  scrapByCause: Record<string, number>;
}

export interface WorldOrder {
  id: string;
  customer: string;
  productId: string;
  quantity: number;
  fulfilled: number;
  dueHour: number;
  priority: OrderPriority;
  penaltyPerLateUnit: number;
  completedHour: number | null;
  fulfilledAtDue: number | null;
}

export interface WorldEvent extends TimelineEvent {
  directiveId?: string;
  orderId?: string;
  itemId?: string;
  ruleId?: string;
}

export interface SimWorld {
  hour: number;
  machineOrder: string[];
  machines: Record<string, MachineSim>;
  lineOrder: string[];
  lines: Record<string, LineSim>;
  inventory: Record<string, { name: string; onHand: number; inbound: InboundShipment[]; stockedOut: boolean }>;
  finishedGoods: Record<string, number>;
  orders: WorldOrder[];
  directives: Directive[];
  params: { idlePowerFactor: number; unplannedRepairHours: number; ambient: number };
  acc: Record<string, LineAcc>;
  producedByProduct: Record<string, number>; // packaged good units
  scrapByProduct: Record<string, number>;
  changeovers: number;
  events: WorldEvent[];
  /** Playground automation rules that act inside the plant model (inventory and connector rules). */
  rules?: PlantRule[];
  ruleRuntime?: RuleRuntime;
}

const EPS = 1e-9;

/** Carton-seal defects rise once a packer's seal-heater temperature drifts past 85% of its alarm limit. */
function sealContribution(m: MachineSim) {
  if (m.kind !== "packager") return 0;
  const t = machineTemperature(m);
  return Math.max(0, t - m.thresholds.temperatureAlarm * 0.85) * 0.004;
}

export const emptyAcc = (): LineAcc => ({
  plannedHours: 0,
  runHours: 0,
  plannedDownHours: 0,
  unplannedDownHours: 0,
  changeoverHours: 0,
  starvedHours: 0,
  idealUnits: 0,
  goodUnits: 0,
  scrapUnits: 0,
  targetUnits: 0,
  energyKwh: 0,
  idleEnergyKwh: 0,
  scrapByCause: {},
});

/** Split scrap between the baseline process and each machine's vibration-driven contribution. */
function attributeScrap(acc: LineAcc, scrap: number, base: number, parts: [string, number][]) {
  const total = base + parts.reduce((x, [, v]) => x + v, 0);
  if (scrap <= 0 || total <= 0) return;
  acc.scrapByCause.process = (acc.scrapByCause.process ?? 0) + (scrap * base) / total;
  for (const [id, v] of parts) if (v > 0) acc.scrapByCause[id] = (acc.scrapByCause[id] ?? 0) + (scrap * v) / total;
}

/** Structural vibration severity (mm/s) at operating load — what a vibration probe reads while producing. */
export const machineVibration = (m: MachineSim) => m.baseVibration + m.vibExcess;
/** Operating temperature at load (°C). */
export const machineTemperature = (m: MachineSim) => m.baseTemperature + TEMP_PER_VIB_EXCESS * m.vibExcess + m.tempDrift;

export function worldFromState(state: FactoryState): SimWorld {
  const machines: Record<string, MachineSim> = {};
  for (const a of state.assets) {
    machines[a.id] = {
      id: a.id,
      name: a.name,
      lineId: a.lineId,
      kind: a.kind,
      mode: a.mode,
      speedPct: a.speedPct,
      nominalRate: a.nominalRate,
      ratedPowerKw: a.ratedPowerKw,
      idlePowerKw: a.idlePowerKw,
      baseVibration: a.baseline.vibration,
      baseTemperature: a.baseline.temperature,
      vibExcess: a.condition.vibrationExcess,
      vibSlope: a.condition.vibrationSlope,
      tempDrift: a.condition.temperatureExcess,
      tempSlope: a.condition.temperatureSlope,
      thresholds: { ...a.thresholds },
      downUntil: a.downUntil,
      maintenanceUntil: a.maintenanceUntil,
      failureMode: a.condition.failureMode,
      alarmed: a.status === "critical" || a.status === "offline",
      productiveFraction: 0,
      throughput: 0,
      powerKw: 0,
      plannedDownHours: 0,
      unplannedDownHours: 0,
      failures: 0,
      maintenanceCompleted: 0,
    };
  }
  const lines: Record<string, LineSim> = {};
  for (const l of state.lines) {
    lines[l.id] = {
      id: l.id,
      name: l.name,
      kind: l.kind,
      machineIds: l.assetIds.filter((id) => machines[id]),
      capabilities: Object.fromEntries(l.capabilities.map((c) => [c.productId, { ...c, bom: c.bom.map((b) => ({ ...b })) }])),
      allocation: { ...l.allocation },
      baseScrapRate: l.baseScrapRate,
      downstreamLineId: l.downstreamLineId,
      changeoverUntil: l.changeoverUntil,
      buffer: { ...l.buffer },
      state: l.state,
      throughput: 0,
    };
  }
  return {
    hour: state.clock.hour,
    machineOrder: state.assets.map((a) => a.id),
    machines,
    lineOrder: [...state.lines.filter((l) => l.kind === "assembly"), ...state.lines.filter((l) => l.kind === "packaging")].map(
      (l) => l.id,
    ),
    lines,
    inventory: Object.fromEntries(
      // An item that is already empty was reported when it ran out; don't report it again on every tick.
      state.inventory.map((i) => [i.id, { name: i.name, onHand: i.onHand, inbound: i.inbound.map((s) => ({ ...s })), stockedOut: i.onHand <= EPS }]),
    ),
    finishedGoods: { ...state.finishedGoods },
    orders: state.orders.map((o) => ({ ...o, fulfilledAtDue: o.completedHour !== null || o.dueHour > state.clock.hour ? null : o.fulfilled })),
    directives: state.directives.map((d) => ({ ...d }) as Directive),
    params: {
      idlePowerFactor: state.costModel.idlePowerFactor,
      unplannedRepairHours: state.costModel.unplannedRepairHours,
      ambient: state.costModel.ambientTemperature,
    },
    acc: Object.fromEntries(state.lines.map((l) => [l.id, emptyAcc()])),
    producedByProduct: {},
    scrapByProduct: {},
    changeovers: 0,
    events: [],
    ...(state.rules?.length ? { rules: state.rules, ruleRuntime: structuredClone(state.ruleRuntime ?? { seq: 0, rules: {} }) } : {}),
  };
}

function emit(world: SimWorld, e: WorldEvent) {
  world.events.push(e);
}

function restoreCondition(m: MachineSim) {
  m.vibExcess = 0;
  m.vibSlope = 0;
  m.tempDrift = 0;
  m.tempSlope = 0;
  m.failureMode = null;
  m.alarmed = false;
}

function changeoverHoursFor(line: LineSim, from: Record<string, number>, to: Record<string, number>) {
  let h = 0;
  for (const [pid, share] of Object.entries(to)) {
    if (share > 0 && !((from[pid] ?? 0) > 0)) h = Math.max(h, line.capabilities[pid]?.changeoverHours ?? 0);
  }
  for (const [pid, share] of Object.entries(from)) {
    if (share > 0 && !((to[pid] ?? 0) > 0)) h = Math.max(h, line.capabilities[pid]?.changeoverHours ?? 0);
  }
  return h;
}

function setAllocation(world: SimWorld, line: LineSim, allocation: Record<string, number>) {
  const co = changeoverHoursFor(line, line.allocation, allocation);
  line.allocation = { ...allocation };
  if (co > 0) {
    line.changeoverUntil = world.hour + co;
    world.changeovers += 1;
    emit(world, {
      hour: world.hour,
      kind: "changeover",
      label: `${line.name} changeover (${Math.round(co * 60)} min)`,
      lineId: line.id,
      severity: "info",
    });
  }
}

function applyDirectives(world: SimWorld) {
  const h = world.hour + EPS;
  for (const d of world.directives) {
    if (d.status === "cancelled" || d.status === "completed") continue;
    if (d.kind === "maintenance") {
      const m = world.machines[d.assetId];
      if (!m) continue;
      if (d.status === "scheduled" && d.startHour <= h) {
        const remainingRepair = m.mode === "down" && m.downUntil !== null ? m.downUntil - world.hour : 0;
        m.mode = "maintenance";
        m.downUntil = null;
        m.maintenanceUntil = world.hour + Math.max(d.durationHours, remainingRepair);
        d.status = "active";
        emit(world, {
          hour: world.hour,
          kind: "maintenance-start",
          label: `Preventive maintenance started on ${m.name}`,
          assetId: m.id,
          lineId: m.lineId,
          severity: "info",
          directiveId: d.id,
        });
      }
    } else if (d.kind === "allocation") {
      const line = world.lines[d.lineId];
      if (!line) continue;
      if (d.status === "scheduled" && d.startHour <= h) {
        setAllocation(world, line, d.allocation);
        d.status = "active";
        emit(world, {
          hour: world.hour,
          kind: "reroute-start",
          label: `${line.name} re-allocated: ${describeAllocation(d.allocation)}`,
          lineId: line.id,
          severity: "info",
          directiveId: d.id,
        });
      } else if (d.status === "active" && d.endHour !== null && d.endHour <= h) {
        setAllocation(world, line, d.revertAllocation);
        d.status = "completed";
        emit(world, {
          hour: world.hour,
          kind: "reroute-end",
          label: `${line.name} returned to ${describeAllocation(d.revertAllocation)}`,
          lineId: line.id,
          severity: "info",
          directiveId: d.id,
        });
      }
    } else if (d.kind === "speed") {
      const m = world.machines[d.assetId];
      if (!m) continue;
      if (d.status === "scheduled" && d.startHour <= h) {
        m.speedPct = d.speedPct;
        d.status = "active";
      } else if (d.status === "active" && d.endHour !== null && d.endHour <= h) {
        m.speedPct = d.revertSpeedPct;
        d.status = "completed";
      }
    }
  }
}

export function describeAllocation(a: Record<string, number>) {
  return Object.entries(a)
    .filter(([, s]) => s > 0)
    .map(([p, s]) => `${p} ${Math.round(s * 100)}%`)
    .join(" · ");
}

function receiveInbound(world: SimWorld) {
  for (const [id, item] of Object.entries(world.inventory)) {
    const arrived = item.inbound.filter((s) => s.etaHour <= world.hour + EPS);
    if (!arrived.length) continue;
    for (const s of arrived) {
      item.onHand += s.qty;
      emit(world, {
        hour: world.hour,
        kind: "inbound",
        label: `${s.poId}: ${s.qty.toLocaleString("en-US")} × ${item.name} received`,
        severity: "info",
        itemId: id,
      });
    }
    item.inbound = item.inbound.filter((s) => s.etaHour > world.hour + EPS);
    item.stockedOut = false;
  }
}

function updateMachineModes(world: SimWorld) {
  for (const id of world.machineOrder) {
    const m = world.machines[id];
    if (m.mode === "maintenance" && m.maintenanceUntil !== null && m.maintenanceUntil <= world.hour + EPS) {
      m.mode = "running";
      m.maintenanceUntil = null;
      restoreCondition(m);
      m.maintenanceCompleted += 1;
      for (const d of world.directives) {
        if (d.kind === "maintenance" && d.assetId === m.id && d.status === "active") d.status = "completed";
      }
      emit(world, {
        hour: world.hour,
        kind: "maintenance-end",
        label: `${m.name} returned to service — condition restored`,
        assetId: m.id,
        lineId: m.lineId,
        severity: "success",
      });
    }
    if (m.mode === "down" && m.downUntil !== null && m.downUntil <= world.hour + EPS) {
      m.mode = "running";
      m.downUntil = null;
      restoreCondition(m);
      emit(world, {
        hour: world.hour,
        kind: "repair-complete",
        label: `${m.name} corrective repair complete`,
        assetId: m.id,
        lineId: m.lineId,
        severity: "success",
      });
    }
  }
}

function lineStateFor(world: SimWorld, line: LineSim): LineState {
  const ms = line.machineIds.map((id) => world.machines[id]);
  if (ms.some((m) => m.mode === "down")) return "down";
  if (ms.some((m) => m.mode === "maintenance")) return "maintenance";
  if (line.changeoverUntil !== null && world.hour + EPS < line.changeoverUntil) return "changeover";
  if (!ms.length) return "idle";
  return "running";
}

function consumeMaterials(world: SimWorld, bom: { itemId: string; qty: number }[], requested: number) {
  let possible = requested;
  for (const b of bom) {
    const item = world.inventory[b.itemId];
    if (!item || b.qty <= 0) continue;
    possible = Math.min(possible, Math.max(0, item.onHand) / b.qty);
  }
  possible = Math.max(0, possible);
  for (const b of bom) {
    const item = world.inventory[b.itemId];
    if (!item) continue;
    item.onHand = Math.max(0, item.onHand - possible * b.qty);
    if (possible < requested - EPS && item.onHand <= b.qty && !item.stockedOut) {
      item.stockedOut = true;
      emit(world, {
        hour: world.hour,
        kind: "stockout",
        label: `${item.name} exhausted — production constrained`,
        severity: "critical",
        itemId: b.itemId,
      });
    }
  }
  return possible;
}

function meterMachines(world: SimWorld, line: LineSim, dt: number, productiveFraction: number, lineThroughput: number, state: LineState) {
  const acc = world.acc[line.id];
  const idleFactor = world.params.idlePowerFactor;
  for (const id of line.machineIds) {
    const m = world.machines[id];
    let power = 0;
    let idleEnergy = 0;
    let pf = 0;
    if (m.mode === "maintenance") {
      power = 0; // lockout / tagout
      m.plannedDownHours += dt;
    } else if (m.mode === "down") {
      power = m.idlePowerKw * 0.5; // controls energised, drives off
      idleEnergy = power * dt;
      m.unplannedDownHours += dt;
    } else {
      pf = state === "running" || state === "starved" ? productiveFraction : 0;
      const activePower = m.idlePowerKw + (m.ratedPowerKw - m.idlePowerKw) * (m.speedPct / 100) + m.ratedPowerKw * POWER_PER_VIB_EXCESS * m.vibExcess;
      const idlePower = m.idlePowerKw * idleFactor;
      power = pf * activePower + (1 - pf) * idlePower;
      idleEnergy = (1 - pf) * idlePower * dt;
    }
    m.productiveFraction = pf;
    m.throughput = lineThroughput;
    m.powerKw = power;
    acc.energyKwh += power * dt;
    acc.idleEnergyKwh += idleEnergy;

    // Wear accumulates only while producing.
    if (m.mode === "running" && pf > 0) {
      const s = m.speedPct / 100;
      m.vibExcess += m.vibSlope * s * s * dt * pf;
      m.tempDrift += m.tempSlope * s * dt * pf;
    }
  }
}

function checkFailures(world: SimWorld) {
  for (const id of world.machineOrder) {
    const m = world.machines[id];
    if (m.mode !== "running") continue;
    const v = machineVibration(m);
    const t = machineTemperature(m);
    if (!m.alarmed && (v >= m.thresholds.vibrationAlarm || t >= m.thresholds.temperatureAlarm)) {
      m.alarmed = true;
      emit(world, {
        hour: world.hour,
        kind: "alarm",
        label: `${m.name} crossed alarm threshold (${v.toFixed(1)} mm/s, ${t.toFixed(0)} °C)`,
        assetId: m.id,
        lineId: m.lineId,
        severity: "warning",
      });
    }
    if (v >= m.thresholds.vibrationTrip || t >= m.thresholds.temperatureTrip) {
      m.mode = "down";
      m.downUntil = world.hour + world.params.unplannedRepairHours;
      m.failures += 1;
      emit(world, {
        hour: world.hour,
        kind: "failure",
        label: `${m.name} tripped — ${m.failureMode ?? "protective trip"} (${v.toFixed(1)} mm/s, ${t.toFixed(0)} °C)`,
        assetId: m.id,
        lineId: m.lineId,
        severity: "critical",
      });
    }
  }
}

function produceAssembly(world: SimWorld, line: LineSim, dt: number) {
  const acc = world.acc[line.id];
  const state = lineStateFor(world, line);
  const ms = line.machineIds.map((id) => world.machines[id]);
  const plannedRate = Object.entries(line.allocation).reduce((s, [pid, share]) => s + (line.capabilities[pid]?.ratePerHour ?? 0) * share, 0);
  acc.plannedHours += dt;
  acc.targetUnits += plannedRate * dt;

  if (state !== "running") {
    line.state = state;
    line.throughput = 0;
    if (state === "down") acc.unplannedDownHours += dt;
    else if (state === "maintenance") acc.plannedDownHours += dt;
    else if (state === "changeover") acc.changeoverHours += dt;
    meterMachines(world, line, dt, 0, 0, state);
    return;
  }

  const speedFactor = Math.min(...ms.map((m) => m.speedPct)) / 100;
  if (speedFactor <= EPS) {
    // Held at zero speed (a rule paused it): no output, counted as an external stop.
    line.state = "idle";
    line.throughput = 0;
    acc.starvedHours += dt;
    meterMachines(world, line, dt, 0, 0, "idle");
    return;
  }
  const machineCap = Math.min(...ms.map((m) => m.nominalRate * (m.speedPct / 100)));
  const contributions: [string, number][] = ms.map((m) => [m.id, scrapContribution(machineVibration(m), m.thresholds)]);
  const scrapRate = Math.min(0.6, line.baseScrapRate + contributions.reduce((x, [, v]) => x + v, 0));

  let started = 0;
  let attempted = 0;
  let good = 0;
  for (const [pid, share] of Object.entries(line.allocation)) {
    const cap = line.capabilities[pid];
    if (!cap || share <= 0) continue;
    const rate = Math.min(cap.ratePerHour * speedFactor, machineCap) * share;
    const want = rate * dt;
    attempted += want;
    const got = consumeMaterials(world, cap.bom, want);
    acc.idealUnits += want > 0 ? (cap.designRatePerHour ?? cap.ratePerHour) * share * dt * (got / want) : 0;
    started += got;
    const g = got * (1 - scrapRate);
    const s = got * scrapRate;
    good += g;
    acc.goodUnits += g;
    acc.scrapUnits += s;
    attributeScrap(acc, s, line.baseScrapRate, contributions);
    world.scrapByProduct[pid] = (world.scrapByProduct[pid] ?? 0) + s;
    if (line.downstreamLineId && world.lines[line.downstreamLineId]) {
      const dl = world.lines[line.downstreamLineId];
      dl.buffer[pid] = (dl.buffer[pid] ?? 0) + g;
    } else {
      world.finishedGoods[pid] = (world.finishedGoods[pid] ?? 0) + g;
      world.producedByProduct[pid] = (world.producedByProduct[pid] ?? 0) + g;
    }
  }
  const pf = attempted > 0 ? started / attempted : 0;
  line.state = pf < 0.98 ? "starved" : "running";
  line.throughput = good / dt;
  acc.runHours += dt * pf;
  acc.starvedHours += dt * (1 - pf);
  // Machines in series all see the line throughput; load relative to their own nominal rate.
  meterMachines(world, line, dt, pf, started / dt, line.state);
}

function producePackaging(world: SimWorld, line: LineSim, dt: number) {
  const acc = world.acc[line.id];
  const state = lineStateFor(world, line);
  const ms = line.machineIds.map((id) => world.machines[id]);
  const caps = Object.values(line.capabilities);
  const baseRate = caps.length ? Math.max(...caps.map((c) => c.ratePerHour)) : 0;
  const designRate = caps.length ? Math.max(...caps.map((c) => c.designRatePerHour ?? c.ratePerHour)) : 0;
  const upstreamTarget = world.lineOrder
    .map((id) => world.lines[id])
    .filter((l) => l.downstreamLineId === line.id)
    .reduce((s, l) => s + Object.entries(l.allocation).reduce((x, [pid, sh]) => x + (l.capabilities[pid]?.ratePerHour ?? 0) * sh, 0), 0);
  acc.plannedHours += dt;
  acc.targetUnits += Math.min(baseRate, upstreamTarget) * dt;

  if (state !== "running") {
    line.state = state;
    line.throughput = 0;
    if (state === "down") acc.unplannedDownHours += dt;
    else if (state === "maintenance") acc.plannedDownHours += dt;
    else if (state === "changeover") acc.changeoverHours += dt;
    meterMachines(world, line, dt, 0, 0, state);
    return;
  }

  const speedFactor = Math.min(...ms.map((m) => m.speedPct)) / 100;
  const machineCap = Math.min(...ms.map((m) => m.nominalRate * (m.speedPct / 100)));
  const capacity = Math.min(baseRate * speedFactor, machineCap) * dt;
  const totalBuffer = Object.values(line.buffer).reduce((a, b) => a + b, 0);
  const contributions: [string, number][] = ms.map((m) => [m.id, scrapContribution(machineVibration(m), m.thresholds) * 0.5 + sealContribution(m)]);
  const scrapRate = Math.min(0.5, line.baseScrapRate + contributions.reduce((x, [, v]) => x + v, 0));
  let processed = 0;
  let good = 0;
  if (totalBuffer > EPS && capacity > 0) {
    const take = Math.min(capacity, totalBuffer);
    for (const [pid, qty] of Object.entries(line.buffer)) {
      if (qty <= EPS) continue;
      const want = take * (qty / totalBuffer);
      const cap = line.capabilities[pid];
      const got = cap ? consumeMaterials(world, cap.bom, want) : want;
      line.buffer[pid] = qty - got;
      const g = got * (1 - scrapRate);
      const s = got * scrapRate;
      processed += got;
      good += g;
      acc.goodUnits += g;
      acc.scrapUnits += s;
      attributeScrap(acc, s, line.baseScrapRate, contributions);
      world.scrapByProduct[pid] = (world.scrapByProduct[pid] ?? 0) + s;
      world.finishedGoods[pid] = (world.finishedGoods[pid] ?? 0) + g;
      world.producedByProduct[pid] = (world.producedByProduct[pid] ?? 0) + g;
    }
  }
  const pf = capacity > 0 ? processed / capacity : 0;
  line.state = pf < 0.5 ? "starved" : "running";
  line.throughput = good / dt;
  acc.runHours += dt * pf;
  acc.starvedHours += dt * (1 - pf);
  // Starvation is an availability loss; performance is measured against nameplate rate while running.
  acc.idealUnits += designRate * dt * pf;
  meterMachines(world, line, dt, pf, processed / dt, line.state);
}

function allocateOrders(world: SimWorld) {
  const open = world.orders
    .filter((o) => o.completedHour === null)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.dueHour - b.dueHour);
  for (const o of open) {
    const avail = world.finishedGoods[o.productId] ?? 0;
    if (avail <= EPS) continue;
    const take = Math.min(avail, o.quantity - o.fulfilled);
    o.fulfilled += take;
    world.finishedGoods[o.productId] = avail - take;
    if (o.fulfilled >= o.quantity - 0.5) {
      o.fulfilled = o.quantity;
      o.completedHour = world.hour;
      emit(world, {
        hour: world.hour,
        kind: "order-complete",
        label: `${o.id} (${o.customer}) completed${world.hour > o.dueHour ? " — late" : " on time"}`,
        severity: world.hour > o.dueHour ? "warning" : "success",
        orderId: o.id,
      });
    }
  }
  for (const o of world.orders) {
    if (o.completedHour === null && o.fulfilledAtDue === null && world.hour >= o.dueHour - EPS) {
      o.fulfilledAtDue = o.fulfilled;
      emit(world, {
        hour: world.hour,
        kind: "order-late",
        label: `${o.id} due — ${Math.round(o.quantity - o.fulfilled).toLocaleString("en-US")} units short`,
        severity: "critical",
        orderId: o.id,
      });
    }
  }
}

/** Advance the world by dt hours. Mutates `world`. */
export function stepWorld(world: SimWorld, dt: number) {
  applyDirectives(world);
  receiveInbound(world);
  updateMachineModes(world);
  for (const id of world.lineOrder) {
    const line = world.lines[id];
    if (line.kind === "assembly") produceAssembly(world, line, dt);
  }
  for (const id of world.lineOrder) {
    const line = world.lines[id];
    if (line.kind === "packaging") producePackaging(world, line, dt);
  }
  world.hour += dt;
  checkFailures(world);
  allocateOrders(world);
  if (world.rules) evaluateRules(world);
  if (world.hour > 0) {
    for (const line of Object.values(world.lines)) {
      if (line.changeoverUntil !== null && line.changeoverUntil <= world.hour + EPS) line.changeoverUntil = null;
    }
  }
}

/* ──────────────────────── Automation rules ──────────────────────── */

const STOPPED: LineState[] = ["down", "maintenance"];
const r2 = (x: number) => Math.round(x * 100) / 100;

function connectorTriggered(world: SimWorld, r: Extract<PlantRule, { kind: "connector" }>, line: LineSim, active: boolean) {
  if (r.when === "upstream-stops") return STOPPED.includes(lineStateFor(world, line));
  const dl = line.downstreamLineId ? world.lines[line.downstreamLineId] : undefined;
  if (!dl) return false;
  if (r.when === "downstream-stops") return STOPPED.includes(lineStateFor(world, dl));
  const limit = r.bufferUnits ?? 200;
  const wip = Object.values(dl.buffer).reduce((a, b) => a + b, 0);
  // Hysteresis: hold until the buffer drains to 80% of the limit.
  return active ? wip > limit * 0.8 : wip >= limit;
}

/** Start a connector action: returns the directives it created (empty when there is nothing to do). */
function startConnector(world: SimWorld, rt: RuleRuntime, r: Extract<PlantRule, { kind: "connector" }>, line: LineSim): Directive[] {
  if (r.action === "divert") {
    const to = r.toLineId ? world.lines[r.toLineId] : undefined;
    if (!to) return [];
    // The receiving line keeps half its own mix and takes on the stopped line's products it can make.
    const takeOver = Object.entries(line.allocation).filter(([pid, share]) => share > 0 && to.capabilities[pid]);
    if (!takeOver.length) return [];
    const mix: Record<string, number> = {};
    for (const [pid, share] of Object.entries(to.allocation)) if (share > 0) mix[pid] = share * 0.5;
    const total = takeOver.reduce((a, [, x]) => a + x, 0);
    for (const [pid, share] of takeOver) mix[pid] = (mix[pid] ?? 0) + (share / total) * 0.5;
    const sum = Object.values(mix).reduce((a, b) => a + b, 0);
    const allocation = Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, Math.round((v / sum) * 10000) / 10000]));
    return [{ id: `RD-${++rt.seq}`, kind: "allocation", lineId: to.id, allocation, startHour: world.hour, endHour: null, revertAllocation: { ...to.allocation }, status: "scheduled", ruleId: r.id }];
  }
  const speedPct = r.action === "pause" ? 0 : Math.max(5, Math.min(100, r.speedPct ?? 60));
  return line.machineIds
    .map((id) => world.machines[id])
    .filter((m) => m.speedPct !== speedPct)
    .map((m) => ({ id: `RD-${++rt.seq}`, kind: "speed" as const, assetId: m.id, speedPct, startHour: world.hour, endHour: null, revertSpeedPct: m.speedPct, status: "scheduled" as const, ruleId: r.id }));
}

/**
 * Inventory and connector rules, evaluated at the end of each step so their effect starts on the
 * next one. The same function runs in the live plant and in What-If simulations.
 */
function evaluateRules(world: SimWorld) {
  const rt = (world.ruleRuntime ??= { seq: 0, rules: {} });
  for (const r of world.rules ?? []) {
    if (!r.enabled || r.kind === "maintenance") continue;
    const st = (rt.rules[r.id] ??= { active: false, directiveIds: [], fired: 0, lastFiredHour: null });
    if (r.kind === "inventory") {
      const item = world.inventory[r.itemId];
      if (!item) continue;
      const position = item.onHand + item.inbound.reduce((a, x) => a + x.qty, 0);
      if (position >= r.below - EPS || r.orderQty <= 0) continue;
      // Order whole lots until stock plus open orders is back above the trigger level.
      const qty = r.orderQty * Math.ceil((r.below - position) / r.orderQty);
      const poId = `PO-R${++rt.seq}`;
      item.inbound.push({ poId, qty, etaHour: r2(world.hour + r.leadTimeHours) });
      st.fired += 1;
      st.lastFiredHour = r2(world.hour);
      emit(world, {
        hour: world.hour,
        kind: "rule",
        label: `${r.name}: ordered ${Math.round(qty).toLocaleString("en-US")} × ${item.name} (${poId}, due in ${r.leadTimeHours} h)`,
        severity: "info",
        itemId: r.itemId,
        ruleId: r.id,
      });
      continue;
    }
    const line = world.lines[r.lineId];
    if (!line) continue;
    const on = connectorTriggered(world, r, line, st.active);
    if (on && !st.active) {
      const ds = startConnector(world, rt, r, line);
      world.directives.push(...ds);
      st.active = true;
      st.directiveIds = ds.map((d) => d.id);
      st.fired += 1;
      st.lastFiredHour = r2(world.hour);
      const cause = r.when === "upstream-stops" ? `${line.name} stopped` : r.when === "downstream-stops" ? `${world.lines[line.downstreamLineId ?? ""]?.name ?? "the next line"} stopped` : `the buffer after ${line.name} reached ${r.bufferUnits ?? 200} units`;
      const effect = !ds.length
        ? r.action === "divert"
          ? `nothing to divert: ${world.lines[r.toLineId ?? ""]?.name ?? "the other line"} can't make ${line.name}'s products`
          : `${line.name} was already at that speed`
        : r.action === "divert"
          ? `${world.lines[r.toLineId!]?.name} takes over ${line.name}'s work`
          : r.action === "pause"
            ? `${line.name} paused`
            : `${line.name} slowed to ${r.speedPct ?? 60}%`;
      emit(world, { hour: world.hour, kind: "rule", label: `${r.name}: ${cause}; ${effect}`, lineId: line.id, severity: ds.length ? "warning" : "info", ruleId: r.id });
    } else if (!on && st.active) {
      for (const id of st.directiveIds) {
        const d = world.directives.find((x) => x.id === id);
        if (!d || d.kind === "maintenance") continue;
        if (d.status === "scheduled") d.status = "cancelled";
        else if (d.status === "active") d.endHour = world.hour;
      }
      st.active = false;
      st.directiveIds = [];
      emit(world, { hour: world.hour, kind: "rule", label: `${r.name}: condition cleared; ${r.action === "divert" ? "lines return to their own work" : `${line.name} back to normal speed`}`, lineId: line.id, severity: "info", ruleId: r.id });
    }
  }
}
