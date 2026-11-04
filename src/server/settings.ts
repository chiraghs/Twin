import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db, dbPath, nowIso, transaction } from "./db/connection";
import { dataDir, displayPath, isServerless } from "./runtime";

/**
 * Integration settings that an admin can change in the UI.
 *
 * Each setting overrides the environment variable of the same name (docker-compose.yml / .env.local),
 * so a deployment works out of the box and the UI only changes what it needs to. Saved settings
 * live in the SQLite tables `app_settings` (current values) and `app_settings_history` (every
 * change, never a secret's value). Secret values are
 * write-only: they are never returned to the browser or written to the audit trail.
 */

type Option = { value: string; label: string };
interface SettingDef {
  label: string;
  help: string;
  secret?: boolean;
  options?: Option[];
  /** Effective value when nothing is set. */
  defaultValue?: string;
  placeholder?: string;
  /** Only relevant for these AI providers (the form hides it for others). */
  providers?: AiProviderId[];
  /** Returns an error message, or null when valid. Empty values are always allowed (they turn the setting off). */
  validate?: (v: string) => string | null;
}

const httpsUrl = (v: string) => {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "Not a valid URL";
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return "Use https:// (http://localhost is allowed for local testing)";
  if (u.username || u.password) return "Don't put credentials in the URL";
  if (u.hostname === "169.254.169.254" || u.hostname === "metadata.google.internal") return "This host is not allowed";
  return null;
};
const pattern = (re: RegExp, msg: string) => (v: string) => (re.test(v) ? null : msg);

