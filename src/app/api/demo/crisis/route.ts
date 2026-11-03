import { applyScriptedCrisis } from "@/domain/crisis";
import { buildDemoFactory } from "@/domain/seed";
import { json, nowISO, route } from "@/server/http";
import { replaceState } from "@/server/store";

/** Reset the demo factory and apply the scripted crisis (see applyScriptedCrisis). */
export const POST = route(() => {
  const state = buildDemoFactory();
  applyScriptedCrisis(state, nowISO());
  state.clock.lastTickAt = Date.now();
  return json(replaceState(state));
});
