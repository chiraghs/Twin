import { detectAnomalies } from "@/domain/anomaly";
import { json, route } from "@/server/http";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => json(detectAnomalies(getState())));
