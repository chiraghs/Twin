import { AUDIT_LIMIT } from "@/domain/audit";
import { json, route } from "@/server/http";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route((req: Request) => {
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const limit = Math.min(AUDIT_LIMIT, Number(url.searchParams.get("limit") ?? 100) || 100);
  const entries = getState().audit.filter((e) => !category || e.category === category).slice(0, limit);
  return json({ entries });
});
