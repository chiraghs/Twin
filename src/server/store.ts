import "server-only";
import { buildDemoFactory } from "@/domain/seed";
import type { FactoryState } from "@/domain/types";
import { sqliteStore, type FacilitySummary } from "./db/sqlite";
import { displayPath, dataDir } from "./runtime";
import path from "node:path";

/**
 * Server-authoritative factory state backed by SQLite (node:sqlite).
 *
 * Supports multi-facility storage:
 * - Each plant has its own row in the facilities table.
 * - Active facility is tracked in the active_session table.
 * - Resetting demo only resets the demo plant, keeping user twins safe.
 */

type Cache = { state: FactoryState | null; activeId: string | null; writeError: string | null };
const g = globalThis as unknown as { __twin?: Cache };
const cache: Cache = (g.__twin ??= { state: null, activeId: null, writeError: null });

export function getState(facilityId?: string): FactoryState {
  const targetId = facilityId || sqliteStore.getActiveFacilityId();
  if (cache.state && cache.activeId === targetId) {
    return cache.state;
  }
  const loaded = sqliteStore.getFacility(targetId);
  if (loaded) {
    cache.state = loaded;
    cache.activeId = targetId;
    return loaded;
  }
  // Fallback to fresh demo
  const fresh = sqliteStore.resetDemo();
  cache.state = fresh;
  cache.activeId = fresh.profile.id;
  return fresh;
}

/** Run a synchronous mutation against the active live state and persist it to SQLite. */
export function mutate<T>(fn: (state: FactoryState) => T, facilityId?: string): T {
  const state = getState(facilityId);
  const result = fn(state);
  try {
    sqliteStore.saveFacility(state, state.profile.isDemo, state.profile.id);
    cache.writeError = null;
  } catch (e) {
    cache.writeError = e instanceof Error ? e.message : String(e);
  }
  return result;
}

/** Replace the state of a facility or save a new one. */
export function replaceState(next: FactoryState, isDemo = false, customId?: string): FactoryState {
  try {
    const id = sqliteStore.saveFacility(next, isDemo, customId);
    sqliteStore.setActiveFacilityId(id);
    cache.state = next;
    cache.activeId = id;
    cache.writeError = null;
  } catch (e) {
    cache.writeError = e instanceof Error ? e.message : String(e);
  }
  return next;
}

export function listFacilities(): FacilitySummary[] {
  return sqliteStore.listFacilities();
}

export function switchFacility(id: string): FactoryState {
  sqliteStore.setActiveFacilityId(id);
  cache.state = null;
  cache.activeId = null;
  return getState(id);
}

export function resetDemo(): FactoryState {
  const fresh = sqliteStore.resetDemo();
  cache.state = fresh;
  cache.activeId = fresh.profile.id;
  return fresh;
}

export function deleteFacility(id: string): boolean {
  const ok = sqliteStore.deleteFacility(id);
  if (ok && cache.activeId === id) {
    cache.state = null;
    cache.activeId = null;
  }
  return ok;
}

export function persistenceInfo() {
  const dbFile = path.join(dataDir(), "twin.db");
  return {
    kind: "sqlite-database" as const,
    path: displayPath(dbFile),
    activeFacility: sqliteStore.getActiveFacilityId(),
    totalFacilities: sqliteStore.listFacilities().length,
    lastWriteError: cache.writeError,
    note: "Multi-facility state is persisted to local SQLite (node:sqlite).",
  };
}
