import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { buildDemoFactory, SCHEMA_VERSION } from "@/domain/seed";
import type { FactoryState } from "@/domain/types";
import { dataDir } from "../runtime";
import { db, dbPath, nowIso, transaction } from "./connection";
import { ENTITY_TABLES, STATE_FIELDS, type EntityTable } from "./factory-model";

/**
 * Facility repository: the factory twin stored in normalised SQLite tables.
 *
 * The domain engine works on one in-memory aggregate (FactoryState) for speed; this repository
 * is its system of record. Loading assembles the aggregate from the tables; saving writes only
 * the rows whose content or position changed (and deletes removed ones) in one transaction, so a
 * live tick touches a handful of rows rather than the whole plant.
 */

export interface FacilitySummary {
  id: string;
  name: string;
  industry: string;
  location: string;
  productionType: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

const DEMO_ID = "demo-electronics";

type Item = Record<string, unknown>;
type Snapshot = Map<string, Map<string, string>>; // table → key → "ord|json"

const STATE_COLUMNS: Record<(typeof STATE_FIELDS)[number], string> = {
  clock: "clock",
  costModel: "cost_model",
  counters: "counters",
  finishedGoods: "finished_goods",
  latest: "latest",
  ruleRuntime: "rule_runtime",
  layout: "layout",
  twinSpec: "twin_spec",
};

/** Flatten a collection to rows: lists keep their order; series (Record<group, item[]>) carry the group as `__group`. */
function rowsOf(t: EntityTable, state: FactoryState): Item[] {
  const v = state[t.field] as unknown;
  if (!v) return [];
  if (t.shape === "list") return v as Item[];
  const out: Item[] = [];
  for (const [group, items] of Object.entries(v as Record<string, Item[]>)) for (const it of items) out.push({ ...it, __group: group });
  return out;
}

const keyOf = (t: EntityTable, item: Item) => t.key.map((c) => String(c.get(item))).join("\u0001");
const payload = (item: Item) => {
  if (!("__group" in item)) return JSON.stringify(item);
  const { __group: _g, ...rest } = item;
  return JSON.stringify(rest);
};

export class FacilityRepository {
  /** What the database holds for each facility, to write only changes. */
  private snapshots = new Map<string, Snapshot>();
  private stmts = new Map<string, { upsert: ReturnType<DatabaseSync["prepare"]>; del: ReturnType<DatabaseSync["prepare"]> }>();
  private file: string;

  constructor() {
    this.file = dbPath();
    this.importLegacy();
    if (!this.listFacilities().length) {
      this.saveFacility(buildDemoFactory(), true, DEMO_ID);
      this.setActiveFacilityId(DEMO_ID);
    }
  }

  private get conn() {
    return db();
  }

  private statements(t: EntityTable) {
    let st = this.stmts.get(t.table);
    if (!st) {
      const cols = ["facility_id", ...t.key.map((c) => c.name), ...t.columns.map((c) => c.name), "ord", "data", "updated_at"];
      const keyCols = ["facility_id", ...t.key.map((c) => c.name)];
      const nonKey = cols.filter((c) => !keyCols.includes(c));
      st = {
        upsert: this.conn.prepare(
          `INSERT INTO ${t.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
           ON CONFLICT (${keyCols.join(", ")}) DO UPDATE SET ${nonKey.map((c) => `${c} = excluded.${c}`).join(", ")}`,
        ),
        del: this.conn.prepare(`DELETE FROM ${t.table} WHERE ${keyCols.map((c) => `${c} = ?`).join(" AND ")}`),
      };
      this.stmts.set(t.table, st);
    }
    return st;
  }

  /** One-time import of data kept by earlier builds (JSON blob table, factory-state.json, settings.json). */
  private importLegacy() {
    const c = this.conn;
    const legacy = c.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'facilities_legacy'").get();
    if (legacy) {
      const rows = c.prepare("SELECT id, is_demo, state_json FROM facilities_legacy").all() as { id: string; is_demo: number; state_json: string }[];
      for (const r of rows) {
        try {
          const st = JSON.parse(r.state_json) as FactoryState;
          if (st.schemaVersion === SCHEMA_VERSION) this.saveFacility(st, !!r.is_demo, r.id);
        } catch {
          /* unreadable legacy row: skipped */
        }
      }
      const active = c.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'active_session_legacy'").get()
        ? (c.prepare("SELECT active_facility_id AS id FROM active_session_legacy WHERE id = 'current'").get() as { id?: string } | undefined)
        : undefined;
      if (active?.id && this.exists(active.id)) this.setActiveFacilityId(active.id);
      c.exec("DROP TABLE facilities_legacy; DROP TABLE IF EXISTS active_session_legacy;");
    }
    const legacyFile = path.join(dataDir(), "factory-state.json");
    if (!this.listFacilities().length && fs.existsSync(legacyFile)) {
      try {
        const st = JSON.parse(fs.readFileSync(legacyFile, "utf8")) as FactoryState;
        if (st.schemaVersion === SCHEMA_VERSION) {
          this.saveFacility(st, true, DEMO_ID);
          this.setActiveFacilityId(DEMO_ID);
        }
      } catch {
        /* ignore */
      }
    }
  }

