import { json } from "@/server/http";
import { getState, persistenceInfo } from "@/server/store";

export const dynamic = "force-dynamic";

export function GET() {
  const state = getState();
  return json({
    status: "ok",
    service: "twin-ai",
    time: new Date().toISOString(),
    factory: state.profile.name,
    simHour: state.clock.hour,
    persistence: persistenceInfo(),
  });
}
