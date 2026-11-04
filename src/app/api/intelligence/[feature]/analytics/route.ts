import { FEATURE_IDS, FEATURE_META, type FeatureId } from "@/domain/intelligence";
import { DomainError } from "@/domain/errors";
import { json, route } from "@/server/http";
import { backendFetch, cachedInsights, featureEnabled, syncNow } from "@/server/intelligence";
import { ensureFreshSettings } from "@/server/settings";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ feature: string }> };

/** Data for a feature's Analytics page (only while the feature is on). */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  await ensureFreshSettings();
  const id = (await params).feature;
  if (!(FEATURE_IDS as readonly string[]).includes(id)) throw new DomainError(`Unknown feature ${id}`, 404);
  const feature = id as FeatureId;
  if (!featureEnabled(feature)) {
    return json({ feature, enabled: false, message: `${FEATURE_META[feature].name} is off. An admin can turn it on in Admin → Features.` }, 409);
  }
  const state = getState();
  if (feature !== "vision" && !cachedInsights(state.profile.id)?.[feature]) await syncNow(state);
  const data = await backendFetch<Record<string, unknown>>(`twin/${encodeURIComponent(state.profile.id)}/analytics/${feature}`);
  return json({ ...data, enabled: true, facilityName: state.profile.name, simHour: state.clock.hour });
});
