"use client";

import { useCallback, useEffect, useState } from "react";
import type { Tone } from "@/components/ui/primitives";
import { api } from "./api";

/**
 * Integration status from the server: one typed client and one hook, so every screen reads the
 * same honest status the same way (and an error response never reaches the UI as data).
 */

export type IntegrationState = "active" | "active-simulated" | "not-configured" | "configured-untested" | "connected" | "error";

export interface SettingView {
  key: string;
  label: string;
  help: string;
  secret: boolean;
  /** Only relevant for these AI providers. */
  providers: string[] | null;
  options: { value: string; label: string }[] | null;
  defaultValue: string | null;
  placeholder: string | null;
  source: "ui" | "environment" | "unset";
  isSet: boolean;
  value: string | null;
}

export interface Integration {
  id: string;
  name: string;
  service: string;
  purpose: string;
  state: IntegrationState;
  detail: string;
  settings: SettingView[];
  fallback: string;
  lastCheckedAt: string | null;
  testable: boolean;
}

export interface SettingsStorage {
  kind: "cloud-storage" | "sqlite";
  where: string;
  ok: boolean;
  detail: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AiInfo {
  provider: string;
  model: string | null;
  disabled: boolean;
  reasoningModel?: string | null;
  capabilities: { available: boolean; video: boolean; images: boolean; pdf: boolean; webSearch: boolean; segmentation?: boolean; imageGeneration?: boolean; transcription?: boolean };
}

export interface IntegrationsPayload {
  project: SettingView;
  storage: SettingsStorage;
  integrations: Integration[];
  ai?: AiInfo;
}

/** Display of each state: the full label (Integrations page) and a short one (status menus). */
export const INTEGRATION_STATE: Record<IntegrationState, { label: string; short: string; tone: Tone }> = {
  connected: { label: "Connected (verified)", short: "Connected", tone: "healthy" },
  active: { label: "Active", short: "Active", tone: "healthy" },
  "active-simulated": { label: "Active", short: "Active", tone: "accent" },
  "configured-untested": { label: "Configured · not yet verified", short: "Configured", tone: "warning" },
  "not-configured": { label: "Not configured", short: "Not configured", tone: "neutral" },
  error: { label: "Connection failed", short: "Error", tone: "critical" },
};

export const fetchIntegrations = () => api<IntegrationsPayload>("/api/integrations");

export const testIntegration = (id: string) => api<{ integrations: Integration[]; result: { ok: boolean; detail: string } }>("/api/integrations/test", { body: { id } });

export const saveIntegrationSettings = (values: Record<string, string | null>) =>
  api<Partial<IntegrationsPayload> & { changed?: string[] }>("/api/integrations/settings", { method: "PUT", body: { values } });

/** Load integration status. `enabled: false` defers the request (for example until a menu opens). */
export function useIntegrations({ enabled = true, refresh = 0 }: { enabled?: boolean; refresh?: number } = {}) {
  const [data, setData] = useState<IntegrationsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await fetchIntegrations());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, refresh, reload]);
  return { data, error, reload, setData };
}

/** The state of one integration, or null while loading. */
export function integrationState(data: IntegrationsPayload | null, id: string): IntegrationState | null {
  if (!data) return null;
  return data.integrations.find((i) => i.id === id)?.state ?? "not-configured";
}
