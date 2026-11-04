import "server-only";
import { appendAudit } from "@/domain/audit";
import { aiCapabilities, aiConfig, aiRuntime, modelLabel, PROVIDER_NAME, resetAiRuntime } from "@/server/ai/config";
import { testAi } from "@/server/ai/provider";
import { isServerless } from "@/server/runtime";
import { describeSettings, setting, settingsStorage, SETTINGS, updateSettings, type SettingKey, type SettingView } from "@/server/settings";
import { mutate, persistenceInfo } from "@/server/store";
import { mqtt, objectStorage } from "./adapters";
import { testVisionService, visionService } from "./vision-service";
import { intelligenceBackend, testIntelligenceBackend } from "./backend";

export type IntegrationState = "active" | "active-simulated" | "not-configured" | "configured-untested" | "connected" | "error";

export interface IntegrationStatus {
  id: string;
  name: string;
  service: string;
  purpose: string;
  state: IntegrationState;
  detail: string;
  /** Settings an admin can change in the UI (each overrides the environment variable of the same name). */
  settings: SettingView[];
  fallback: string;
  lastCheckedAt: string | null;
  testable: boolean;
}

type Check = { ok: boolean; detail: string; at: string };
const g = globalThis as unknown as { __twinChecks?: Record<string, Check> };
const checks: Record<string, Check> = (g.__twinChecks ??= {});

