import { addAsset } from "@/domain/commands";
import { json, nowISO, parseBody, route } from "@/server/http";
import { NewAssetSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

export const GET = route(() => json(getState().assets));

export const POST = route(async (req: Request) => {
  const input = await parseBody(req, NewAssetSchema);
  const asset = mutate((s) => addAsset(s, input, nowISO()));
  return json({ asset, state: getState() }, 201);
});
