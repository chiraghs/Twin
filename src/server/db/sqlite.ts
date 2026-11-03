import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildDemoFactory, SCHEMA_VERSION } from "@/domain/seed";
import type { FactoryState } from "@/domain/types";
import { dataDir } from "../runtime";

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

class SqliteStore {
  private db: DatabaseSync;

  constructor() {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, "twin.db");
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  private init() {
    // 1. Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facilities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        industry TEXT NOT NULL,
        location TEXT NOT NULL,
        production_type TEXT NOT NULL,
        is_demo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        state_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS active_session (
        id TEXT PRIMARY KEY,
        active_facility_id TEXT NOT NULL
      );
    `);

    // 2. Check if we need to seed the demo factory
    const countRow = this.db.prepare("SELECT COUNT(*) as cnt FROM facilities").get() as { cnt: number };
    if (!countRow || countRow.cnt === 0) {
      // Check if existing factory-state.json exists
      let initial: FactoryState | null = null;
      const legacyFile = path.join(dataDir(), "factory-state.json");
      if (fs.existsSync(legacyFile)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(legacyFile, "utf8")) as FactoryState;
          if (parsed.schemaVersion === SCHEMA_VERSION) {
            initial = parsed;
          }
        } catch {
          initial = null;
        }
      }
      if (!initial) {
        initial = buildDemoFactory();
      }
      this.saveFacility(initial, true, DEMO_ID);
      this.setActiveFacilityId(DEMO_ID);
    }
  }

  public listFacilities(): FacilitySummary[] {
    const stmt = this.db.prepare(`
      SELECT id, name, industry, location, production_type as productionType, is_demo as isDemo, created_at as createdAt, updated_at as updatedAt
      FROM facilities
      ORDER BY is_demo DESC, updated_at DESC
    `);
    const rows = stmt.all() as unknown as (Omit<FacilitySummary, "isDemo"> & { isDemo: number })[];
    return rows.map((r) => ({
      ...r,
      isDemo: Boolean(r.isDemo),
    }));
  }

  public getActiveFacilityId(): string {
    const row = this.db.prepare("SELECT active_facility_id FROM active_session WHERE id = 'current'").get() as { active_facility_id: string } | undefined;
    if (row?.active_facility_id) {
      return row.active_facility_id;
    }
    // Fallback to first facility
    const first = this.db.prepare("SELECT id FROM facilities ORDER BY is_demo DESC LIMIT 1").get() as { id: string } | undefined;
    const id = first?.id ?? DEMO_ID;
    this.setActiveFacilityId(id);
    return id;
  }

  public setActiveFacilityId(id: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO active_session (id, active_facility_id)
      VALUES ('current', ?)
      ON CONFLICT(id) DO UPDATE SET active_facility_id = excluded.active_facility_id
    `);
    stmt.run(id);
  }

  public getFacility(id?: string): FactoryState | null {
    const targetId = id || this.getActiveFacilityId();
    const row = this.db.prepare("SELECT state_json FROM facilities WHERE id = ?").get(targetId) as { state_json: string } | undefined;
    if (!row?.state_json) return null;
    try {
      return JSON.parse(row.state_json) as FactoryState;
    } catch (e) {
      console.error(`[sqlite] Failed to parse state_json for facility ${targetId}:`, e);
      return null;
    }
  }

  public saveFacility(state: FactoryState, isDemo = false, customId?: string): string {
    const facilityId = customId || state.profile.id || `fac-${Date.now()}`;
    state.profile.id = facilityId;
    const now = new Date().toISOString();
    const jsonStr = JSON.stringify(state);

    const stmt = this.db.prepare(`
      INSERT INTO facilities (id, name, industry, location, production_type, is_demo, created_at, updated_at, state_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        industry = excluded.industry,
        location = excluded.location,
        production_type = excluded.production_type,
        updated_at = excluded.updated_at,
        state_json = excluded.state_json
    `);

    stmt.run(
      facilityId,
      state.profile.name,
      state.profile.industry,
      state.profile.location,
      state.profile.productionType,
      isDemo ? 1 : 0,
      now,
      now,
      jsonStr
    );

    return facilityId;
  }

  public resetDemo(): FactoryState {
    const fresh = buildDemoFactory();
    fresh.profile.id = DEMO_ID;
    this.saveFacility(fresh, true, DEMO_ID);
    this.setActiveFacilityId(DEMO_ID);
    return fresh;
  }

  public deleteFacility(id: string): boolean {
    if (id === DEMO_ID) return false; // Never delete demo factory
    this.db.prepare("DELETE FROM facilities WHERE id = ?").run(id);
    if (this.getActiveFacilityId() === id) {
      this.setActiveFacilityId(DEMO_ID);
    }
    return true;
  }
}

// Singleton on globalThis so hot reloads don't recreate connection
const g = globalThis as unknown as { __twin_sqlite?: SqliteStore };
export const sqliteStore = (g.__twin_sqlite ??= new SqliteStore());