  private exists(id: string) {
    return !!this.conn.prepare("SELECT 1 FROM facilities WHERE id = ?").get(id);
  }

  public listFacilities(): FacilitySummary[] {
    const rows = this.conn
      .prepare(
        `SELECT id, name, industry, location, production_type AS productionType, is_demo AS isDemo, created_at AS createdAt, updated_at AS updatedAt
         FROM facilities ORDER BY is_demo DESC, updated_at DESC`,
      )
      .all() as unknown as (Omit<FacilitySummary, "isDemo"> & { isDemo: number })[];
    return rows.map((r) => ({ ...r, isDemo: Boolean(r.isDemo) }));
  }

  public getActiveFacilityId(): string {
    const row = this.conn.prepare("SELECT facility_id FROM active_facility WHERE id = 'current'").get() as { facility_id: string } | undefined;
    if (row?.facility_id) return row.facility_id;
    const first = this.conn.prepare("SELECT id FROM facilities ORDER BY is_demo DESC LIMIT 1").get() as { id: string } | undefined;
    const fid = first?.id ?? DEMO_ID;
    if (this.exists(fid)) this.setActiveFacilityId(fid);
    return fid;
  }

  public setActiveFacilityId(id: string): void {
    this.conn
      .prepare(
        `INSERT INTO active_facility (id, facility_id, updated_at) VALUES ('current', ?, ?)
         ON CONFLICT (id) DO UPDATE SET facility_id = excluded.facility_id, updated_at = excluded.updated_at`,
      )
      .run(id, nowIso());
  }

  /** Assemble a facility's aggregate from its tables. */
  public getFacility(id?: string): FactoryState | null {
    const fid = id || this.getActiveFacilityId();
    const c = this.conn;
    const f = c.prepare("SELECT * FROM facilities WHERE id = ?").get(fid) as Item | undefined;
    const fs_ = c.prepare("SELECT * FROM facility_state WHERE facility_id = ?").get(fid) as Item | undefined;
    if (!f || !fs_) return null;
    const snap: Snapshot = new Map();
    const state: Item = { schemaVersion: f.schema_version, seed: f.seed };
    state.profile = {
      id: f.id,
      name: f.name,
      industry: f.industry,
      location: f.location,
      productionType: f.production_type,
      dataSource: f.data_source,
      createdAt: f.created_at,
      isDemo: Boolean(f.is_demo),
    };
    for (const [field, col] of Object.entries(STATE_COLUMNS)) {
      const raw = fs_[col] as string | null;
      if (raw !== null && raw !== undefined) state[field] = JSON.parse(raw);
    }
    for (const t of ENTITY_TABLES) {
      const keyCols = t.key.map((k) => k.name);
      const rows = c.prepare(`SELECT ${keyCols.join(", ")}, ord, data FROM ${t.table} WHERE facility_id = ? ORDER BY ord`).all(fid) as Item[];
      const tsnap = new Map<string, string>();
      if (t.shape === "list") {
        const list: Item[] = [];
        for (const r of rows) {
          const item = JSON.parse(r.data as string) as Item;
          list.push(item);
          tsnap.set(keyOf(t, item), `${r.ord}|${r.data}`);
        }
        if (list.length || !OPTIONAL_LISTS.has(t.field)) state[t.field] = list;
      } else {
        const groups: Record<string, Item[]> = {};
        for (const r of rows) {
          const item = JSON.parse(r.data as string) as Item;
          const group = String(r[keyCols[0]]);
          (groups[group] ??= []).push(item);
          tsnap.set(keyOf(t, { ...item, __group: group }), `${r.ord}|${r.data}`);
        }
        state[t.field] = groups;
      }
      snap.set(t.table, tsnap);
    }
    this.snapshots.set(fid, snap);
    return state as unknown as FactoryState;
  }

