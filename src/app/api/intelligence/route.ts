import { z } from "zod";
import { FEATURE_IDS, FEATURE_META } from "@/domain/intelligence";
import { appendAudit } from "@/domain/audit";
import { adminActor, isAdmin, requireAdmin } from "@/server/admin";
import { json, nowISO, parseBody, route } from "@/server/http";
import { intelligenceBackend } from "@/server/integrations/backend";
import { cachedInsights, enabledFeatures, featureEnabled, syncNow, syncStatus } from "@/server/intelligence";
import { ensureFreshSettings, updateSettings, type SettingKey } from "@/server/settings";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

/** The four intelligence features: on/off, last sync and headline counts for this plant. */
export const GET = route(async (req: Request) => {
  await ensureFreshSettings();
  const state = getState();
  const insights = cachedInsights(state.profile.id) ?? {};
  return json({
    facilityId: state.profile.id,
    facilityName: state.profile.name,
    backend: { configured: intelligenceBackend.configured(), url: intelligenceBackend.url() || null },
    admin: isAdmin(req),
    sync: syncStatus(state.profile.id),
    features: FEATURE_IDS.map((id) => ({
      id,
      ...FEATURE_META[id],
      enabled: featureEnabled(id),
      counts: (insights[id] as { counts?: Record<string, number> } | undefined)?.counts ?? null,
      error: syncStatus(state.profile.id)?.featureErrors?.[id] ?? null,
    })),
  });
});

const ToggleSchema = z.object({
  feature: z.enum(FEATURE_IDS),
  enabled: z.boolean(),
  by: z.string().trim().max(60).optional(),
});

/** Turn a feature on or off (admin). Turning one on syncs the plant right away. */
export const PUT = route(async (req: Request) => {
  requireAdmin(req);
  const { feature, enabled, by } = await parseBody(req, ToggleSchema);
  const actor = adminActor(by);
  await updateSettings({ [FEATURE_META[feature].settingKey as SettingKey]: enabled ? "true" : "false" }, actor);
  mutate((s) =>
    appendAudit(s, nowISO(), {
      category: "system",
      actor,
      title: `${FEATURE_META[feature].name} turned ${enabled ? "on" : "off"}`,
      detail: enabled ? "The plant is synced to the intelligence backend; results reach the agents and the Analytics pages." : "No more syncing for this feature; its agent evidence and Analytics page stop.",
      severity: "info",
      refs: {},
    }),
  );
  const status = enabled ? await syncNow(getState()) : null;
  return json({ feature, enabled, enabledFeatures: enabledFeatures(), sync: status });
});
