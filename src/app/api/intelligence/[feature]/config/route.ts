import { z } from "zod";
import { FEATURE_IDS, FEATURE_META, type FeatureId } from "@/domain/intelligence";
import { DomainError } from "@/domain/errors";
import { requireAdmin } from "@/server/admin";
import { json, parseBody, route } from "@/server/http";
import { backendFetch, syncNow } from "@/server/intelligence";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ feature: string }> };

function featureOf(id: string): FeatureId {
  if (!(FEATURE_IDS as readonly string[]).includes(id)) throw new DomainError(`Unknown feature ${id}`, 404);
  return id as FeatureId;
}

/** The feature's backend configuration and its change history. */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const feature = featureOf((await params).feature);
  const path = FEATURE_META[feature].configPath;
  const component = { maintenance: "predictive_maintenance", supply: "supply_chain_intelligence", demand: "demand_forecasting", vision: "visual_quality_inspection" }[feature];
  const [config, history] = await Promise.all([
    backendFetch<Record<string, unknown>>(path),
    backendFetch<{ changed_at: string; changed_by: string | null }[]>(`data/config-history/${component}?limit=8`).catch(() => []),
  ]);
  return json({ feature, config, history });
});

const PutSchema = z.object({ config: z.record(z.string().max(80), z.unknown()) });

/** Change the feature's configuration (admin); the backend validates it and records the change. */
export const PUT = route(async (req: Request, { params }: Ctx) => {
  requireAdmin(req);
  const feature = featureOf((await params).feature);
  const { config } = await parseBody(req, PutSchema);
  const saved = await backendFetch<Record<string, unknown>>(FEATURE_META[feature].configPath, { method: "PUT", json: config });
  void syncNow(getState()); // recompute with the new settings
  return json({ feature, config: saved });
});
