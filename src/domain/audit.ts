import { nextId } from "./ids";
import { round } from "./math";
import type { AuditEntry, FactoryState } from "./types";

export const AUDIT_LIMIT = 400;

export function appendAudit(state: FactoryState, nowISO: string, entry: Omit<AuditEntry, "id" | "hour" | "at">) {
  const full: AuditEntry = { id: nextId(state, "EVT", 10000), hour: round(state.clock.hour, 4), at: nowISO, ...entry };
  state.audit.unshift(full);
  if (state.audit.length > AUDIT_LIMIT) state.audit.length = AUDIT_LIMIT;
  return full;
}
