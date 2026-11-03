import { ARCHETYPES, ASSET_KINDS } from "@/domain/archetypes";
import { INTEGRATION_KINDS } from "@/domain/builder/spec";
import { TEMPLATES } from "@/domain/builder/templates";
import { json, route } from "@/server/http";
import { aiCapabilities, aiConfig, modelLabel } from "@/server/ai/config";

export const dynamic = "force-dynamic";

/** What the Twin Builder can use: AI availability, templates, machine archetypes and connection kinds. */
export const GET = route(() => {
  const ai = aiConfig();
  return json({
    ai: { available: ai.provider !== "none", provider: ai.provider, model: ai.provider === "none" ? null : modelLabel(ai), missing: ai.missing, capabilities: aiCapabilities(ai) },
    templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, industry: t.industry, description: t.description, spec: t.spec })),
    archetypes: ASSET_KINDS.map((k) => ({ kind: k, name: ARCHETYPES[k].name, covers: ARCHETYPES[k].covers, rateRange: ARCHETYPES[k].rateRange })),
    integrationKinds: INTEGRATION_KINDS,
  });
});
