import { DomainError } from "@/domain/errors";
import { updateAsset } from "@/domain/commands";
import { json, nowISO, parseBody, route } from "@/server/http";
import { AssetPatchSchema } from "@/server/schemas";
import { getState, mutate } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const asset = getState().assets.find((a) => a.id === id);
  if (!asset) throw new DomainError(`Asset ${id} not found`, 404);
  return json(asset);
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const patch = await parseBody(req, AssetPatchSchema);
  const asset = mutate((s) => updateAsset(s, id, patch, nowISO()));
  return json({ asset, state: getState() });
});
