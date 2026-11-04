"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeatureId } from "@/domain/intelligence";
import type { FactoryState, Recommendation, VisionReview } from "@/domain/types";
import { api, apiForm } from "./api";
import { useFactory, useUi } from "./store";

export interface FeatureRow {
  id: FeatureId;
  name: string;
  settingKey: string;
  configPath: string;
  analyticsHref: string;
  agent: string;
  enabled: boolean;
  counts: Record<string, number> | null;
  error: string | null;
}

export interface FeaturesPayload {
  facilityId: string;
  facilityName: string;
  backend: { configured: boolean; url: string | null };
  admin: boolean;
  sync: { ok: boolean; at: string; simHour: number; durationMs: number; error: string | null; featureErrors: Record<string, string> } | null;
  features: FeatureRow[];
}

/** GET a JSON resource with loading / error state; `pollMs` refreshes it in the background. */
export function useJson<T>(path: string | null, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (!alive.current) return;
      setData(d);
      setError(null);
      setStatus(200);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus((e as { status?: number }).status ?? null);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    alive.current = true;
    void reload();
    if (!pollMs) return () => void (alive.current = false);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, pollMs);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [reload, pollMs]);
  return { data, error, status, loading, reload, setData };
}

export const toggleFeature = (feature: FeatureId, enabled: boolean) =>
  api<{ enabledFeatures: FeatureId[]; sync: FeaturesPayload["sync"] }>("/api/intelligence", { method: "PUT", body: { feature, enabled, by: useUi.getState().operator } });

export const saveFeatureConfig = (feature: FeatureId, config: Record<string, unknown>) =>
  api<{ config: Record<string, unknown> }>(`/api/intelligence/${feature}/config`, { method: "PUT", body: { config } });

/** Turn a result into a pending recommendation; the live state is refreshed from the response. */
export async function proposeFromInsight(body: { kind: "maintenance"; assetId: string } | { kind: "purchase-order"; itemId: string }) {
  const res = await api<{ recommendation: Recommendation; state: FactoryState }>("/api/intelligence/propose", { body: { ...body, by: useUi.getState().operator } });
  useFactory.getState().apply(res.state);
  return res.recommendation;
}

export async function inspectWithAoi(file: File, cameraId: string, productId?: string) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("cameraId", cameraId);
  if (productId) form.append("productId", productId);
  const res = await apiForm<{ review: VisionReview; state: FactoryState }>("/api/intelligence/vision/inspect", form);
  useFactory.getState().apply(res.state);
  return res.review;
}
