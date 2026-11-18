import { z } from "zod";
import { maintenanceGuide, signMaintenanceStep } from "@/domain/guided-maintenance";
import { json, nowISO, parseBody, route } from "@/server/http";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ workOrderId: string }> };

/** The guided procedure for a work order, with the steps already signed. */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { workOrderId } = await params;
  return json(maintenanceGuide(getState(), workOrderId));
});

const SignSchema = z.object({ stepId: z.string().min(1).max(12), by: z.string().trim().min(1).max(60).default("Technician") });

/** Sign the next step (in order; the test run needs its live check to pass). Audited. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { workOrderId } = await params;
  const { stepId, by } = await parseBody(req, SignSchema);
  const guide = mutate((s) => signMaintenanceStep(s, workOrderId, stepId, by, nowISO()));
  return json({ guide, state: getState() });
});
