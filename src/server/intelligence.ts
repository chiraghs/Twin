import "server-only";
import { buildTwinSnapshot, FEATURE_IDS, FEATURE_META, type BackendInsights, type FeatureId } from "@/domain/intelligence";
import type { FactoryState } from "@/domain/types";
import { intelligenceBackend } from "@/server/integrations/backend";
import { setting, type SettingKey } from "@/server/settings";

/**
 * Bridge between this twin and the intelligence backend's four features.
 *
 * While at least one feature is on, the live tick sends a plant snapshot at most every
 * SYNC_INTERVAL_MS (never two at once); the backend computes the insights and stores them
 * in SQLite (tw_* tables). The latest result per facility is cached here for the agents.
 */

const SYNC_INTERVAL_MS = 15_000;
const TIMEOUT_MS = 20_000;

export interface SyncStatus {
  facilityId: string;
  ok: boolean;
  at: string;
  simHour: number;
  features: FeatureId[];
  durationMs: number;
  error: string | null;
  featureErrors: Record<string, string>;
}

interface Cache {
  inflight: Promise<SyncStatus | null> | null;
  lastAttemptAt: number;
  status: Map<string, SyncStatus>;
  insights: Map<string, BackendInsights>;
}
const g = globalThis as unknown as { __twinIntel?: Cache };
const cache: Cache = (g.__twinIntel ??= { inflight: null, lastAttemptAt: 0, status: new Map(), insights: new Map() });

export const featureEnabled = (id: FeatureId) => setting(FEATURE_META[id].settingKey as SettingKey) === "true";
export const enabledFeatures = (): FeatureId[] => FEATURE_IDS.filter(featureEnabled);

function authHeaders(): Record<string, string> {
  const t = setting("INTELLIGENCE_BACKEND_TOKEN");
  return t ? { authorization: `Bearer ${t}` } : {};
}

/** Call the backend (JSON in/out); throws with the backend's message on failure. */
export async function backendFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const base = intelligenceBackend.url();
  if (!base) throw new Error("The intelligence backend is not configured (Integrations → Intelligence backend).");
  const { json, ...rest } = init;
  const res = await fetch(`${base}/api/v1/${path.replace(/^\/+/, "")}`, {
    ...rest,
    headers: { ...authHeaders(), ...(json !== undefined ? { "content-type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    signal: rest.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { detail: text.slice(0, 300) };
  }
  if (!res.ok) {
    const d = (data ?? {}) as { detail?: unknown; error?: string };
    throw new Error(`Backend ${res.status}: ${d.error ?? (typeof d.detail === "string" ? d.detail : JSON.stringify(d.detail ?? res.statusText))}`.slice(0, 300));
  }
  return data as T;
}

/** Send the plant snapshot now and cache the insights (shared by concurrent callers). */
export function syncNow(state: FactoryState): Promise<SyncStatus | null> {
  const features = enabledFeatures();
  if (!features.length) return Promise.resolve(null);
  if (cache.inflight) return cache.inflight;
  cache.lastAttemptAt = Date.now();
  const facilityId = state.profile.id;
  const snapshot = buildTwinSnapshot(state, features);
  const started = Date.now();
  cache.inflight = (async () => {
    let status: SyncStatus;
    try {
      const out = await backendFetch<{ syncedAt: string; insights: BackendInsights; errors: Record<string, string> }>("twin/sync", { method: "POST", json: snapshot });
      // Keep a feature's last good result when this sync failed for it; drop features that are off.
      const previous = cache.insights.get(facilityId) ?? {};
      const merged: BackendInsights = {};
      for (const f of features) {
        const next = out.insights[f] ?? previous[f];
        if (next) Object.assign(merged, { [f]: next });
      }
      cache.insights.set(facilityId, merged);
      status = { facilityId, ok: Object.keys(out.errors).length === 0, at: out.syncedAt, simHour: snapshot.simHour, features, durationMs: Date.now() - started, error: null, featureErrors: out.errors };
    } catch (e) {
      status = { facilityId, ok: false, at: new Date().toISOString(), simHour: snapshot.simHour, features, durationMs: Date.now() - started, error: e instanceof Error ? e.message : String(e), featureErrors: {} };
    }
    cache.status.set(facilityId, status);
    return status;
  })().finally(() => {
    cache.inflight = null;
  });
  return cache.inflight;
}

/** Called on every live tick: syncs in the background when a feature is on and the interval has passed. */
export function syncIfDue(state: FactoryState) {
  if (cache.inflight || Date.now() - cache.lastAttemptAt < SYNC_INTERVAL_MS) return;
  if (!enabledFeatures().length) return;
  void syncNow(state);
}

/** Cached insights of the enabled features for a facility (disabled features are dropped). */
export function cachedInsights(facilityId: string): BackendInsights | undefined {
  const all = cache.insights.get(facilityId);
  if (!all) return undefined;
  const on = enabledFeatures();
  const out: BackendInsights = {};
  for (const f of on) if (all[f]) Object.assign(out, { [f]: all[f] });
  return Object.keys(out).length ? out : undefined;
}

/** Insights for the agents: the cache, or one sync (bounded) when nothing is cached yet. */
export async function insightsForAnalysis(state: FactoryState): Promise<BackendInsights | undefined> {
  if (!enabledFeatures().length) return undefined;
  const cached = cachedInsights(state.profile.id);
  if (cached) return cached;
  await Promise.race([syncNow(state), new Promise((r) => setTimeout(r, 8000))]);
  return cachedInsights(state.profile.id);
}

export const syncStatus = (facilityId: string) => cache.status.get(facilityId) ?? null;

export function __resetIntelligenceForTests() {
  cache.inflight = null;
  cache.lastAttemptAt = 0;
  cache.status.clear();
  cache.insights.clear();
}
