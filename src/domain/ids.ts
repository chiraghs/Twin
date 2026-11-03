import type { FactoryState } from "./types";

/** Deterministic, human-readable IDs derived from per-prefix counters stored in state. */
export function nextId(state: FactoryState, prefix: string, start = 1000) {
  const current = state.counters[prefix] ?? start;
  const next = current + 1;
  state.counters[prefix] = next;
  return `${prefix}-${next}`;
}
