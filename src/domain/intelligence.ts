/**
 * The four intelligence features (Python backend) applied to this twin's plant.
 *
 * `buildTwinSnapshot` is what the web app sends the backend (POST /api/v1/twin/sync);
 * the *Insights types are what it computes back. Pure and isomorphic: the agents use the
 * insights as extra evidence, and the Analytics pages render them.
 */
import { consumptionPerHour } from "./kpis";
import type { FactoryState } from "./types";

export const FEATURE_IDS = ["maintenance", "supply", "demand", "vision"] as const;
export type FeatureId = (typeof FEATURE_IDS)[number];

export const FEATURE_META: Record<FeatureId, { name: string; settingKey: string; configPath: string; analyticsHref: string; agent: string }> = {
  maintenance: { name: "Predictive maintenance", settingKey: "FEATURE_PREDICTIVE_MAINTENANCE", configPath: "maintenance/config", analyticsHref: "/analytics/maintenance", agent: "maintenance" },
  supply: { name: "Supply chain intelligence", settingKey: "FEATURE_SUPPLY_CHAIN", configPath: "supply-chain/config", analyticsHref: "/analytics/supply", agent: "supply" },
  demand: { name: "Demand forecasting", settingKey: "FEATURE_DEMAND_FORECASTING", configPath: "demand/config", analyticsHref: "/analytics/demand", agent: "production" },
  vision: { name: "AOI vision inspection", settingKey: "FEATURE_VISION_INSPECTION", configPath: "quality/config", analyticsHref: "/analytics/quality", agent: "quality" },
};

/* ─────────────────────────── insights (backend → twin) ─────────────────────────── */

export type Risk = "high" | "medium" | "low" | "n/a";

export interface MaintenanceAssetInsight {
  assetId: string;
  name: string;
  lineId: string;
  kind: string;
  criticality: string;
  status: string;
  risk: Risk;
  vibration?: number;
  temperature?: number;
  healthScore?: number;
  isoZone?: string;
  hoursToTrip?: number | null;
  tripHour?: number | null;
  degradationPerHour?: number;
  confidence?: number;
  tripImminent?: boolean;
  recommendedAction?: string;
  faultSignature?: string | null;
  avoidableCost?: number;
  limits?: { alarm: number; trip: number };
}

export interface MaintenanceInsights {
  feature: "maintenance";
  simHour: number;
  engine: string;
  assets: MaintenanceAssetInsight[];
  counts: { high: number; medium: number; low: number };
  preventiveCost: number;
  unplannedCost: number;
  imminentHours: number;
  zoneMix: Record<string, number>;
}

export interface SupplyItemInsight {
  itemId: string;
  name: string;
  unit: string;
  category: string;
  supplier: string;
  onHand: number;
  reorderPoint: number;
  consumptionPerHour: number;
  daysOfSupply: number | null;
  runwayHours: number | null;
  leadTimeHours: number;
  inboundQty: number;
  nextInboundHour: number | null;
  atRisk: boolean;
  usedBy: { lineId: string; productId: string; qty: number }[];
  unitCost: number;
  purchaseOrder: { qty: number; supplier: string; etaInHours: number; cost: number; urgency: string } | null;
  /** Already on order, but the first delivery arrives after the stock runs out. */
  expediteNeeded: boolean;
}

export interface SupplyInsights {
  feature: "supply";
  simHour: number;
  engine: string;
  items: SupplyItemInsight[];
  lines: { lineId: string; name: string; runwayHours: number | null; criticalItemId: string | null }[];
  suppliers: { supplier: string; items: number; atRisk: number; dailySpend: number; maxLeadTimeHours: number; inboundQty: number }[];
  criticalDays: number;
  counts: { atRisk: number; toOrder: number; toExpedite: number };
}

export interface ForecastPoint {
  date: string;
  p10_units: number;
  p50_units: number;
  p90_units: number;
  baseline_units: number;
}

export interface DemandProductInsight {
  productId: string;
  name: string;
  sku: string;
  model: string;
  /** The main model, when it lost to the seasonal-naive baseline out of time (the baseline is then the champion). */
  challenger: { model: string; wape: number } | null;
  metrics: { wape: number; bias: number; mae: number; baselineWape: number };
  forecast: ForecastPoint[];
  history: { date: string; actual_units: number }[];
  dailyP50: number;
  dailyP90: number;
  totalP50: number;
  capacityPerDay: number;
  maxCapacityPerDay: number;
  utilizationPct: number | null;
  capacityWarning: boolean;
  p90ExceedsCapacity: boolean;
  openOrderUnits: number;
  orderCoveragePct: number | null;
  revenueP50: number;
}

