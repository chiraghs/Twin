import { liveTick } from "@/domain/commands";
import { applyExternalReadings } from "@/domain/telemetry";
import { json, nowISO, route } from "@/server/http";
import { pubSub } from "@/server/integrations/adapters";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

export const POST = route(async () => {
  let external: Awaited<ReturnType<typeof pubSub.pull>> = [];
  if (pubSub.ingestionEnabled()) {
    try {
      external = await pubSub.pull(100);
    } catch (e) {
      console.warn("[telemetry] Pub/Sub pull failed:", e instanceof Error ? e.message : e);
    }
  }
  const advanced = mutate((s) => {
    const moved = liveTick(s, Date.now(), nowISO());
    if (external.length) applyExternalReadings(s, external);
    return moved;
  });
  const state = getState();
  return json({ advanced, state });
});
