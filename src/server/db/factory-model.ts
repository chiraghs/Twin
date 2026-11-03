import "server-only";
import type { FactoryState } from "@/domain/types";

/**
 * Data model of a facility's digital twin, one SQLite table per aggregate collection.
 *
 * Each row carries the facility id, the entity's natural key, typed and indexed columns that
 * queries and reports filter on (status, asset, line, timestamps), its position in the domain
 * collection (`ord`) and the full entity as JSON (`data`), so the domain engine round-trips
 * exactly while the data stays relational and queryable.
 */

type Item = Record<string, unknown>;
export type ColType = "TEXT" | "REAL" | "INTEGER";

export interface Column {
  name: string;
  type: ColType;
  /** Extract the column value from an entity. */
  get: (item: Item) => unknown;
  index?: boolean;
}

export interface EntityTable {
  table: string;
  /** Domain collection on FactoryState. */
  field: keyof FactoryState;
  /** Natural key columns (besides facility_id). */
  key: Column[];
  columns: Column[];
  /** "list": FactoryState[field] is an array. "series": Record<groupKey, item[]> (grouped by key[0]). */
  shape: "list" | "series";
  description: string;
}

const s = (name: string, get: (i: Item) => unknown, index = false): Column => ({ name, type: "TEXT", get: (i) => nz(get(i)), index });
const r = (name: string, get: (i: Item) => unknown, index = false): Column => ({ name, type: "REAL", get: (i) => num(get(i)), index });
const n = (name: string, get: (i: Item) => unknown, index = false): Column => ({ name, type: "INTEGER", get: (i) => int(get(i)), index });
const nz = (v: unknown) => (v === undefined || v === null ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" ? Math.round(v) : null);
const id = s("id", (i) => i.id);

export const ENTITY_TABLES: EntityTable[] = [
  { table: "production_lines", field: "lines", shape: "list", key: [id], columns: [s("name", (i) => i.name), s("kind", (i) => i.kind)], description: "Production lines (assembly / packaging) of the plant." },
  {
    table: "assets",
    field: "assets",
    shape: "list",
    key: [id],
    columns: [s("line_id", (i) => i.lineId, true), s("kind", (i) => i.kind, true), s("status", (i) => i.status, true), s("name", (i) => i.name)],
    description: "Machines and equipment: archetype, line, status, physics parameters and condition.",
  },
  { table: "asset_connections", field: "connections", shape: "list", key: [id], columns: [s("kind", (i) => i.kind), s("source_id", (i) => i.source, true), s("target_id", (i) => i.target, true)], description: "Dependencies between assets, inventory and orders." },
  { table: "products", field: "products", shape: "list", key: [id], columns: [s("name", (i) => i.name)], description: "Products with BOM and routing." },
  { table: "inventory_items", field: "inventory", shape: "list", key: [id], columns: [s("name", (i) => i.name), s("category", (i) => i.category, true)], description: "Components, packaging and raw materials with stock and inbound POs." },
  { table: "customer_orders", field: "orders", shape: "list", key: [id], columns: [s("product_id", (i) => i.productId, true), r("due_hour", (i) => i.dueHour), s("priority", (i) => i.priority)], description: "Customer orders with due time, quantity and penalties." },
  { table: "maintenance_records", field: "maintenanceHistory", shape: "list", key: [id], columns: [s("asset_id", (i) => i.assetId, true), s("type", (i) => i.type), r("hour", (i) => i.hour), r("cost", (i) => i.cost)], description: "Historical maintenance on each asset." },
  { table: "work_orders", field: "workOrders", shape: "list", key: [id], columns: [s("asset_id", (i) => i.assetId, true), s("status", (i) => i.status, true)], description: "Maintenance work orders created by approved plans." },
  { table: "directives", field: "directives", shape: "list", key: [id], columns: [s("asset_id", (i) => i.assetId, true), s("status", (i) => i.status, true), s("kind", (i) => i.kind)], description: "Operating directives applied to the twin (speed, reroute, maintenance windows)." },
  {
    table: "incidents",
    field: "incidents",
    shape: "list",
    key: [id],
    columns: [s("asset_id", (i) => i.assetId, true), s("severity", (i) => i.severity, true), s("status", (i) => i.status, true), r("opened_hour", (i) => i.openedHour)],
    description: "Incidents raised from anomalies and their lifecycle.",
  },
  { table: "analysis_runs", field: "analyses", shape: "list", key: [id], columns: [s("status", (i) => i.status, true), s("incident_id", (i) => i.incidentId, true), s("started_at", (i) => i.startedAt)], description: "Six-agent analysis runs: stages, findings and the narrative." },
  { table: "scenario_runs", field: "scenarioRuns", shape: "list", key: [id], columns: [s("at", (i) => i.at, true), s("target_asset_id", (i) => i.targetAssetId, true), s("recommended_id", (i) => i.recommendedId)], description: "What-if simulation runs with all scenario results." },
  {
    table: "recommendations",
    field: "recommendations",
    shape: "list",
    key: [id],
    columns: [s("at", (i) => i.at, true), s("status", (i) => i.status, true), s("scenario_id", (i) => i.scenarioId), s("decided_by", (i) => (i.decision as Item | undefined)?.by ?? null)],
    description: "Plans awaiting or after human approval (approve / reject / rollback).",
  },
  { table: "cameras", field: "cameras", shape: "list", key: [id], columns: [s("kind", (i) => i.kind, true), s("line_id", (i) => i.lineId), s("asset_id", (i) => i.assetId), s("stream_kind", (i) => (i.stream as Item | undefined)?.kind)], description: "Cameras placed in the twin and their stream source." },
  {
    table: "vision_reviews",
    field: "visionReviews",
    shape: "list",
    key: [id],
    columns: [s("at", (i) => i.at, true), s("camera_id", (i) => i.cameraId, true), s("source", (i) => i.source), s("disposition", (i) => i.disposition, true), s("model", (i) => i.model)],
    description: "Visual reviews (AI, OpenCV, station log) with their human disposition.",
  },
  { table: "mobile_robots", field: "mobileRobots", shape: "list", key: [id], columns: [s("fleet_id", (i) => i.fleetId), s("line_id", (i) => i.lineId), s("robot_type", (i) => i.robotType)], description: "Mobile robot fleets (AMR / AGV / forklift / tugger)." },
  { table: "plant_rules", field: "rules", shape: "list", key: [id], columns: [s("kind", (i) => i.kind, true), n("enabled", (i) => i.enabled), s("name", (i) => i.name)], description: "Automation rules from the Playground (inventory, maintenance, connector)." },
  { table: "data_connections", field: "dataPlan", shape: "list", key: [id], columns: [s("target", (i) => i.target), s("kind", (i) => i.kind), s("status", (i) => i.status)], description: "Planned data connections (OPC UA, MQTT, Pub/Sub, cameras…)." },
  {
    table: "audit_entries",
    field: "audit",
    shape: "list",
    key: [id],
    columns: [s("at", (i) => i.at, true), s("category", (i) => i.category, true), s("severity", (i) => i.severity), s("actor", (i) => i.actor), s("title", (i) => i.title)],
    description: "Audit trail: every alert, finding, run, decision, AI call and setting change.",
  },
  {
    table: "production_hours",
    field: "production",
    shape: "list",
    key: [s("line_id", (i) => i.lineId), r("hour", (i) => i.hour)],
    columns: [r("good_units", (i) => i.goodUnits), r("scrap_units", (i) => i.scrapUnits), r("run_hours", (i) => i.runHours), r("energy_kwh", (i) => i.energyKwh)],
    description: "Hourly production per line (output, scrap by cause, downtime, energy).",
  },
  {
    table: "telemetry_readings",
    field: "telemetry",
    shape: "series",
    key: [s("asset_id", (i) => i.__group), r("t", (i) => i.t)],
    columns: [r("vibration", (i) => i.vibration), r("temperature", (i) => i.temperature), r("power_kw", (i) => i.powerKw), r("speed_pct", (i) => i.speedPct), r("throughput", (i) => i.throughput), n("running", (i) => i.running)],
    description: "Measured telemetry per asset (vibration mm/s, °C, kW, speed %, throughput, running).",
  },
  {
    table: "health_history",
    field: "healthHistory",
    shape: "series",
    key: [s("asset_id", (i) => i.__group), r("day", (i) => i.day)],
    columns: [r("score", (i) => i.score)],
    description: "Daily health score per asset.",
  },
];

/** Singleton parts of the aggregate, stored on `facility_state` as JSON columns. */
export const STATE_FIELDS = ["clock", "costModel", "counters", "finishedGoods", "latest", "ruleRuntime", "layout", "twinSpec"] as const;

export function entityDdl(t: EntityTable): string {
  const keyCols = t.key.map((c) => `${c.name} ${c.type} NOT NULL`);
  const cols = t.columns.map((c) => `${c.name} ${c.type}`);
  const idx = t.columns.filter((c) => c.index).map((c) => `CREATE INDEX IF NOT EXISTS ix_${t.table}_${c.name} ON ${t.table} (facility_id, ${c.name});`);
  return `CREATE TABLE IF NOT EXISTS ${t.table} (
  facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  ${[...keyCols, ...cols, "ord INTEGER NOT NULL", "data TEXT NOT NULL", "updated_at TEXT NOT NULL"].join(",\n  ")},
  PRIMARY KEY (facility_id, ${t.key.map((c) => c.name).join(", ")})
) WITHOUT ROWID;
${idx.join("\n")}`;
}
