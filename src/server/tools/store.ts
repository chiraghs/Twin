import "server-only";
import type { ToolStore } from "@/domain/tools/twin-tools";
import { nowISO } from "@/server/http";
import { getState, mutate } from "@/server/store";

/** The live factory as seen by agent tools. */
export const serverToolStore: ToolStore = { get: getState, mutate, now: nowISO };
