/**
 * Mobile robots named in free-text requirements, read deterministically (keyword matching).
 * Used when the AI agent is unavailable (template mode), and as a safety net when an AI draft
 * leaves out robots the owner asked for. Every fleet records the sentence it came from.
 */
import { uniqueId, type SpecRobotFleet, type TwinSpec } from "./spec";

const ROBOT_WORDS = String.raw`(?:automated\s+forklifts?|forklift\s+agvs?|agfs?|tugger(?:\s+trains?)?s?|automated\s+guided\s+vehicles?|agvs?|autonomous\s+mobile\s+robots?|mobile\s+robots?|amrs?)`;
const ROBOT_RE = new RegExp(String.raw`\b${ROBOT_WORDS}\b`, "i");
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

export const mentionsRobots = (text: string) => ROBOT_RE.test(text);

function typeOf(clause: string): SpecRobotFleet["robotType"] {
  if (/forklift|\bagfs?\b/i.test(clause)) return "forklift-agv";
  if (/tugger/i.test(clause)) return "tugger";
  if (/\bagvs?\b|automated\s+guided/i.test(clause)) return "agv";
  return "amr";
}

function missionOf(clause: string): SpecRobotFleet["mission"] {
  if (/\b(docks?|ship(?:ping|ments?)?|dispatch|outbound|finished goods|trucks?|trailers?|loading bays?)\b/i.test(clause)) return "finished-goods";
  if (/\b(packing|packaging|pack-out|end of line|end-of-line|between lines|transfer)\b/i.test(clause)) return "line-transfer";
  return "kitting";
}

function countOf(clause: string): number | null {
  const m = new RegExp(String.raw`\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:[a-z-]+\s+){0,2}?${ROBOT_WORDS}\b`, "i").exec(clause);
  if (!m) return null;
  const v = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
  return v && v > 0 ? v : null;
}

function lineOf(clause: string, spec: TwinSpec): string | null {
  const process = spec.lines.filter((l) => l.role === "process");
  const byName = spec.lines.find((l) => clause.toLowerCase().includes(l.name.toLowerCase()));
  if (byName) return byName.id;
  const n = /\bline\s+(\d|[a-e])\b/i.exec(clause);
  if (n) {
    const i = /\d/.test(n[1]) ? Number(n[1]) - 1 : n[1].toLowerCase().charCodeAt(0) - 97;
    return process[i]?.id ?? null;
  }
  return null;
}

/** Robot fleets described in the requirements. Each clause that names robots becomes one fleet. */
export function robotsFromRequirements(text: string, spec: TwinSpec): SpecRobotFleet[] {
  const taken = new Set<string>([...spec.lines.map((l) => l.id), ...spec.mobileRobots.map((f) => f.id)]);
  // One clause per robot mention: split sentences at "and" / commas, then attach parts without a
  // robot to the neighbouring robot clause ("3 AMRs bring preforms and caps to Line 1" stays whole).
  const clauses: string[] = [];
  for (const sentence of text.split(/[.;!?\n]+/)) {
    let pending = "";
    let last = -1;
    for (const part of sentence.split(/\s*,\s*|\s+(?:and|while|plus|as well as)\s+/i)) {
      const t = part.trim();
      if (!t) continue;
      if (ROBOT_RE.test(t)) {
        clauses.push(`${pending}${pending ? " " : ""}${t}`);
        last = clauses.length - 1;
        pending = "";
      } else if (last >= 0) clauses[last] += ` ${t}`;
      else pending += `${pending ? " " : ""}${t}`;
    }
  }
  const fleets: SpecRobotFleet[] = [];
  for (const clause of clauses.slice(0, 10)) {
    const robotType = typeOf(clause);
    const mission = missionOf(clause);
    const stated = countOf(clause);
    const count = Math.min(12, stated ?? 1);
    const lineId = mission === "finished-goods" ? null : lineOf(clause, spec);
    const label = { amr: "AMRs", agv: "AGVs", "forklift-agv": "automated forklifts", tugger: "tuggers" }[robotType];
    const move = { kitting: "Kitting", "line-transfer": "Transfer", "finished-goods": "Finished-goods" }[mission];
    const name = `${move} ${label}${lineId ? ` ${spec.lines.find((l) => l.id === lineId)?.name ?? ""}` : ""}`.trim();
    fleets.push({
      id: uniqueId(name, taken),
      name,
      robotType,
      mission,
      lineId,
      count,
      unitsPerTrip: null,
      speedMps: null,
      trigger: { kind: "output", everyMinutes: null },
      route: [],
      prov: {
        source: "requirement",
        note: `Read from your requirements: “${clause.slice(0, 160)}”${stated ? "" : " (no count stated; assumed 1)"}${stated && stated > 12 ? ` (${stated} requested; 12 simulated)` : ""}.`,
        refs: [],
      },
    });
  }
  return fleets;
}