export interface DemandInsights {
  feature: "demand";
  simHour: number;
  asOf: string;
  horizonDays: number;
  engine: string;
  provenance: string;
  capacityWarningPct: number;
  products: DemandProductInsight[];
  counts: { products: number; capacityWarnings: number };
}

export interface VisionInspectionRow {
  inspection_id: string;
  camera_id: string;
  line_id: string | null;
  product_id: string | null;
  at: string;
  sim_hour: number;
  verdict: string;
  defect_count: number;
  disposition: string;
  auditor: string | null;
  advisory: string | null;
  detector: string | null;
  defects: { class: string; confidence: number; box: [number, number, number, number] }[];
}

export interface VisionInsights {
  feature: "vision";
  engine: string;
  lines: { lineId: string; inspected: number; failed: number; review: number; defects: number; fpyPct: number | null; defectsPerUnit: number | null }[];
  pareto: { defectClass: string; count: number }[];
  detectorPrecisionPct: number | null;
  dispositions: { confirmed: number; dismissed: number; pending: number };
  recent: VisionInspectionRow[];
  counts: { inspected: number; failed: number };
}

export interface BackendInsights {
  maintenance?: MaintenanceInsights;
  supply?: SupplyInsights;
  demand?: DemandInsights;
  vision?: VisionInsights;
}

/* ─────────────────────────── snapshot (twin → backend) ─────────────────────────── */

const HISTORY_POINTS = 60; // 10 hours at the twin's 10-minute history resolution

/** The plant data the enabled features need, in the backend's wire format. */
export function buildTwinSnapshot(state: FactoryState, features: FeatureId[]) {
  const need = new Set(features);
  const usedBy = new Map<string, { lineId: string; productId: string; qty: number }[]>();
  for (const l of state.lines)
    for (const c of l.capabilities)
      for (const b of c.bom) {
        const list = usedBy.get(b.itemId) ?? [];
        list.push({ lineId: l.id, productId: c.productId, qty: b.qty });
        usedBy.set(b.itemId, list);
      }
  return {
    facilityId: state.profile.id,
    facilityName: state.profile.name,
    simHour: Math.round(state.clock.hour * 1000) / 1000,
    anchorIso: state.clock.anchorISO,
    features: [...features],
    costModel: {
      maintenanceLaborPerHour: state.costModel.maintenanceLaborPerHour,
      maintenancePartsCost: state.costModel.maintenancePartsCost,
      unplannedRepairCost: state.costModel.unplannedRepairCost,
      unplannedRepairHours: state.costModel.unplannedRepairHours,
    },
    assets: need.has("maintenance")
      ? state.assets.map((a) => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          lineId: a.lineId,
          criticality: a.criticality,
          mode: a.mode,
          vibrationAlarm: a.thresholds.vibrationAlarm,
          vibrationTrip: a.thresholds.vibrationTrip,
          temperatureAlarm: a.thresholds.temperatureAlarm,
          temperatureTrip: a.thresholds.temperatureTrip,
          baselineVibration: a.baseline.vibration,
          baselineTemperature: a.baseline.temperature,
          history: (state.telemetry[a.id] ?? []).slice(-HISTORY_POINTS).map((r) => ({ t: r.t, vibration: r.vibration, temperature: r.temperature })),
        }))
      : [],
    items: need.has("supply")
      ? state.inventory.map((i) => ({
          id: i.id,
          name: i.name,
          unit: i.unit,
          category: i.category,
          onHand: i.onHand,
          reorderPoint: i.reorderPoint,
          unitCost: i.unitCost,
          supplier: i.supplier,
          leadTimeHours: i.leadTimeHours,
          consumptionPerHour: consumptionPerHour(state, i.id),
          inbound: i.inbound.map((b) => ({ poId: b.poId, qty: b.qty, etaHour: b.etaHour })),
          usedBy: usedBy.get(i.id) ?? [],
        }))
      : [],
    products: state.products.map((p) => ({ id: p.id, name: p.name, sku: p.sku, unitPrice: p.unitPrice, unitMaterialCost: p.unitMaterialCost })),
    lines: state.lines.map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      state: l.state,
      capabilities: l.capabilities.map((c) => ({ productId: c.productId, ratePerHour: c.ratePerHour })),
      allocation: l.allocation,
    })),
    orders: need.has("demand")
      ? state.orders.filter((o) => o.completedHour === null).map((o) => ({ id: o.id, customer: o.customer, productId: o.productId, quantity: o.quantity, fulfilled: o.fulfilled, dueHour: o.dueHour, priority: o.priority }))
      : [],
    cameras: need.has("vision") ? state.cameras.filter((c) => c.kind === "inspection").map((c) => ({ id: c.id, name: c.name, kind: c.kind, lineId: c.lineId })) : [],
  };
}

export type TwinSnapshot = ReturnType<typeof buildTwinSnapshot>;
