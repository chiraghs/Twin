import { z } from "zod";
import { compileSpec } from "@/domain/builder/compile";
import { validateSpec } from "@/domain/builder/validate";
import { defaultAnchor, newFactorySeed } from "@/domain/seed";
import { json, nowISO, parseBody, route } from "@/server/http";
import { replaceState } from "@/server/store";

export const dynamic = "force-dynamic";

/** Build the live twin from a reviewed spec. Deterministic; saves as a new custom facility in SQLite. */
export const POST = route(async (req: Request) => {
  const { spec, by } = await parseBody(req, z.object({ spec: z.unknown(), by: z.string().trim().min(1).max(60).default("Operator") }));
  const v = validateSpec(spec);
  if (!v.ok || !v.spec) return json({ error: "The spec has errors to fix before building", issues: v.issues.filter((i) => i.level === "error").map((i) => i.message) }, 400);
  const state = compileSpec(v.spec, defaultAnchor(), newFactorySeed(), nowISO(), by);
  
  // Assign a unique facility ID so it persists alongside the demo
  const slug = (state.profile.name || "plant").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20);
  const facilityId = `fac-${slug}-${Date.now().toString(36)}`;
  state.profile.id = facilityId;
  state.profile.isDemo = false;

  return json(replaceState(state, false, facilityId), 201);
});
