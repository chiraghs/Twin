import { json, route } from "@/server/http";
import { listFacilities, getState } from "@/server/store";
import { sqliteStore } from "@/server/db/sqlite";

export const dynamic = "force-dynamic";

export const GET = route(() => {
  const activeId = sqliteStore.getActiveFacilityId();
  const facilities = listFacilities();
  const current = getState();
  return json({
    activeId,
    activeName: current.profile.name,
    facilities,
  });
});
