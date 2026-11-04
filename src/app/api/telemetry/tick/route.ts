import { liveTick } from "@/domain/commands";
import { applyExternalReadings } from "@/domain/telemetry";
import { json, nowISO, route } from "@/server/http";
import { mqtt } from "@/server/integrations/adapters";
import { syncIfDue } from "@/server/intelligence";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

export const POST = route(async () => {
  let external: Awaited<ReturnType<typeof mqtt.drain>> = [];
  if (mqtt.ingestionEnabled()) {
    try {
      external = await mqtt.drain(500);
    } catch (e) {
      console.warn("[telemetry] MQTT ingestion failed:", e instanceof Error ? e.message : e);
    }
  }
  const advanced = mutate((s) => {
    const moved = liveTick(s, Date.now(), nowISO());
    if (external.length) applyExternalReadings(s, external);
    return moved;
  });
  const state = getState();
  syncIfDue(state); // background: intelligence features, when any is on
  return json({ advanced, state });
});
