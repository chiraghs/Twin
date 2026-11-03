import { DomainError } from "@/domain/errors";
import { diagnoseAsset } from "@/domain/anomaly";
import { readingsFor } from "@/domain/telemetry";
import { json, route } from "@/server/http";
import { getState } from "@/server/store";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const state = getState();
  const asset = state.assets.find((a) => a.id === id);
  if (!asset) throw new DomainError(`Asset ${id} not found`, 404);
  return json({ assetId: id, readings: readingsFor(state, id), diagnostics: diagnoseAsset(state, asset) });
});
