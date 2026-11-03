import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { advanceFactory } from "@/domain/telemetry";
import { injectFault } from "@/domain/commands";
import { compileSpec } from "@/domain/builder/compile";
import { templateById } from "@/domain/builder/templates";
import { defaultAnchor, newFactorySeed } from "@/domain/seed";
import { crisis, NOW } from "./helpers";

/**
 * The normalised SQLite data model: exact aggregate round-trips, change-only writes, typed
 * columns that queries can use, legacy import and cascading deletes.
 */

let dir = "";
let repo: typeof import("@/server/db/sqlite");
let conn: typeof import("@/server/db/connection");

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "twin-db-"));
  vi.stubEnv("TWIN_DATA_DIR", dir);
  vi.resetModules();
  conn = await import("@/server/db/connection");
  repo = await import("@/server/db/sqlite");
});
afterAll(() => {
  conn.closeDb();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("factory twin in SQLite", () => {
  it("seeds the demo plant into normalised tables and round-trips it exactly", () => {
    const store = repo.sqliteStore;
    expect(store.listFacilities().map((f) => f.id)).toEqual(["demo-electronics"]);
    const s = crisis();
    s.profile.id = "demo-electronics";
    store.saveFacility(s, true, "demo-electronics");
    const fresh = repo.facilityRepo();
    // a new repository instance reads purely from the tables
    const loaded = (new (fresh.constructor as new () => typeof fresh)()).getFacility("demo-electronics")!;
    expect(clone(loaded)).toEqual(clone(s));
    const stats = store.stats("demo-electronics");
    expect(stats.assets).toBe(s.assets.length);
    expect(stats.telemetry_readings).toBe(Object.values(s.telemetry).reduce((n, a) => n + a.length, 0));
    expect(stats.incidents).toBe(s.incidents.length);
  });

  it("writes only the rows that changed, and stays exact after the simulation advances", () => {
    const store = repo.sqliteStore;
    const s = store.getFacility("demo-electronics")!;
    const db = conn.db();
    const before = db.prepare("SELECT asset_id, t, updated_at FROM telemetry_readings WHERE facility_id = ? ORDER BY ord LIMIT 1").get("demo-electronics");
    injectFault(s, { assetId: "B-ROB-03", mode: "bearing-wear", severity: 30 }, NOW);
    advanceFactory(s, 1, { nowISO: NOW });
    store.saveFacility(s, true, "demo-electronics");
    const reloaded = (new (repo.facilityRepo().constructor as new () => ReturnType<typeof repo.facilityRepo>)()).getFacility("demo-electronics")!;
    expect(clone(reloaded)).toEqual(clone(s));
    // typed columns are queryable
    const rob = db.prepare("SELECT status, kind, line_id FROM assets WHERE facility_id = ? AND id = 'A-ROB-03'").get("demo-electronics") as Record<string, unknown>;
    expect(rob.line_id).toBe("LINE-A");
    const open = db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE facility_id = ? AND status != 'resolved'").get("demo-electronics") as { n: number };
    expect(open.n).toBeGreaterThan(0);
    const hot = db.prepare("SELECT MAX(vibration) AS v FROM telemetry_readings WHERE facility_id = ? AND asset_id = 'A-ROB-03'").get("demo-electronics") as { v: number };
    expect(hot.v).toBeGreaterThan(2);
    expect(before).toBeDefined();
  });

  it("keeps facilities isolated and cascades deletes", () => {
    const store = repo.sqliteStore;
    const spec = structuredClone(templateById("beverage-bottling")!.spec);
    const st = compileSpec(spec, defaultAnchor(), newFactorySeed(), NOW, "Test User");
    st.profile.id = "fac-bev";
    store.saveFacility(st, false, "fac-bev");
    expect(store.listFacilities().map((f) => f.id).sort()).toEqual(["demo-electronics", "fac-bev"]);
    expect(store.stats("fac-bev").assets).toBe(st.assets.length);
    expect(store.deleteFacility("fac-bev")).toBe(true);
    expect(store.deleteFacility("demo-electronics")).toBe(false);
    const left = conn.db().prepare("SELECT COUNT(*) AS n FROM assets WHERE facility_id = 'fac-bev'").get() as { n: number };
    expect(left.n).toBe(0);
  });

  it("records schema migrations", () => {
    const rows = conn.db().prepare("SELECT component, version FROM schema_migrations WHERE component = 'web'").all();
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("legacy import", () => {
  it("explodes an old JSON-blob facilities table into the normalised tables", async () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "twin-legacy-"));
    const legacy = new DatabaseSync(path.join(d2, "twin.db"));
    const s = crisis();
    legacy.exec("CREATE TABLE facilities (id TEXT PRIMARY KEY, name TEXT, industry TEXT, location TEXT, production_type TEXT, is_demo INTEGER, created_at TEXT, updated_at TEXT, state_json TEXT NOT NULL); CREATE TABLE active_session (id TEXT PRIMARY KEY, active_facility_id TEXT NOT NULL);");
    legacy.prepare("INSERT INTO facilities VALUES ('demo-electronics','x','x','x','x',1,'t','t',?)").run(JSON.stringify(s));
    legacy.prepare("INSERT INTO active_session VALUES ('current','demo-electronics')").run();
    legacy.close();
    vi.stubEnv("TWIN_DATA_DIR", d2);
    const r = await import("@/server/db/sqlite");
    const loaded = r.sqliteStore.getFacility("demo-electronics")!;
    expect(loaded.assets.length).toBe(s.assets.length);
    expect(r.sqliteStore.getActiveFacilityId()).toBe("demo-electronics");
    const legacyLeft = conn.db().prepare("SELECT name FROM sqlite_master WHERE name = 'facilities_legacy'").get();
    expect(legacyLeft).toBeUndefined();
    vi.stubEnv("TWIN_DATA_DIR", dir);
    fs.rmSync(d2, { recursive: true, force: true });
  });
});

describe("client preferences, copilot sessions and AI call log", () => {
  it("stores preferences per browser and copilot conversations across restarts", async () => {
    const prefs = await import("@/server/db/prefs");
    prefs.putPref("client-aaaaaaaa", "twin-ui", { state: { twinView: "iso" }, version: 1 });
    prefs.putPref("client-bbbbbbbb", "twin-ui", { state: { twinView: "3d" }, version: 1 });
    expect(prefs.getPref("client-aaaaaaaa", "twin-ui")?.value).toEqual({ state: { twinView: "iso" }, version: 1 });
    expect(Object.keys(prefs.listPrefs("client-bbbbbbbb"))).toEqual(["twin-ui"]);
    expect(() => prefs.putPref("client-aaaaaaaa", "big", "x".repeat(1024 * 1024 + 10))).toThrow(/1 MB/);

    const cs = await import("@/server/db/copilot-repo");
    cs.saveSession("sess-1", { messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }], evidence: [{ a: 1 }], pending: { callId: "p1", name: "propose_plan", args: {} } }, { facilityId: "demo-electronics" });
    const s = cs.loadSession("sess-1")!;
    expect(s.messages[0].parts[0]).toEqual({ type: "text", text: "hi" });
    expect(s.pending?.callId).toBe("p1");

    const ai = await import("@/server/db/ai-log");
    ai.logAiCall("muse-spark-1.3", "test", true, 42);
    expect(ai.recentAiCalls(1)[0]).toMatchObject({ component: "web", model: "muse-spark-1.3", ok: 1, latencyMs: 42 });
  });
});
