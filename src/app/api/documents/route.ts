import { json, route } from "@/server/http";
import { listDocuments } from "@/server/documents";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(async (req: Request) => {
  const assetId = new URL(req.url).searchParams.get("assetId");
  const asset = assetId ? getState().assets.find((a) => a.id === assetId) : undefined;
  return json(await listDocuments(asset));
});
