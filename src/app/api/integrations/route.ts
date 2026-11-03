import { json, route } from "@/server/http";
import { integrationStatuses, projectSetting } from "@/server/integrations/status";
import { aiCapabilities, aiConfig, modelLabel } from "@/server/ai/config";
import { ensureFreshSettings, settingsStorage } from "@/server/settings";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await ensureFreshSettings();
  const ai = aiConfig();
  return json({
    project: projectSetting(),
    storage: settingsStorage(),
    ai: { provider: ai.provider, reasoningModel: ai.provider === "none" ? null : modelLabel(ai, ai.reasoningModel), model: ai.provider === "none" ? null : modelLabel(ai), disabled: !!ai.disabled, capabilities: aiCapabilities(ai) },
    integrations: integrationStatuses(),
  });
});
