import "server-only";
import crypto from "node:crypto";
import { setting } from "@/server/settings";
import type { TelemetryReading } from "@/domain/types";

/**
 * Open-standard data integrations: MQTT telemetry ingestion and S3-compatible object storage.
 * No cloud-vendor SDKs; both work against self-hosted open-source servers.
 */
/* ─────────────────────────────── MQTT telemetry ─────────────────────────────── */
export interface ExternalReading extends Partial<TelemetryReading> {
  assetId: string;
}

type MqttState = { client: import("mqtt").MqttClient | null; url: string; topic: string; buffer: ExternalReading[]; received: number; lastError: string | null; connected: boolean };
const gm = globalThis as unknown as { __twinMqtt?: MqttState };
const ms: MqttState = (gm.__twinMqtt ??= { client: null, url: "", topic: "", buffer: [], received: 0, lastError: null, connected: false });

/**
 * MQTT (open standard; e.g. Eclipse Mosquitto or EMQX). With TELEMETRY_SOURCE=mqtt the server
 * subscribes to MQTT_TOPIC and buffers JSON readings {assetId, vibration?, temperature?, powerKw?};
 * each live tick drains the buffer into the twin.
 */
export const mqtt = {
  configured: () => !!setting("MQTT_BROKER_URL"),
  url: () => setting("MQTT_BROKER_URL") || "",
  topic: () => setting("MQTT_TOPIC") || "plant/+/telemetry",
  ingestionEnabled: () => mqtt.configured() && (setting("TELEMETRY_SOURCE") || "simulated") === "mqtt",
  status: () => ({ connected: ms.connected, received: ms.received, buffered: ms.buffer.length, lastError: ms.lastError }),
  async ensureSubscribed() {
    const url = mqtt.url();
    const topic = mqtt.topic();
    if (ms.client && ms.url === url && ms.topic === topic) return;
    ms.client?.end(true);
    const { connect } = await import("mqtt");
    const client = connect(url, {
      username: setting("MQTT_USERNAME") || undefined,
      password: setting("MQTT_PASSWORD") || undefined,
      clientId: `twin-${Math.random().toString(16).slice(2, 10)}`,
      reconnectPeriod: 5000,
      connectTimeout: 8000,
    });
    Object.assign(ms, { client, url, topic, connected: false });
    client.on("connect", () => {
      ms.connected = true;
      ms.lastError = null;
      client.subscribe(topic, { qos: 0 });
    });
    client.on("close", () => (ms.connected = false));
    client.on("error", (e) => (ms.lastError = e.message));
    client.on("message", (_t, payload) => {
      try {
        const r = JSON.parse(payload.toString("utf8"));
        if (r && typeof r.assetId === "string") {
          ms.buffer.push(r);
          ms.received++;
          if (ms.buffer.length > 5000) ms.buffer.splice(0, ms.buffer.length - 5000);
        }
      } catch {
        /* skip malformed message */
      }
    });
  },
  /** Readings received since the last call. */
  async drain(max = 500): Promise<ExternalReading[]> {
    await mqtt.ensureSubscribed();
    return ms.buffer.splice(0, max);
  },
  /** Connect, subscribe and report (Integrations → Test connection). */
  async test() {
    const { connectAsync } = await import("mqtt");
    const client = await connectAsync(mqtt.url(), { username: setting("MQTT_USERNAME") || undefined, password: setting("MQTT_PASSWORD") || undefined, connectTimeout: 6000, reconnectPeriod: 0 });
    try {
      await client.subscribeAsync(mqtt.topic());
      return `Connected to ${new URL(mqtt.url()).host} and subscribed to ${mqtt.topic()}.${mqtt.ingestionEnabled() ? " Readings drive the twin (TELEMETRY_SOURCE=mqtt)." : " Set Telemetry source to MQTT to use the readings."}`;
    } finally {
      await client.endAsync();
    }
  },
};

/* ─────────────────────── S3-compatible object storage ─────────────────────── */
/**
 * Per-asset documents in any S3-compatible store (MinIO, SeaweedFS, Ceph RGW, AWS S3…), under
 * assets/<assetId>/. Requests are signed with AWS Signature V4 (the S3 API's open standard).
 */
export const objectStorage = {
  configured: () => !!(setting("S3_ENDPOINT") && setting("S3_BUCKET") && setting("S3_ACCESS_KEY_ID") && setting("S3_SECRET_ACCESS_KEY")),
  bucket: () => setting("S3_BUCKET") || "",
  endpoint: () => (setting("S3_ENDPOINT") || "").replace(/\/+$/, ""),
  async test() {
    await s3Request("GET", "", { "list-type": "2", "max-keys": "1" });
    return `Bucket ${objectStorage.bucket()} reachable at ${new URL(objectStorage.endpoint()).host}.`;
  },
  async list(prefix: string) {
    const xml = await s3Request("GET", "", { "list-type": "2", prefix, "max-keys": "50" });
    const items: { name: string; size: number; contentType: string; updated: string }[] = [];
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const tag = (t: string) => m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? "";
      items.push({ name: tag("Key"), size: Number(tag("Size")), contentType: "", updated: tag("LastModified") });
    }
    return items;
  },
};

async function s3Request(method: string, key: string, query: Record<string, string>) {
  const endpoint = new URL(objectStorage.endpoint());
  const region = setting("S3_REGION") || "us-east-1";
  const bucket = objectStorage.bucket();
  const path = `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`.replace(/\/$/, key ? "" : "");
  const qs = Object.keys(query).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = crypto.createHash("sha256").update("").digest("hex");
  const headers: Record<string, string> = { host: endpoint.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const signed = Object.keys(headers).sort();
  const canonical = [method, path, qs, signed.map((h) => `${h}:${headers[h]}\n`).join(""), signed.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, crypto.createHash("sha256").update(canonical).digest("hex")].join("\n");
  const hmac = (k: crypto.BinaryLike, d: string) => crypto.createHmac("sha256", k).update(d).digest();
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${setting("S3_SECRET_ACCESS_KEY") ?? ""}`, day), region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(toSign).digest("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${setting("S3_ACCESS_KEY_ID")}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`;
  const res = await fetch(`${endpoint.origin}${path}${qs ? `?${qs}` : ""}`, { method, headers: { ...headers, authorization: auth }, signal: AbortSignal.timeout(8000), cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.match(/<Message>(.*?)<\/Message>/)?.[1] ?? res.statusText}`);
  return text;
}
