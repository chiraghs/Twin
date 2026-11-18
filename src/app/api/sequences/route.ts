import { z } from "zod";
import { DomainError } from "@/domain/errors";
import { StepsSchema, validateSequence, type SeqStep } from "@/domain/sequences";
import { json, nowISO, parseBody, route } from "@/server/http";
import { listSequences, saveSequence } from "@/server/db/sequences";
import { getState } from "@/server/store";

export const dynamic = "force-dynamic";

/** Sequences of the active twin. */
export const GET = route(async () => {
  const id = getState().profile.id;
  return json({ facilityId: id, sequences: listSequences(id) });
});

const SaveSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(80),
  steps: StepsSchema,
  by: z.string().trim().min(1).max(60).default("Operator"),
});

/** Create or update a sequence; every machine and signal it uses must exist. */
export const POST = route(async (req: Request) => {
  const { by, ...input } = await parseBody(req, SaveSchema);
  const s = getState();
  const problems = validateSequence(s, input.steps as SeqStep[]);
  if (problems.length) throw new DomainError(problems.join("; "), 400);
  return json({ sequence: saveSequence(s.profile.id, { ...input, steps: input.steps as SeqStep[] }, by, nowISO()) }, input.id ? 200 : 201);
});
