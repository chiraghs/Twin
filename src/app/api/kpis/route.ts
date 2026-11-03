import { computeKpis, hourlySeries } from "@/domain/kpis";
import { json, route } from "@/server/http";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => {
  const s = getState();
  return json({ kpis: computeKpis(s), hourly: hourlySeries(s, 24) });
});
