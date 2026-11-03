import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir, displayPath, isServerless, writeFileAtomic } from "./runtime";

/**
 * Integration settings that an admin can change in the UI.
 *
 * Each setting overrides the environment variable of the same name (apphosting.yaml / .env.local),
 * so a deployment works out of the box and the UI only changes what it needs to. Saved settings
 * are written to a private Cloud Storage object when TWIN_CONFIG_BUCKET is set (durable
 * across instance restarts), and always to a local JSON file. Secret values are write-only: they
 * are never returned to the browser or written to the audit trail.
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
  GOOGLE_CLOUD_PROJECT: {
    label: "Google Cloud project",
    help: "Optional. Project id used for BigQuery, Pub/Sub and Cloud Storage. The server's service account needs access to each service you turn on.",
    placeholder: "my-project-id",
    validate: pattern(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "Project ids are 6–30 lowercase letters, digits or hyphens"),
  },
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
  VISION_SERVICE_URL: {
    label: "Service URL",
    help: "Base URL of the Python vision service (Cloud Run URL, or http://localhost:8000 when running locally).",
    placeholder: "https://twin-vision-xxxx.asia-southeast1.run.app",
    validate: httpsUrl,
  },
  VISION_SERVICE_AUTH: {
    defaultValue: "id-token",
    label: "Authentication",
    help: "Cloud Run services deployed with --no-allow-unauthenticated need a Google ID token.",
    options: [
      { value: "id-token", label: "Google ID token (Cloud Run IAM)" },
      { value: "none", label: "None (public or local service)" },
    ],
  },
  BIGQUERY_DATASET: {
    label: "Dataset",
    help: "Dataset holding the tables in infra/bigquery/schema.sql.",
    placeholder: "twin",
    validate: pattern(/^[A-Za-z0-9_]{1,1024}$/, "Dataset names use letters, digits and underscores"),
  },
  PUBSUB_TELEMETRY_SUBSCRIPTION: {
    label: "Subscription",
    help: "Pull subscription carrying JSON messages {assetId, vibration, temperature, powerKw}.",
    placeholder: "twin-telemetry-sub",
    validate: pattern(/^[A-Za-z][A-Za-z0-9\-_.~+%]{2,254}$/, "Not a valid subscription id"),
  },
  TELEMETRY_SOURCE: {
    defaultValue: "simulated",
    label: "Telemetry source",
    help: "With Pub/Sub, incoming readings override the simulated measurements of matching assets.",
    options: [
      { value: "simulated", label: "Built-in plant model" },
      { value: "pubsub", label: "Pub/Sub (needs a subscription)" },
    ],
  },
  GCS_BUCKET: {
    label: "Bucket",
    help: "Bucket with per-asset documents under assets/<assetId>/.",
    placeholder: "my-plant-documents",
    validate: pattern(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/, "Not a valid bucket name"),
  },
  MQTT_BROKER_URL: {
    label: "Broker URL",
    help: "mqtt:// or mqtts:// address of the broker. Only reachability is tested in this version.",
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
    help: "Topic filter for telemetry.",
    placeholder: "plant/+/telemetry",
    validate: pattern(/^[^\s#]{1,200}(#)?$/, "Not a valid topic filter"),
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
  durable: { ok: boolean; detail: string } | null;
  writing: Promise<void>;
  /** Local changes since start; a bucket read that started before a change must not overwrite it. */
  writes: number;
  lastReadAt: number;
  refreshing: Promise<void> | null;
};
const g = globalThis as unknown as { __twinSettings?: Store };
const store: Store = (g.__twinSettings ??= {
  data: { version: 1, values: {}, updatedAt: null, updatedBy: null },
  loaded: false,
  durable: null,
  writing: Promise.resolve(),
  writes: 0,
  lastReadAt: 0,
  refreshing: null,
});
/** Other instances (or a rollout's new revision) pick up saved changes within this time. */
const REFRESH_MS = 60_000;

const FILE = path.join(dataDir(), "settings.json");
const OBJECT = "twin/settings.json";
const bucket = () => process.env.TWIN_CONFIG_BUCKET || "";

function sanitise(raw: unknown): Persisted {
  const values: Partial<Record<SettingKey, string>> = {};
  const r = (raw ?? {}) as Partial<Persisted>;
  for (const [k, v] of Object.entries(r.values ?? {})) if (isSettingKey(k) && typeof v === "string") values[k] = v;
  return { version: 1, values, updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null, updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : null };
}

function loadLocalSync() {
  try {
    if (fs.existsSync(FILE)) store.data = sanitise(JSON.parse(fs.readFileSync(FILE, "utf8")));
  } catch (e) {
    console.warn("[settings] could not read local settings:", e);
  }
}

