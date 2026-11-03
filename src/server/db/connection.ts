import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "../runtime";
import { WEB_MIGRATIONS } from "./schema";

/**
 * The Twin database: one SQLite file shared by the web app (this process) and the Python
 * intelligence backend. Each component owns its tables and its migrations, recorded in
 * `schema_migrations (component, version)`. WAL mode lets the two processes read while one writes.
 *
 *   TWIN_DB_PATH   explicit database file
 *   TWIN_DATA_DIR  directory holding twin.db (default .data, or /tmp/twin on serverless)
 */

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

export const dbPath = () => process.env.TWIN_DB_PATH || path.join(dataDir(), "twin.db");

const g = globalThis as unknown as { __twinDb?: Map<string, DatabaseSync> };
const open = (g.__twinDb ??= new Map());

/** The shared connection for the current database path (migrated on first use). */
export function db(): DatabaseSync {
  const file = dbPath();
  let conn = open.get(file);
  if (!conn) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    conn = new DatabaseSync(file);
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    migrate(conn, "web", WEB_MIGRATIONS);
    open.set(file, conn);
  }
  return conn;
}

/** Close every open connection (tests). */
export function closeDb() {
  for (const c of open.values()) c.close();
  open.clear();
}

export function migrate(conn: DatabaseSync, component: string, migrations: Migration[]) {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    component TEXT NOT NULL,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (component, version)
  )`);
  const applied = new Set(
    (conn.prepare("SELECT version FROM schema_migrations WHERE component = ?").all(component) as { version: number }[]).map((r) => r.version),
  );
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    transaction(conn, () => {
      m.up(conn);
      conn.prepare("INSERT INTO schema_migrations (component, version, name, applied_at) VALUES (?, ?, ?, ?)").run(component, m.version, m.name, new Date().toISOString());
    });
  }
}

/** Run `fn` inside a transaction (nested calls join the outer one). */
export function transaction<T>(conn: DatabaseSync, fn: () => T): T {
  const depth = (txDepth.get(conn) ?? 0) + 1;
  txDepth.set(conn, depth);
  if (depth === 1) conn.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    if (depth === 1) conn.exec("COMMIT");
    return r;
  } catch (e) {
    if (depth === 1) conn.exec("ROLLBACK");
    throw e;
  } finally {
    txDepth.set(conn, depth - 1);
  }
}
const txDepth = new WeakMap<DatabaseSync, number>();

export const nowIso = () => new Date().toISOString();