  /** Persist a facility: header, singleton state and only the changed entity rows. */
  public saveFacility(state: FactoryState, isDemo = false, customId?: string): string {
    const fid = customId || state.profile.id || `fac-${Date.now()}`;
    state.profile.id = fid;
    const now = nowIso();
    const c = this.conn;
    transaction(c, () => {
      c.prepare(
        `INSERT INTO facilities (id, name, industry, location, production_type, data_source, is_demo, schema_version, seed, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, industry = excluded.industry, location = excluded.location,
           production_type = excluded.production_type, data_source = excluded.data_source, is_demo = excluded.is_demo,
           schema_version = excluded.schema_version, seed = excluded.seed, created_at = excluded.created_at, updated_at = excluded.updated_at`,
      ).run(fid, state.profile.name, state.profile.industry, state.profile.location, state.profile.productionType, state.profile.dataSource ?? null, isDemo ? 1 : 0, state.schemaVersion, state.seed, state.profile.createdAt || now, now);
      const st = state as unknown as Item;
      c.prepare(
        `INSERT INTO facility_state (facility_id, clock, cost_model, counters, finished_goods, latest, rule_runtime, layout, twin_spec, sim_hour, live_telemetry, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (facility_id) DO UPDATE SET clock = excluded.clock, cost_model = excluded.cost_model, counters = excluded.counters,
           finished_goods = excluded.finished_goods, latest = excluded.latest, rule_runtime = excluded.rule_runtime, layout = excluded.layout,
           twin_spec = excluded.twin_spec, sim_hour = excluded.sim_hour, live_telemetry = excluded.live_telemetry, updated_at = excluded.updated_at`,
      ).run(
        fid,
        JSON.stringify(st.clock),
        JSON.stringify(st.costModel),
        JSON.stringify(st.counters ?? {}),
        JSON.stringify(st.finishedGoods ?? {}),
        JSON.stringify(st.latest ?? {}),
        st.ruleRuntime === undefined ? null : JSON.stringify(st.ruleRuntime),
        st.layout === undefined ? null : JSON.stringify(st.layout),
        st.twinSpec === undefined ? null : JSON.stringify(st.twinSpec),
        state.clock?.hour ?? null,
        state.clock ? (state.clock.liveTelemetry ? 1 : 0) : null,
        now,
      );

      let snap = this.snapshots.get(fid);
      if (!snap) {
        // No snapshot (new facility, or first save after start): replace its rows wholesale.
        for (const t of ENTITY_TABLES) c.prepare(`DELETE FROM ${t.table} WHERE facility_id = ?`).run(fid);
        snap = new Map();
        this.snapshots.set(fid, snap);
      }
      for (const t of ENTITY_TABLES) {
        const prev = snap.get(t.table) ?? new Map<string, string>();
        const next = new Map<string, string>();
        const { upsert, del } = this.statements(t);
        rowsOf(t, state).forEach((item, ord) => {
          const k = keyOf(t, item);
          const json = payload(item);
          const sig = `${ord}|${json}`;
          next.set(k, sig);
          if (prev.get(k) === sig) return;
          upsert.run(fid, ...t.key.map((col) => col.get(item)), ...t.columns.map((col) => col.get(item)), ord, json, now);
        });
        for (const k of prev.keys()) if (!next.has(k)) del.run(fid, ...k.split("\u0001").map((v, i) => (t.key[i].type === "REAL" ? Number(v) : v)));
        snap.set(t.table, next);
      }
    });
    return fid;
  }

  public resetDemo(): FactoryState {
    const fresh = buildDemoFactory();
    fresh.profile.id = DEMO_ID;
    this.snapshots.delete(DEMO_ID);
    this.saveFacility(fresh, true, DEMO_ID);
    this.setActiveFacilityId(DEMO_ID);
    return fresh;
  }

  public deleteFacility(id: string): boolean {
    if (id === DEMO_ID) return false; // never delete the demo factory
    transaction(this.conn, () => {
      if (this.getActiveFacilityId() === id) this.setActiveFacilityId(DEMO_ID);
      this.conn.prepare("DELETE FROM facilities WHERE id = ?").run(id);
    });
    this.snapshots.delete(id);
    return true;
  }

  /** Row counts per table for the active facility (Integrations → State persistence). */
  public stats(id?: string) {
    const fid = id || this.getActiveFacilityId();
    return Object.fromEntries(ENTITY_TABLES.map((t) => [t.table, (this.conn.prepare(`SELECT COUNT(*) AS n FROM ${t.table} WHERE facility_id = ?`).get(fid) as { n: number }).n]));
  }

  public get path() {
    return this.file;
  }
}

/** Optional collections: absent (rather than empty) on the aggregate when no rows exist. */
const OPTIONAL_LISTS = new Set<string>(["mobileRobots", "rules", "dataPlan"]);

// One repository per database file (tests point TWIN_DATA_DIR elsewhere); survives hot reloads.
const g = globalThis as unknown as { __twinRepos?: Map<string, FacilityRepository> };
const repos = (g.__twinRepos ??= new Map());
export function facilityRepo(): FacilityRepository {
  const file = dbPath();
  let r = repos.get(file);
  if (!r) {
    r = new FacilityRepository();
    repos.set(file, r);
  }
  return r;
}

/** Backwards-compatible facade used by the store and the facilities API. */
export const sqliteStore = {
  listFacilities: () => facilityRepo().listFacilities(),
  getActiveFacilityId: () => facilityRepo().getActiveFacilityId(),
  setActiveFacilityId: (id: string) => facilityRepo().setActiveFacilityId(id),
  getFacility: (id?: string) => facilityRepo().getFacility(id),
  saveFacility: (state: FactoryState, isDemo = false, customId?: string) => facilityRepo().saveFacility(state, isDemo, customId),
  resetDemo: () => facilityRepo().resetDemo(),
  deleteFacility: (id: string) => facilityRepo().deleteFacility(id),
  stats: (id?: string) => facilityRepo().stats(id),
};
