import "server-only";
import { setting } from "@/server/settings";
import net from "node:net";
import type { Recommendation, ScenarioRun, TelemetryReading } from "@/domain/types";
import { gcpFetch, gcpProject } from "./gcp";

/* ───────────────────────────── BigQuery ─────────────────────────────
 * Tables (see infra/bigquery/schema.sql): telemetry, production_events,
 * machine_health_history, scenario_outcomes, decisions.
 */
export const bigQuery = {
  configured: () => !!(gcpProject() && setting("BIGQUERY_DATASET")),
  dataset: () => setting("BIGQUERY_DATASET") || "",
  async test() {
    const ds = await gcpFetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${gcpProject()}/datasets/${bigQuery.dataset()}`);
    const tables = await gcpFetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${gcpProject()}/datasets/${bigQuery.dataset()}/tables?maxResults=50`);
    const names = (tables.tables ?? []).map((t: { tableReference: { tableId: string } }) => t.tableReference.tableId);
    return `Dataset ${ds.id} reachable (${ds.location}); tables: ${names.join(", ") || "none — run infra/bigquery/schema.sql"}.`;
  },
  async insert(table: string, rows: Record<string, unknown>[]) {
    if (!rows.length) return;
    const res = await gcpFetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${gcpProject()}/datasets/${bigQuery.dataset()}/tables/${table}/insertAll`,
      { method: "POST", body: JSON.stringify({ rows: rows.map((json) => ({ json })) }) },
    );
    if (res.insertErrors?.length) throw new Error(`BigQuery insert errors: ${JSON.stringify(res.insertErrors[0]).slice(0, 200)}`);
  },
  scenarioRows(run: ScenarioRun, factoryId: string) {
    return run.results.map((r) => ({
      run_id: run.id,
      factory_id: factoryId,
      created_at: run.at,
      scenario_id: r.definition.id,
      scenario_name: r.definition.name,
      target_asset_id: run.targetAssetId,
      score: r.metrics.score,
      total_output: r.metrics.totalOutput,
      late_units: r.metrics.lateUnits,
      operating_cost: r.metrics.operatingCost,
      energy_kwh: r.metrics.energyKwh,
      scrap_units: r.metrics.scrapUnits,
      failure_hour: r.metrics.failureHour,
      params_json: JSON.stringify(r.definition.params),
    }));
  },
  decisionRow(rec: Recommendation, factoryId: string) {
    return {
      recommendation_id: rec.id,
      factory_id: factoryId,
      decided_at: rec.decision?.at ?? new Date().toISOString(),
      status: rec.status,
      decided_by: rec.decision?.by ?? null,
      note: rec.decision?.note ?? null,
      scenario_id: rec.scenarioId,
      title: rec.title,
    };
  },
};

/* ───────────────────────────── Pub/Sub ───────────────────────────── */
export interface ExternalReading extends Partial<TelemetryReading> {
  assetId: string;
}

export const pubSub = {
  configured: () => !!(gcpProject() && setting("PUBSUB_TELEMETRY_SUBSCRIPTION")),
  ingestionEnabled: () => pubSub.configured() && (setting("TELEMETRY_SOURCE") || "simulated") === "pubsub",
  subscription: () => setting("PUBSUB_TELEMETRY_SUBSCRIPTION") || "",
  async test() {
    const sub = await gcpFetch(`https://pubsub.googleapis.com/v1/projects/${gcpProject()}/subscriptions/${pubSub.subscription()}`);
    return `Subscription ${sub.name} reachable (topic ${sub.topic}).`;
  },
  /** Pull and acknowledge telemetry messages: JSON {assetId, vibration?, temperature?, powerKw?}. */
  async pull(max = 50): Promise<ExternalReading[]> {
    const base = `https://pubsub.googleapis.com/v1/projects/${gcpProject()}/subscriptions/${pubSub.subscription()}`;
    const res = await gcpFetch(`${base}:pull`, { method: "POST", body: JSON.stringify({ maxMessages: max }), timeoutMs: 4000 });
    const msgs: { ackId: string; message: { data?: string } }[] = res.receivedMessages ?? [];
    if (!msgs.length) return [];
    await gcpFetch(`${base}:acknowledge`, { method: "POST", body: JSON.stringify({ ackIds: msgs.map((m) => m.ackId) }) });
    const out: ExternalReading[] = [];
    for (const m of msgs) {
      try {
        const payload = JSON.parse(Buffer.from(m.message.data ?? "", "base64").toString("utf8"));
        if (payload && typeof payload.assetId === "string") out.push(payload);
      } catch {
        /* skip malformed message */
      }
    }
    return out;
  },
};

/* ─────────────────────────── Cloud Storage ─────────────────────────── */
export const cloudStorage = {
  configured: () => !!(gcpProject() && setting("GCS_BUCKET")),
  bucket: () => setting("GCS_BUCKET") || "",
  async test() {
    const b = await gcpFetch(`https://storage.googleapis.com/storage/v1/b/${cloudStorage.bucket()}`);
    return `Bucket gs://${b.name} reachable (${b.location}).`;
  },
  async list(prefix: string) {
    const res = await gcpFetch(
      `https://storage.googleapis.com/storage/v1/b/${cloudStorage.bucket()}/o?prefix=${encodeURIComponent(prefix)}&maxResults=50`,
    );
    return (res.items ?? []).map((o: { name: string; size: string; contentType: string; updated: string }) => ({
      name: o.name,
      size: Number(o.size),
      contentType: o.contentType,
      updated: o.updated,
    }));
  },
};

/* ─────────────────────────────── MQTT ─────────────────────────────── */
export const mqtt = {
  configured: () => !!setting("MQTT_BROKER_URL"),
  url: () => setting("MQTT_BROKER_URL") || "",
  /** TCP reachability probe only — this MVP does not subscribe to MQTT topics. */
  async test() {
    const u = new URL(mqtt.url());
    const port = Number(u.port || (u.protocol === "mqtts:" ? 8883 : 1883));
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect({ host: u.hostname, port, timeout: 4000 });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error("TCP connect timed out"));
      });
      socket.once("error", reject);
    });
    return `Broker ${u.hostname}:${port} reachable over TCP. MQTT subscription is not implemented in this MVP.`;
  },
};