/** Read the saved settings from Cloud Storage once. Never throws; records the outcome in store.durable. */
async function readBucket(timeoutMs: number) {
  const writesAtStart = store.writes;
  try {
    const { gcpFetch } = await import("./integrations/gcp");
    const body = await gcpFetch(`https://storage.googleapis.com/storage/v1/b/${bucket()}/o/${encodeURIComponent(OBJECT)}?alt=media`, { timeoutMs });
    if (store.writes === writesAtStart) store.data = sanitise(body);
    store.durable = { ok: true, detail: `Loaded from gs://${bucket()}/${OBJECT}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("404")) {
      if (store.writes === writesAtStart) store.data = sanitise(null);
      store.durable = { ok: true, detail: `gs://${bucket()}/${OBJECT} (nothing saved yet)` };
    } else store.durable = { ok: false, detail: `Could not read gs://${bucket()}/${OBJECT}: ${msg === "This operation was aborted" ? "timed out" : msg}` };
  }
  store.lastReadAt = Date.now();
}

/** Load saved settings (Cloud Storage when configured, else the local file). Called once at server start. */
export async function loadSettings() {
  if (bucket()) {
    // The first call on a cold instance can be slow (credentials, connection setup): retry before giving up.
    for (let attempt = 0; attempt < 3; attempt++) {
      await readBucket(15_000);
      if (store.durable?.ok) break;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (!store.durable?.ok) loadLocalSync();
  } else loadLocalSync();
  store.loaded = true;
}

/** Re-read the bucket in the background when the last read failed or is older than REFRESH_MS. */
function maybeRefresh() {
  if (!bucket() || store.refreshing) return;
  if (store.durable?.ok && Date.now() - store.lastReadAt < REFRESH_MS) return;
  store.refreshing = readBucket(15_000).finally(() => {
    store.refreshing = null;
  });
}

/** Wait for an up-to-date read of the saved settings (used before showing or changing them). */
export async function ensureFreshSettings() {
  ensureLoaded();
  if (!bucket()) return;
  maybeRefresh();
  if (store.refreshing && !store.durable?.ok) await store.refreshing;
  else if (store.refreshing) await Promise.race([store.refreshing, new Promise((r) => setTimeout(r, 3000))]);
}

function ensureLoaded() {
  if (!store.loaded) {
    // Synchronous fallback for code paths that run before loadSettings() (local development).
    loadLocalSync();
    store.loaded = true;
  }
  maybeRefresh();
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
  if (bucket()) return { kind: "cloud-storage" as const, where: `gs://${bucket()}/${OBJECT}`, ok: store.durable?.ok ?? true, detail: store.durable?.detail ?? null, updatedAt: store.data.updatedAt, updatedBy: store.data.updatedBy };
  return {
    kind: "local-file" as const,
    where: displayPath(FILE),
    ok: true,
    detail: isServerless() ? "Saved on this server instance only; set TWIN_CONFIG_BUCKET to keep settings across restarts." : null,
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
  if (bucket()) {
    // Start from the latest saved settings, and never overwrite saved settings we could not read.
    if (store.refreshing) await store.refreshing;
    if (!store.durable?.ok || Date.now() - store.lastReadAt > 5_000) await readBucket(15_000);
    if (!store.durable?.ok) throw new Error(`Saved settings could not be read (${store.durable?.detail ?? "unknown error"}), so nothing was changed. Try again in a moment.`);
  }
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
  store.writes++;
  store.data = { version: 1, values: next, updatedAt: new Date().toISOString(), updatedBy: by };
  const changed = SETTING_KEYS.filter((k) => (setting(k) ?? "") !== before[k]);
  await persist();
  return changed;
}

async function persist() {
  const snapshot = JSON.stringify(store.data);
  const write = async () => {
    try {
      writeFileAtomic(FILE, snapshot, { mode: 0o600 });
    } catch (e) {
      console.warn("[settings] could not write local settings:", e);
    }
    if (!bucket()) return;
    try {
      const { gcpFetch } = await import("./integrations/gcp");
      await gcpFetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket()}/o?uploadType=media&name=${encodeURIComponent(OBJECT)}`, { method: "POST", body: snapshot });
      store.durable = { ok: true, detail: `Saved to gs://${bucket()}/${OBJECT}` };
    } catch (e) {
      store.durable = { ok: false, detail: `Could not save to gs://${bucket()}/${OBJECT}: ${e instanceof Error ? e.message : String(e)}` };
      throw new Error(`Settings applied on this instance, but saving to Cloud Storage failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  store.writing = store.writing.then(write, write);
  return store.writing;
}

/** Test hook: forget loaded settings. */
export function __resetSettingsForTests() {
  store.data = { version: 1, values: {}, updatedAt: null, updatedBy: null };
  store.loaded = true;
  store.durable = null;
  store.refreshing = null;
}