export const AI_PROVIDERS = ["meta"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const SETTINGS = {

  AI_ENABLED: {
    defaultValue: "true",
    label: "AI agents",
    help: "Turn AI off to stop all Meta Model API calls; agents then write their summaries from the analysis.",
    options: [
      { value: "true", label: "On" },
      { value: "false", label: "Off" },
    ],
  },
  MODEL_API_KEY: {
    label: "Meta Model API key",
    help: "From the Meta developer platform (dev.meta.ai). Powers Muse Spark, Muse Wonder, Muse Image, SAM 3.1 and Muse Voice. Stored on the server; never shown again.",
    secret: true,
    validate: pattern(/^\S{20,400}$/, "That doesn't look like an API key"),
  },
  META_MODEL: {
    defaultValue: "muse-spark-1.3",
    label: "Agent model",
    help: "Muse Spark model for the copilot, the Twin Builder, footage review and chat edits.",
    placeholder: "muse-spark-1.3",
    validate: pattern(/^[a-z0-9][a-z0-9.\-]{2,60}$/, "Use a model id such as muse-spark-1.3"),
  },
  META_REASONING_MODEL: {
    defaultValue: "muse-wonder-1.0",
    label: "Reasoning model",
    help: "Model for the orchestrator's decision briefing (deeper reasoning). Falls back to the agent model if it fails.",
    placeholder: "muse-wonder-1.0",
    validate: pattern(/^[a-z0-9][a-z0-9.\-]{2,60}$/, "Use a model id such as muse-wonder-1.0"),
  },
  INTELLIGENCE_BACKEND_URL: {
    label: "Service URL",
    help: "Base URL of the Python intelligence backend (FastAPI: maintenance, AOI, supply chain, demand planning, copilots). http://localhost:8000 when running locally.",
    placeholder: "http://localhost:8000",
    validate: httpsUrl,
  },
  INTELLIGENCE_BACKEND_TOKEN: {
    label: "Service token",
    help: "Shared bearer token: the web app sends it to the intelligence backend, which requires it when TWIN_SERVICE_TOKEN is set there. Stored on the server; never shown again.",
    secret: true,
    validate: pattern(/^[A-Za-z0-9._~+\-]{16,200}$/, "Use 16–200 URL-safe characters"),
  },
  VISION_SERVICE_URL: {
    label: "Service URL",
    help: "Base URL of the Python vision service (OpenCV), e.g. http://vision:8080 in Docker Compose or http://localhost:8080 locally.",
    placeholder: "http://localhost:8080",
    validate: httpsUrl,
  },
  VISION_SERVICE_TOKEN: {
    label: "Service token",
    help: "Shared bearer token sent to the vision service (its VISION_SERVICE_TOKEN). Leave empty for a local service without auth. Stored on the server; never shown again.",
    secret: true,
    validate: pattern(/^[A-Za-z0-9._~+\-]{16,200}$/, "Use 16–200 URL-safe characters"),
  },



  TELEMETRY_SOURCE: {
    defaultValue: "simulated",
    label: "Telemetry source",
    help: "With MQTT, readings published to the telemetry topic override the simulated measurements of matching assets.",
    options: [
      { value: "simulated", label: "Built-in plant model" },
      { value: "mqtt", label: "MQTT (needs a broker and topic)" },
    ],
  },
  S3_ENDPOINT: {
    label: "Endpoint",
    help: "S3-compatible object storage for per-asset documents under assets/<assetId>/ (MinIO, SeaweedFS, Ceph, AWS S3…).",
    placeholder: "http://localhost:9000",
    validate: httpsUrl,
  },
  S3_BUCKET: {
    label: "Bucket",
    help: "Bucket holding the documents.",
    placeholder: "plant-documents",
    validate: pattern(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, "Not a valid bucket name"),
  },
  S3_REGION: {
    defaultValue: "us-east-1",
    label: "Region",
    help: "Signing region (MinIO accepts us-east-1).",
    placeholder: "us-east-1",
    validate: pattern(/^[a-z0-9-]{2,40}$/, "Not a valid region"),
  },
  S3_ACCESS_KEY_ID: {
    label: "Access key",
    help: "Access key id for the bucket (read-only is enough).",
    validate: pattern(/^\S{3,200}$/, "Not a valid access key"),
  },
  S3_SECRET_ACCESS_KEY: {
    label: "Secret key",
    help: "Secret key for the bucket. Stored on the server; never shown again.",
    secret: true,
    validate: pattern(/^\S{8,200}$/, "Not a valid secret key"),
  },

  MQTT_BROKER_URL: {
    label: "Broker URL",
    help: "mqtt:// or mqtts:// address of the broker (e.g. Eclipse Mosquitto or EMQX). Test connection subscribes to the topic.",
    placeholder: "mqtts://broker.plant.example:8883",
    validate: (v) => {
      try {
        const u = new URL(v);
        if (!["mqtt:", "mqtts:", "tcp:", "ssl:"].includes(u.protocol)) return "Use mqtt://, mqtts://, tcp:// or ssl://";
        if (u.username || u.password) return "Don't put credentials in the URL";
        return null;
      } catch {
        return "Not a valid URL";
      }
    },
  },
  MQTT_TOPIC: {
    label: "Topic",
    help: "Topic filter for telemetry: JSON {assetId, vibration?, temperature?, powerKw?}.",
    placeholder: "plant/+/telemetry",
    validate: pattern(/^[^\s#]{1,200}(#)?$/, "Not a valid topic filter"),
  },
  MQTT_USERNAME: {
    label: "Username",
    help: "Broker username (optional).",
    validate: pattern(/^\S{1,120}$/, "Not a valid username"),
  },
  MQTT_PASSWORD: {
    label: "Password",
    help: "Broker password (optional). Stored on the server; never shown again.",
    secret: true,
    validate: pattern(/^\S{1,200}$/, "Not a valid password"),
  },
  TWIN_MCP_ENABLED: {
    defaultValue: "true",
    label: "MCP endpoint",
    help: "Turn the /api/mcp endpoint off to stop external agents using the twin's tools.",
    options: [
      { value: "true", label: "On" },
      { value: "false", label: "Off" },
    ],
  },
  TWIN_MCP_TOKEN: {
    label: "Access token",
    help: "When set, MCP clients must send Authorization: Bearer <token>. Stored on the server; never shown again.",
    secret: true,
    validate: pattern(/^[A-Za-z0-9._~+\-]{16,200}$/, "Use 16–200 URL-safe characters"),
  },
} satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const isSettingKey = (k: string): k is SettingKey => k in SETTINGS;

export type SettingSource = "ui" | "environment" | "unset";
export interface SettingView {
  key: SettingKey;
  label: string;
  help: string;
  secret: boolean;
  providers: AiProviderId[] | null;
  options: Option[] | null;
  defaultValue: string | null;
  placeholder: string | null;
  source: SettingSource;
  isSet: boolean;
  /** Current value; always null for secrets. */
  value: string | null;
}

interface Persisted {
  version: 1;
  values: Partial<Record<SettingKey, string>>;
  updatedAt: string | null;
  updatedBy: string | null;
}

type Store = {
  data: Persisted;
  loaded: boolean;
  writing: Promise<void>;
};
const g = globalThis as unknown as { __twinSettings?: Store };
const store: Store = (g.__twinSettings ??= {
  data: { version: 1, values: {}, updatedAt: null, updatedBy: null },
  loaded: false,
  writing: Promise.resolve(),
});

/** Settings files written by earlier builds; imported into SQLite once. */
const LEGACY_FILE = () => path.join(dataDir(), "settings.json");

function sanitise(raw: unknown): Persisted {
  const values: Partial<Record<SettingKey, string>> = {};
  const r = (raw ?? {}) as Partial<Persisted>;
  for (const [k, v] of Object.entries(r.values ?? {})) if (isSettingKey(k) && typeof v === "string") values[k] = v;
  return { version: 1, values, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null, updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : null };
}

function loadLocalSync() {
  try {
    const conn = db();
    const rows = conn.prepare("SELECT key, value, updated_at, updated_by FROM app_settings").all() as { key: string; value: string; updated_at: string; updated_by: string | null }[];
    if (!rows.length && fs.existsSync(LEGACY_FILE())) {
      const legacy = sanitise(JSON.parse(fs.readFileSync(LEGACY_FILE(), "utf8")));
      writeLocal(legacy, {}, legacy.updatedBy ?? "import");
      fs.renameSync(LEGACY_FILE(), `${LEGACY_FILE()}.imported`);
      store.data = legacy;
      return;
    }
    const values: Partial<Record<SettingKey, string>> = {};
    let updatedAt: string | null = null;
    let updatedBy: string | null = null;
    for (const r of rows) {
      if (!isSettingKey(r.key)) continue;
      values[r.key] = r.value;
      if (!updatedAt || r.updated_at > updatedAt) {
        updatedAt = r.updated_at;
        updatedBy = r.updated_by;
      }
    }
    store.data = { version: 1, values, updatedAt, updatedBy };
  } catch (e) {
    console.warn("[settings] could not read settings from SQLite:", e);
  }
}

/** Write the saved settings to SQLite and record what changed (secrets as "set"/"cleared" only). */
function writeLocal(next: Persisted, prev: Partial<Record<SettingKey, string>>, by: string) {
  const conn = db();
  const now = nowIso();
  transaction(conn, () => {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next.values)]) as Set<SettingKey>;
    for (const k of keys) {
      const before = prev[k];
      const after = next.values[k];
      if (before === after) continue;
      const secret = !!(SETTINGS[k] as SettingDef).secret;
      if (after === undefined) {
        conn.prepare("DELETE FROM app_settings WHERE key = ?").run(k);
        conn.prepare("INSERT INTO app_settings_history (key, action, value, changed_at, changed_by) VALUES (?, 'reverted', NULL, ?, ?)").run(k, now, by);
      } else {
        conn
          .prepare(
            `INSERT INTO app_settings (key, value, is_secret, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          )
          .run(k, after, secret ? 1 : 0, now, by);
        const action = after === "" ? "cleared" : "set";
        conn.prepare("INSERT INTO app_settings_history (key, action, value, changed_at, changed_by) VALUES (?, ?, ?, ?, ?)").run(k, action, secret ? null : after, now, by);
      }
    }
  });
}

/** Change history of the integration settings (newest first). Secret values are never stored. */
export function settingsHistory(limit = 100) {
  return db()
    .prepare("SELECT key, action, value, changed_at AS changedAt, changed_by AS changedBy FROM app_settings_history ORDER BY id DESC LIMIT ?")
    .all(limit) as { key: string; action: string; value: string | null; changedAt: string; changedBy: string | null }[];
}

/** Load saved settings from SQLite. Called once at server start. */
export async function loadSettings() {
  loadLocalSync();
  store.loaded = true;
}

/** Settings live in SQLite on this host; kept for callers that await a fresh read. */
export async function ensureFreshSettings() {
  ensureLoaded();
}

function ensureLoaded() {
  if (!store.loaded) {
    loadLocalSync();
    store.loaded = true;
  }
}

/** The effective value: the UI setting when one is saved (an empty string turns it off), else the environment. */
export function setting(key: SettingKey): string | undefined {
  ensureLoaded();
  const v = store.data.values[key];
  return v !== undefined ? v : process.env[key];
}

export function settingSource(key: SettingKey): SettingSource {
  ensureLoaded();
  if (store.data.values[key] !== undefined) return "ui";
  return process.env[key] ? "environment" : "unset";
}


export function describeSettings(keys: SettingKey[]): SettingView[] {
  return keys.map((key) => {
    const def: SettingDef = SETTINGS[key];
    const v = setting(key) ?? "";
    return {
      key,
      label: def.label,
      help: def.help,
      secret: !!def.secret,
      providers: def.providers ?? null,
      options: def.options ?? null,
      defaultValue: def.defaultValue ?? null,
      placeholder: def.placeholder ?? null,
      source: settingSource(key),
      isSet: v !== "",
      value: def.secret ? null : v,
    };
  });
}

export function settingsStorage() {
  return {
    kind: "sqlite" as const,
    where: `${displayPath(dbPath())} · app_settings`,
    ok: true,
    detail: isServerless() ? "Saved in SQLite on this instance; mount a persistent volume for the data directory to keep settings across restarts." : null,
    updatedAt: store.data.updatedAt,
    updatedBy: store.data.updatedBy,
  };
}

export class SettingsError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
  }
}

/**
 * Validate and apply changes. `null` removes the UI value (back to the environment); a string
 * (possibly empty) overrides it. Returns the keys whose effective value changed.
 */
export async function updateSettings(changes: Record<string, string | null>, by: string): Promise<SettingKey[]> {
  ensureLoaded();
  const issues: string[] = [];
  const next = { ...store.data.values };
  for (const [k, raw] of Object.entries(changes)) {
    if (!isSettingKey(k)) {
      issues.push(`${k}: unknown setting`);
      continue;
    }
    const def: SettingDef = SETTINGS[k];
    if (raw === null) {
      delete next[k];
      continue;
    }
    const v = raw.trim();
    if (v.length > 500) issues.push(`${def.label}: too long`);
    else if (v && def.options && !def.options.some((o) => o.value === v)) issues.push(`${def.label}: choose one of ${def.options.map((o) => o.value).join(", ")}`);
    else if (v && def.validate) {
      const err = def.validate(v);
      if (err) issues.push(`${def.label}: ${err}`);
    }
    next[k] = v;
  }
  if (issues.length) throw new SettingsError(issues);
  const before = Object.fromEntries(SETTING_KEYS.map((k) => [k, setting(k) ?? ""]));
  const prevValues = { ...store.data.values };
  store.data = { version: 1, values: next, updatedAt: new Date().toISOString(), updatedBy: by };
  const changed = SETTING_KEYS.filter((k) => (setting(k) ?? "") !== before[k]);
  await persist(prevValues, by);
  return changed;
}

async function persist(prevValues: Partial<Record<SettingKey, string>>, by: string) {
  const data = store.data;
  const write = async () => writeLocal(data, prevValues, by);
  store.writing = store.writing.then(write, write);
  return store.writing;
}

/** Test hook: forget loaded settings. */
export function __resetSettingsForTests() {
  store.data = { version: 1, values: {}, updatedAt: null, updatedBy: null };
  store.loaded = true;
}
