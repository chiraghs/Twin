import "server-only";
import type { DatabaseSync } from "node:sqlite";
import type { Migration } from "./connection";
import { ENTITY_TABLES, entityDdl } from "./factory-model";

/**
 * Web-app schema (component "web"). The Python backend migrates its own tables (component
 * "backend") in the same database file; see backend/core/db.
 */

const hasColumn = (db: DatabaseSync, table: string, col: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
const hasTable = (db: DatabaseSync, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

export const WEB_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "normalised factory twin, settings, preferences, copilot, AI call log",
    up: (db) => {
      // Earlier builds kept each facility as one JSON blob; keep it aside so it can be imported.
      if (hasTable(db, "facilities") && hasColumn(db, "facilities", "state_json")) db.exec("ALTER TABLE facilities RENAME TO facilities_legacy");
      if (hasTable(db, "active_session")) db.exec("ALTER TABLE active_session RENAME TO active_session_legacy");

      db.exec(`
        CREATE TABLE facilities (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          industry TEXT NOT NULL,
          location TEXT NOT NULL,
          production_type TEXT NOT NULL,
          data_source TEXT,
          is_demo INTEGER NOT NULL DEFAULT 0,
          schema_version INTEGER NOT NULL,
          seed INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        -- Singleton parts of each facility's aggregate (clock, cost model, counters, layout, spec…)
        CREATE TABLE facility_state (
          facility_id TEXT PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
          clock TEXT NOT NULL,
          cost_model TEXT NOT NULL,
          counters TEXT NOT NULL,
          finished_goods TEXT NOT NULL,
          latest TEXT NOT NULL,
          rule_runtime TEXT,
          layout TEXT,
          twin_spec TEXT,
          sim_hour REAL,
          live_telemetry INTEGER,
          updated_at TEXT NOT NULL
        );

        -- Which facility the app shows (per deployment)
        CREATE TABLE active_facility (
          id TEXT PRIMARY KEY CHECK (id = 'current'),
          facility_id TEXT NOT NULL REFERENCES facilities(id),
          updated_at TEXT NOT NULL
        );

        -- Integration settings set in Admin → Integrations (override environment variables)
        CREATE TABLE app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          is_secret INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          updated_by TEXT
        );
        -- Every change, never the value of a secret
        CREATE TABLE app_settings_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('set', 'cleared', 'reverted')),
          value TEXT,
          changed_at TEXT NOT NULL,
          changed_by TEXT
        );
        CREATE INDEX ix_settings_history_key ON app_settings_history (key, changed_at);

        -- Per-browser preferences and drafts (UI layout, simulator workbench, builder / playground drafts, copilot view)
        CREATE TABLE client_preferences (
          client_id TEXT NOT NULL,
          namespace TEXT NOT NULL,
          value TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (client_id, namespace)
        );

        -- Copilot conversations (server side: what the model saw)
        CREATE TABLE copilot_sessions (
          id TEXT PRIMARY KEY,
          client_id TEXT,
          facility_id TEXT,
          model TEXT,
          pending_confirmation TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE copilot_messages (
          session_id TEXT NOT NULL REFERENCES copilot_sessions(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
          parts TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (session_id, seq)
        );
        CREATE TABLE copilot_evidence (
          session_id TEXT NOT NULL REFERENCES copilot_sessions(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL,
          data TEXT NOT NULL,
          PRIMARY KEY (session_id, seq)
        );

        -- Every Meta Model API call from either backend (observability, cost review)
        CREATE TABLE IF NOT EXISTS ai_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          component TEXT NOT NULL,
          model TEXT NOT NULL,
          purpose TEXT NOT NULL,
          ok INTEGER NOT NULL,
          latency_ms INTEGER,
          detail TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_ai_calls_created ON ai_calls (created_at);
      `);
      for (const t of ENTITY_TABLES) db.exec(entityDdl(t));
    },
  },
];
