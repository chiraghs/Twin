import "server-only";
import { z } from "zod";

/**
 * Convert a tool's zod shape into a JSON Schema for Meta Model API function tools. Arguments
 * are validated again by the tool layer, so this only needs to describe them well.
 */
function toSchema(t: z.ZodTypeAny): Record<string, unknown> {
  const description = t.description;
  const base = (s: Record<string, unknown>) => (description ? { ...s, description } : s);
  if (t instanceof z.ZodOptional || t instanceof z.ZodNullable) {
    const inner = toSchema(t.unwrap());
    const type = inner.type;
    return { ...inner, ...(typeof type === "string" ? { type: [type, "null"] } : {}), ...(description ? { description } : {}) };
  }
  if (t instanceof z.ZodDefault) return toSchema(t._def.innerType);
  if (t instanceof z.ZodString) return base({ type: "string" });
  if (t instanceof z.ZodBoolean) return base({ type: "boolean" });
  if (t instanceof z.ZodEnum) return base({ type: "string", enum: [...t.options] });
  if (t instanceof z.ZodNumber) {
    const checks = t._def.checks as { kind: string; value?: number }[];
    const min = checks.find((c) => c.kind === "min")?.value;
    const max = checks.find((c) => c.kind === "max")?.value;
    return base({ type: checks.some((c) => c.kind === "int") ? "integer" : "number", ...(min !== undefined ? { minimum: min } : {}), ...(max !== undefined ? { maximum: max } : {}) });
  }
  if (t instanceof z.ZodArray) return base({ type: "array", items: toSchema(t.element) });
  if (t instanceof z.ZodObject) return base(objectSchema(t.shape));
  return base({ type: "string" });
}

export function objectSchema(shape: z.ZodRawShape): Record<string, unknown> {
  const entries = Object.entries(shape) as [string, z.ZodTypeAny][];
  return {
    type: "object",
    properties: Object.fromEntries(entries.map(([k, v]) => [k, toSchema(v)])),
    required: entries.filter(([, v]) => !v.isOptional()).map(([k]) => k),
  };
}
