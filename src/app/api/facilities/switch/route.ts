import { z } from "zod";
import { json, parseBody, route } from "@/server/http";
import { switchFacility } from "@/server/store";

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const { id } = await parseBody(req, z.object({ id: z.string().min(1) }));
  const state = switchFacility(id);
  return json(state);
});
