import { computeQuality } from "@/domain/quality";
import { json, route } from "@/server/http";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => json(computeQuality(getState())));
