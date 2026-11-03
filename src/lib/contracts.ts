/**
 * Wire contracts shared by the server and the browser. Both sides import these types from here,
 * so the client never depends on server modules.
 */
import type { IsoModel } from "@/domain/layout";
import type { AgentId } from "@/domain/types";

/** One event in the copilot's NDJSON stream (`POST /api/copilot`). */
export type CopilotEvent =
  | { type: "start"; sessionId: string }
  | { type: "agent"; agent: string; text: string }
  | { type: "tool_call"; agent: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; agent: string; tool: string; ok: boolean; preview: string }
  | { type: "confirm"; callId: string; tool: string; args: Record<string, unknown>; hint: string }
  | { type: "answer"; text: string; grounding: { figures: number; unverified: string[]; derived: string[] } }
  | { type: "error"; message: string }
  | { type: "done" };

/** Precomputed landing-page story: the scripted crisis run through the real engine. */
export interface StoryData {
  before: IsoModel;
  crisis: IsoModel;
  after: IsoModel;
  counts: { machines: number; sensors: number; lines: number; materials: number; orders: number; readings: number };
  focus: { id: string; name: string; baseline: number; vibration: number; step: number; slope: number; hoursToTrip: number; p24: number; failureMode: string };
  vibration: number[];
  agents: { id: AgentId; name: string; summary: string }[];
  scenarios: { id: string; name: string; lateUnits: number; cost: number; failureHour: number | null; downtime: number; score: number }[];
  recommendedId: string;
  recommendationTitle: string;
  highlight: { assetIds: string[]; lineIds: string[]; targetAssetId: string; rerouteLineId: string | null };
  impact: { downtimeAvoided: number; lateAvoided: number; costAvoided: number; scrapAvoided: number };
  audit: string[];
  afterHealth: number;
}
