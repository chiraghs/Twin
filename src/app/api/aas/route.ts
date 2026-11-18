import { aasEnvironment } from "@/domain/aas";
import { route } from "@/server/http";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * Asset Administration Shell export (AAS metamodel v3, JSON environment) of the plant's machines.
 * `?asset=ID` (repeatable) limits it; `?download=1` returns it as a file.
 */
export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const ids = url.searchParams.getAll("asset");
  const state = getState();
  const env = aasEnvironment(state, ids.length ? ids : undefined);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (url.searchParams.get("download")) {
    const slug = (state.profile.name || "plant").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    headers["content-disposition"] = `attachment; filename="${slug || "plant"}-aas.json"`;
  }
  return new Response(JSON.stringify(env, null, 2), { headers });
});
