import { z } from "zod";
import { adminActor, requireAdmin } from "@/server/admin";
import { json, parseBody, route } from "@/server/http";
import { applySettings, integrationStatuses, projectSetting } from "@/server/integrations/status";
import { SettingsError } from "@/server/settings";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  values: z.record(z.string().max(64), z.string().max(500).nullable()),
  by: z.string().trim().max(60).optional(),
});

/**
 * Change integration settings (admin only). `values` maps a setting to a new value; an empty
 * string turns it off and `null` returns it to the deployment's environment value.
 */
export const PUT = route(async (req: Request) => {
  requireAdmin(req);
  const { values, by } = await parseBody(req, UpdateSchema);
  try {
    const changed = await applySettings(values, adminActor(by));
    return json({ changed, project: projectSetting(), integrations: integrationStatuses() });
  } catch (e) {
    if (e instanceof SettingsError) return json({ error: "Some settings are not valid", issues: e.issues }, 400);
    throw e;
  }
});
