import type { AssetKind } from "./types";

/**
 * Typed material ports. Each machine type accepts some kinds of material at its input port and
 * delivers one at its output port ("same" passes through what came in). A line is valid when the
 * material flowing out of every machine is something the next one accepts.
 */
export type Material = "part" | "assembly" | "packed" | "pallet" | "bulk";

export const MATERIAL_LABEL: Record<Material, string> = {
  part: "parts",
  assembly: "assemblies",
  packed: "packed goods",
  pallet: "pallets",
  bulk: "bulk material",
};

export interface MachinePorts {
  accepts: Material[];
  delivers: Material | "same";
}

/**
 * Deliberately broad where real machines of a type differ (a robot loads, picks or assembles; an
 * oven also dries resin or granulate), strict where the physics is clear (a CNC can't machine
 * bulk material, a labeler needs packs, nothing but a conveyor takes a pallet).
 */
export const PORTS: Record<AssetKind, MachinePorts> = {
  conveyor: { accepts: ["part", "assembly", "packed", "pallet"], delivers: "same" },
  camera: { accepts: ["part", "assembly", "packed"], delivers: "same" },
  oven: { accepts: ["part", "assembly", "bulk"], delivers: "same" },
  press: { accepts: ["part", "assembly", "bulk"], delivers: "part" },
  cnc: { accepts: ["part", "assembly"], delivers: "part" },
  robot: { accepts: ["part", "assembly", "packed"], delivers: "same" },
  welder: { accepts: ["part", "assembly"], delivers: "assembly" },
  workstation: { accepts: ["part", "assembly", "packed"], delivers: "assembly" },
  packager: { accepts: ["part", "assembly", "packed"], delivers: "packed" },
  labeler: { accepts: ["packed"], delivers: "packed" },
  palletizer: { accepts: ["packed", "assembly", "part"], delivers: "pallet" },
  mixer: { accepts: ["bulk"], delivers: "bulk" },
  pump: { accepts: ["bulk", "part", "assembly"], delivers: "same" },
  extruder: { accepts: ["bulk"], delivers: "part" },
  molder: { accepts: ["bulk", "part", "assembly"], delivers: "part" },
  filler: { accepts: ["bulk", "part"], delivers: "packed" },
};

function follow(kinds: AssetKind[], start: Material) {
  const out: (Material | null)[] = [];
  const problems: { index: number; kind: AssetKind; got: Material; accepts: Material[] }[] = [];
  let cur: Material | null = start;
  kinds.forEach((k, index) => {
    const p = PORTS[k];
    if (cur && !p.accepts.includes(cur)) {
      problems.push({ index, kind: k, got: cur, accepts: p.accepts });
      cur = null;
    } else if (cur) cur = p.delivers === "same" ? cur : p.delivers;
    out.push(cur);
  });
  return { out, problems };
}

export interface FlowCheck {
  /** Material leaving each machine, in line order (null after the first incompatible step). */
  out: (Material | null)[];
  problems: { index: number; kind: AssetKind; got: Material; accepts: Material[] }[];
}

/**
 * Follow the material along a line and report every machine that receives something it can't take.
 * The line's source supplies whichever raw material its first machine takes that lets the line flow.
 */
export function checkLine(kinds: AssetKind[]): FlowCheck {
  if (!kinds.length) return { out: [], problems: [] };
  let best: FlowCheck | null = null;
  for (const start of PORTS[kinds[0]].accepts) {
    const r = follow(kinds, start);
    if (!best || r.problems.length < best.problems.length) best = r;
    if (!r.problems.length) break;
  }
  return best!;
}

/**
 * Can `target` come directly after position `fromIndex` in a line of `kinds`? Returns the material
 * that would flow between them, or why not.
 */
export function canFollow(kinds: AssetKind[], fromIndex: number, target: AssetKind): { ok: true; material: Material } | { ok: false; reason: string } {
  const flow = checkLine(kinds.slice(0, fromIndex + 1));
  const material = flow.out[fromIndex];
  if (!material) return { ok: false, reason: "The line before this machine already has a material mismatch." };
  if (!PORTS[target].accepts.includes(material)) {
    return { ok: false, reason: `It delivers ${MATERIAL_LABEL[material]}; this machine takes ${PORTS[target].accepts.map((m) => MATERIAL_LABEL[m]).join(" or ")}.` };
  }
  return { ok: true, material };
}

/** Port summary for the catalogue: "parts, assemblies → packed goods". */
export function portSummary(kind: AssetKind): string {
  const p = PORTS[kind];
  return `${p.accepts.map((m) => MATERIAL_LABEL[m]).join(", ")} → ${p.delivers === "same" ? "same" : MATERIAL_LABEL[p.delivers]}`;
}
