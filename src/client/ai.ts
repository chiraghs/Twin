"use client";

import { useIntegrations, type AiInfo } from "./integrations";

export type { AiInfo };

/** The AI platform this server uses and what it can do (from the honest integration status). */
export function useAiInfo(refresh = 0): AiInfo | null {
  return useIntegrations({ refresh }).data?.ai ?? null;
}

/** Short name for buttons and labels. */
export function aiShortName(info: AiInfo | null) {
  return info?.provider === "meta" ? "Muse" : "AI";
}
