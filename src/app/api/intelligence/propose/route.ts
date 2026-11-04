import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { proposePreventiveMaintenance, proposePurchaseOrder } from "@/domain/intelligence-actions";
import { json, nowISO, parseBody, route } from "@/server/http";
import { cachedInsights, featureEnabled, syncNow } from "@/server/intelligence";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

const Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("maintenance"), assetId: z.string().min(1).max(60), by: z.string().trim().max(60).optional() }),
  z.object({ kind: z.literal("purchase-order"), itemId: z.string().min(1).max(60), by: z.string().trim().max(60).optional() }),
]);

/**
 * Turn an intelligence result into a PENDING recommendation (preventive maintenance, or a
 * purchase order). A person approves it in Approvals; nothing changes until then.
 */
export const POST = route(async (req: Request) => {
  const body = await parseBody(req, Schema);
  const feature = body.kind === "maintenance" ? "maintenance" : "supply";
  if (!featureEnabled(feature)) throw new DomainError("This feature is off. An admin can turn it on in Admin → Features.", 409);
  const state = getState();
  let insights = cachedInsights(state.profile.id);
  if (!insights?.[feature]) {
    await syncNow(state);
    insights = cachedInsights(state.profile.id);
  }
  const actor = body.by || "Operator";
  const at = nowISO();
  if (body.kind === "maintenance") {
    const insight = insights?.maintenance?.assets.find((a) => a.assetId === body.assetId);
    if (!insight) throw new DomainError(`No predictive-maintenance result for ${body.assetId} yet.`, 404);
    const rec = mutate((s) => proposePreventiveMaintenance(s, insight, at, actor));
    return json({ recommendation: rec, state: getState() }, 201);
  }
  const insight = insights?.supply?.items.find((i) => i.itemId === body.itemId);
  if (!insight) throw new DomainError(`No supply result for ${body.itemId} yet.`, 404);
  const rec = mutate((s) => proposePurchaseOrder(s, insight, at, actor));
  return json({ recommendation: rec, state: getState() }, 201);
});