/** Which settings belong to which integration card. */
export const INTEGRATION_SETTINGS: Record<string, SettingKey[]> = {
  telemetry: ["TELEMETRY_SOURCE"],
  "meta-ai": ["AI_ENABLED", "MODEL_API_KEY", "META_MODEL", "META_REASONING_MODEL"],
  "vision-service": ["VISION_SERVICE_URL", "VISION_SERVICE_TOKEN"],
  "intelligence-backend": ["INTELLIGENCE_BACKEND_URL", "INTELLIGENCE_BACKEND_TOKEN"],
  mcp: ["TWIN_MCP_ENABLED", "TWIN_MCP_TOKEN"],
  mqtt: ["MQTT_BROKER_URL", "MQTT_TOPIC", "MQTT_USERNAME", "MQTT_PASSWORD"],
  "object-storage": ["S3_ENDPOINT", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
};
const settingsFor = (id: string) => describeSettings(INTEGRATION_SETTINGS[id] ?? []);

function stateFor(id: string, configured: boolean): { state: IntegrationState; detail?: string; at: string | null } {
  if (!configured) return { state: "not-configured", at: null };
  const c = checks[id];
  if (!c) return { state: "configured-untested", at: null };
  return { state: c.ok ? "connected" : "error", detail: c.detail, at: c.at };
}

export function integrationStatuses(): IntegrationStatus[] {
  const ai = aiConfig();
  const rt = aiRuntime();
  let aiState: IntegrationState = ai.provider === "none" ? "not-configured" : "configured-untested";
  const caps = aiCapabilities(ai);
  let aiDetail =
    ai.provider === "none"
      ? ai.disabled
        ? "Turned off: no AI calls are made. Agents write their summaries from the analysis, the copilot is off and the Twin Builder starts from templates."
        : `Missing: ${ai.missing.join(", ")}. Agents write their summaries from the analysis.`
      : `${ai.model} (agents, copilot, builder, vision) · ${ai.reasoningModel} (decision briefings) · SAM 3.1 (segmentation) · Muse Image · Muse Voice Transcribe.${caps.video ? "" : " Video is reviewed as still frames."}`;
  if (ai.provider !== "none") {
    const c = checks["meta-ai"];
    const lastOk = rt.lastSuccessAt ? Date.parse(rt.lastSuccessAt) : 0;
    const lastErrAt = rt.lastError ? Date.parse(rt.lastError.slice(0, 24)) : 0;
    if (rt.lastSuccessAt && lastOk >= lastErrAt) {
      aiState = "connected";
      aiDetail += ` Last successful call ${rt.lastSuccessAt}${rt.lastLatencyMs ? ` (${rt.lastLatencyMs} ms)` : ""}.`;
    } else if (rt.lastError) {
      aiState = "error";
      aiDetail += ` Last error: ${rt.lastError}`;
    } else if (c) {
      aiState = c.ok ? "connected" : "error";
      aiDetail += ` ${c.detail}`;
    }
  }
  const telemetrySource = mqtt.ingestionEnabled() ? "MQTT" : "Built-in plant model";
  const os = stateFor("object-storage", objectStorage.configured());
  const mq = stateFor("mqtt", mqtt.configured());
  const vs = stateFor("vision-service", visionService.configured());
  const ib = stateFor("intelligence-backend", intelligenceBackend.configured());
  const persistence = persistenceInfo();
  const store = settingsStorage();

  return [
    {
      id: "telemetry",
      name: "Telemetry source",
      service: telemetrySource,
      purpose: "Machine readings that drive the twin.",
      state: "active-simulated",
      detail: mqtt.ingestionEnabled()
        ? `MQTT messages on ${mqtt.topic()} provide the readings for matching machines; the plant model still drives production. ${mqtt.status().received} reading(s) received since start.`
        : "The built-in plant model generates live readings (2 min of plant time every 4 s).",
      settings: settingsFor("telemetry"),
      fallback: "Always available.",
      lastCheckedAt: null,
      testable: false,
    },
    {
      id: "meta-ai",
      name: "AI model provider",
      service: `${PROVIDER_NAME} · Muse`,
      purpose: "Agent briefings (Muse Wonder), the copilot, the Twin Builder and footage review (Muse Spark), floor-plan and defect segmentation (SAM 3.1), image generation (Muse Image) and speech-to-twin (Muse Voice).",
      state: aiState,
      detail: aiDetail,
      settings: settingsFor("meta-ai"),
      fallback: "Summaries written from the analysis.",
      lastCheckedAt: checks["meta-ai"]?.at ?? rt.lastSuccessAt,
      testable: ai.provider !== "none",
    },
    {
      id: "vision-service",
      name: "Vision service (FastAPI + OpenCV)",
      service: "FastAPI · OpenCV (container)",
      purpose: "Machine-vision checks: golden-board comparison, barcode/QR reading, image quality and video stoppages.",
      state: vs.state,
      detail: vs.detail ?? (visionService.configured() ? `${visionService.url()} — run a connectivity test or an inspection to verify.` : "Machine-vision checks are off. Station-log reviews (and Muse AI review, if configured) still work."),
      settings: settingsFor("vision-service"),
      fallback: "Station-log review.",
      lastCheckedAt: vs.at,
      testable: visionService.configured(),
    },
    {
      id: "intelligence-backend",
      name: "Intelligence backend (Python · FastAPI)",
      service: "FastAPI · SQLite · Meta Model API",
      purpose: "Predictive maintenance copilot, AOI inspection (Muse Spark + SAM 3.1), supply chain intelligence, demand planning and S&OP briefs, operations copilots. Shares the SQLite database.",
      state: ib.state,
      detail: ib.detail ?? (intelligenceBackend.configured() ? `${intelligenceBackend.url()} — run a connectivity test or open Intelligence Backend.` : "Not configured. Set its URL to use the Intelligence Backend pages."),
      settings: settingsFor("intelligence-backend"),
      fallback: "The web app's own twin, agents and copilot keep working.",
      lastCheckedAt: ib.at,
      testable: intelligenceBackend.configured(),
    },
    mcpStatus(),
    {
      id: "object-storage",
      name: "Document storage (S3-compatible)",
      service: "S3 API · MinIO / SeaweedFS / Ceph / AWS S3",
      purpose: "Maintenance manuals, inspection reports and images per asset (objects under assets/<assetId>/).",
      state: os.state,
      detail: os.detail ?? (objectStorage.configured() ? `Bucket ${objectStorage.bucket()} at ${objectStorage.endpoint()}.` : "Bundled local demo documents are served."),
      settings: settingsFor("object-storage"),
      fallback: "Built-in documents.",
      lastCheckedAt: os.at,
      testable: objectStorage.configured(),
    },
    {
      id: "mqtt",
      name: "MQTT broker",
      service: "MQTT · Eclipse Mosquitto / EMQX",
      purpose: "Shop-floor telemetry: the server subscribes to the topic; set Telemetry source to MQTT to drive the twin with it.",
      state: mq.state,
      detail: mq.detail ?? (mqtt.configured() ? `${mqtt.url()} · topic ${mqtt.topic()}${mqtt.ingestionEnabled() ? ` · ${mqtt.status().connected ? "subscribed" : "connecting"}` : ""}.` : "Not configured."),
      settings: settingsFor("mqtt"),
      fallback: "Built-in telemetry.",
      lastCheckedAt: mq.at,
      testable: mqtt.configured(),
    },
    {
      id: "persistence",
      name: "State persistence",
      service: "Server storage",
      purpose: "Keeps factory state across refreshes and restarts.",
      state: persistence.lastWriteError || !store.ok ? "error" : "active-simulated",
      detail: [
        `Factory twins, settings, preferences, copilot conversations and AI calls are stored in SQLite (${persistence.path}): ${persistence.totalFacilities} facilit${persistence.totalFacilities === 1 ? "y" : "ies"}, ${persistence.rows.assets ?? 0} assets, ${persistence.rows.telemetry_readings ?? 0} telemetry readings, ${persistence.rows.audit_entries ?? 0} audit entries for the active plant.`,
        persistence.lastWriteError ? `It could not be saved: ${persistence.lastWriteError}.` : "",
        "Integration settings are saved in SQLite (app_settings, with change history).",
        store.detail ?? "",
      ]
        .filter(Boolean)
        .join(" "),
      settings: [],
      fallback: "In-memory only if the file cannot be written.",
      lastCheckedAt: null,
      testable: false,
    },
    {
      id: "runtime",
      name: "Runtime",
      service: process.env.TWIN_DEPLOYMENT === "public" ? "Container (public deployment)" : "Node.js server",
      purpose: "Hosting for the web app and API (Docker Compose with the intelligence backend and vision service, or any Node.js host).",
      state: "active",
      detail: `${isServerless() ? "Ephemeral filesystem: mount a volume for the data directory." : "Persistent data directory."} See README → Deploy with Docker Compose.`,
      settings: [],
      fallback: "Local Node.js server.",
      lastCheckedAt: null,
      testable: false,
    },
  ];
}

function mcpStatus(): IntegrationStatus {
  const on = setting("TWIN_MCP_ENABLED") !== "false";
  const token = !!setting("TWIN_MCP_TOKEN");
  return {
    id: "mcp",
    name: "MCP server (agent tools)",
    service: "Model Context Protocol · /api/mcp",
    purpose: "Lets external agents (Python agents, Claude Code, IDEs) use the twin's tools; plans they propose still need a person's approval.",
    state: on ? "active" : "not-configured",
    detail: on
      ? `Streamable HTTP endpoint at /api/mcp with ${token ? "a bearer token required" : "no token — anyone with the URL can read the twin and propose plans for approval"}.`
      : "Turned off. External agents get 503 from /api/mcp.",
    settings: settingsFor("mcp"),
    fallback: "The in-app copilot uses the same tools directly.",
    lastCheckedAt: null,
    testable: false,
  };
}

/**
 * Apply settings changed in the UI: validate, save, forget connection checks that no longer
 * describe the current configuration, and write the change to the audit trail (never the values
 * of secrets).
 */
export async function applySettings(changes: Record<string, string | null>, actor: string) {
  const changed = await updateSettings(changes, actor);
  if (!changed.length) return changed;
  const affected = new Set<string>();
  for (const key of changed) {
    for (const [id, keys] of Object.entries(INTEGRATION_SETTINGS)) if (keys.includes(key)) affected.add(id);
  }
  for (const id of affected) delete checks[id];
  if (affected.has("meta-ai")) resetAiRuntime();
  const describe = (k: SettingKey) => {
    const def: { label: string; secret?: boolean } = SETTINGS[k];
    if (def.secret) return `${def.label} ${setting(k) ? "updated" : "cleared"}`;
    const v = setting(k);
    return `${def.label} = ${v ? v : "(off)"}`;
  };
  mutate((s) =>
    appendAudit(s, new Date().toISOString(), {
      category: "system",
      actor,
      title: `Integration settings changed: ${[...affected].join(", ") || "platform"}`,
      detail: changed.map(describe).join(" · ").slice(0, 600),
      severity: "info",
      refs: {},
    }),
  );
  return changed;
}

export async function testIntegration(id: string): Promise<Check> {
  const at = new Date().toISOString();
  const run = async (): Promise<{ ok: boolean; detail: string }> => {
    switch (id) {
      case "meta-ai":
        return testAi();
      case "object-storage":
        if (!objectStorage.configured()) return { ok: false, detail: "Not configured (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)." };
        return { ok: true, detail: await objectStorage.test() };
      case "mqtt":
        if (!mqtt.configured()) return { ok: false, detail: "Not configured (MQTT_BROKER_URL)." };
        return { ok: true, detail: await mqtt.test() };
      case "vision-service":
        if (!visionService.configured()) return { ok: false, detail: "Not configured (VISION_SERVICE_URL)." };
        return testVisionService();
      case "intelligence-backend":
        return testIntelligenceBackend();
      default:
        return { ok: false, detail: `Integration ${id} has no connectivity test.` };
    }
  };
  let result: { ok: boolean; detail: string };
  try {
    result = await run();
  } catch (e) {
    result = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  const check = { ...result, at };
  // Only record checks for configured integrations so unconfigured ones never appear "connected" or "error".
  const configured =
    id === "meta-ai" ? aiConfig().provider !== "none" : id === "object-storage" ? objectStorage.configured() : id === "mqtt" ? mqtt.configured() : id === "vision-service" ? visionService.configured() : id === "intelligence-backend" ? intelligenceBackend.configured() : false;
  if (configured) checks[id] = check;
  return check;
}

/** Record the outcome of a real call (not a test) so the status reflects actual use. */
export function recordCheck(id: string, ok: boolean, detail: string) {
  checks[id] = { ok, detail, at: new Date().toISOString() };
}
