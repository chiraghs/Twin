/**
 * TwinSpec: the reviewable, declarative description of a factory that the Twin Builder agent
 * drafts and a person approves. A deterministic compiler (compile.ts) turns it into a live twin.
 *
 * Every element records where it came from (`prov`) so nothing the model proposes is mistaken
 * for a fact: the blueprint, the user's requirements, a cited reference, a template, a default
 * assumption, or a manual edit.
 */
import { z } from "zod";
import { ASSET_KINDS } from "../archetypes";
import type { AssetKind } from "../types";

export const PROVENANCE = ["blueprint", "requirement", "reference", "template", "default", "user"] as const;
export type ProvenanceSource = (typeof PROVENANCE)[number];

export const ProvSchema = z.object({
  source: z.enum(PROVENANCE),
  note: z.string().max(400).nullish(),
  /** Reference ids (see TwinSpec.references) that support this element. */
  refs: z.array(z.string().max(12)).max(6).nullish(),
});
export type Prov = z.infer<typeof ProvSchema>;

const id = z.string().trim().min(1).max(40);
const name = z.string().trim().min(1).max(80);
const num = (max: number) => z.number().finite().positive().max(max).nullable();
const BoxSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) });
/** Position on the floor plan (layout units, about 2 m each) and rotation in degrees (multiples of 90). */
export const PosSchema = z.object({ x: z.number().finite().min(-200).max(200), y: z.number().finite().min(-200).max(200), rot: z.number().finite().default(0) });
export type Pos = z.infer<typeof PosSchema>;

export const SpecMachineSchema = z.object({
  id,
  name,
  archetype: z.enum(ASSET_KINDS as [AssetKind, ...AssetKind[]]),
  /** Sustainable rate in product units per hour (null: derived from the line rate). */
  ratePerHour: num(200000),
  notes: z.string().max(300).nullish(),
  /** Where the element sits on the uploaded blueprint (normalised 0–1). */
  box: BoxSchema.nullish(),
  /** Where it stands on the floor (Playground). Without it, the standard layout places it. */
  pos: PosSchema.nullish(),
  prov: ProvSchema,
});

export const SpecLineSchema = z.object({
  id,
  name,
  role: z.enum(["process", "packing"]),
  machines: z.array(SpecMachineSchema).min(1).max(8),
  productIds: z.array(id).max(4),
  box: BoxSchema.nullish(),
  prov: ProvSchema,
});

export const SpecProductSchema = z.object({
  id,
  name,
  /** Unit the line counts (units, bottles, kg, parts…). */
  unit: z.string().trim().min(1).max(20).default("units"),
  ratePerHour: num(200000),
  unitPrice: num(1e6),
  unitMaterialCost: num(1e6),
  materials: z.array(z.object({ materialId: id, qtyPerUnit: z.number().finite().positive().max(10000) })).max(8),
  prov: ProvSchema,
});

export const SpecMaterialSchema = z.object({
  id,
  name,
  unit: z.string().trim().min(1).max(20).default("pcs"),
  onHand: z.number().finite().min(0).max(1e9).nullable(),
  unitCost: num(1e6),
  leadTimeHours: num(24 * 120),
  supplier: z.string().trim().max(80).nullable(),
  prov: ProvSchema,
});

export const INTEGRATION_KINDS = ["simulated", "mqtt", "opcua", "modbus", "pubsub", "camera-rtsp", "historian", "erp"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const SpecIntegrationSchema = z.object({
  id,
  /** A line id, a machine id, or "site". */
  target: id,
  kind: z.enum(INTEGRATION_KINDS),
  /** Topic, node id, register map, URL… (never credentials). */
  address: z.string().trim().max(200).nullable(),
  notes: z.string().max(300).nullish(),
  prov: ProvSchema,
});

/** Mobile robots: what kind of vehicle, and which material move it does. */
export const ROBOT_TYPES = ["amr", "agv", "forklift-agv", "tugger"] as const;
export type RobotType = (typeof ROBOT_TYPES)[number];
export const ROBOT_MISSIONS = ["kitting", "line-transfer", "finished-goods"] as const;
export type RobotMission = (typeof ROBOT_MISSIONS)[number];

/**
 * A fleet of identical mobile robots doing one material move: kitting (stores → a process line),
 * line-transfer (a process line → the packing line) or finished-goods (the packing line → the
 * dock). Only added when the owner's requirements or the blueprint call for them.
 */
export const SpecRobotFleetSchema = z.object({
  id,
  name,
  robotType: z.enum(ROBOT_TYPES),
  mission: z.enum(ROBOT_MISSIONS),
  /** The line it serves: a process line for kitting and line-transfer, the packing line for finished goods. */
  lineId: id.nullable(),
  count: z.number().int().min(1).max(12),
  /** Product units moved per trip (null: a stated default per mission). */
  unitsPerTrip: num(100000),
  /** Travel speed in m/s (null: 1.0 m/s, typical for indoor robots in mixed traffic). */
  speedMps: z.number().finite().min(0.2).max(3).nullable(),
  /** When a trip starts: per output (every `unitsPerTrip` units) or on a schedule (every `everyMinutes`). */
  trigger: z.object({ kind: z.enum(["output", "schedule"]), everyMinutes: z.number().finite().min(1).max(24 * 60).nullable().default(null) }).default({ kind: "output", everyMinutes: null }),
  /** Waypoints the route passes through between its start and end (floor-plan units). */
  route: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).max(12).default([]),
  prov: ProvSchema,
});

/**
 * Rules the twin runs every simulated step. Each one acts through the plant model (purchase
 * orders, re-allocation, speed changes) or creates a proposal a person must approve; none of them
 * touches real equipment.
 */
export const RULE_KINDS = ["inventory", "maintenance", "connector"] as const;
export const SpecRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    id,
    name,
    kind: z.literal("inventory"),
    enabled: z.boolean().default(true),
    materialId: id,
    /** Reorder when stock plus open orders falls below this (null: the material's reorder point). */
    below: z.number().finite().min(0).nullable().default(null),
    /** Quantity per purchase order (null: enough for twice the lead time at current use). */
    orderQty: z.number().finite().positive().nullable().default(null),
    prov: ProvSchema,
  }),
  z.object({
    id,
    name,
    kind: z.literal("maintenance"),
    enabled: z.boolean().default(true),
    /** A machine id, or null for every machine. */
    machineId: id.nullable(),
    metric: z.enum(["health", "vibration"]),
    /** Health below (0–100) or vibration above (mm/s). */
    threshold: z.number().finite().min(0).max(100),
    prov: ProvSchema,
  }),
  z.object({
    id,
    name,
    kind: z.literal("connector"),
    enabled: z.boolean().default(true),
    /** The process line whose output flow the rule watches (line → packing). */
    lineId: id,
    when: z.enum(["upstream-stops", "downstream-stops", "buffer-full"]),
    action: z.enum(["divert", "slow", "pause"]),
    /** divert: the line that takes over the product. */
    toLineId: id.nullable().default(null),
    /** slow: speed of the upstream line, % of nominal. */
    speedPct: z.number().finite().min(5).max(100).nullable().default(null),
    /** buffer-full: units waiting before packing that count as full. */
    bufferUnits: z.number().finite().positive().nullable().default(null),
    prov: ProvSchema,
  }),
]);

export const ReferenceSchema = z.object({ id: z.string().max(12), title: z.string().max(200), url: z.string().url().max(2000), note: z.string().max(400).nullish() });

export const TwinSpecSchema = z.object({
  version: z.literal(1),
  site: z.object({
    name,
    industry: z.string().trim().min(2).max(80),
    location: z.string().trim().max(80).default(""),
    productionType: z.string().trim().max(120).default(""),
    prov: ProvSchema,
  }),
  lines: z.array(SpecLineSchema).min(1).max(5),
  products: z.array(SpecProductSchema).max(6),
  materials: z.array(SpecMaterialSchema).max(12),
  integrations: z.array(SpecIntegrationSchema).max(40),
  mobileRobots: z.array(SpecRobotFleetSchema).max(10).default([]),
  rules: z.array(SpecRuleSchema).max(30).default([]),
  references: z.array(ReferenceSchema).max(20),
  assumptions: z.array(z.string().max(400)).max(30),
  questions: z.array(z.object({ id, text: z.string().max(400), answer: z.string().max(400).nullable() })).max(12),
  /** Blueprint the draft was read from (file name only; the file itself is not stored). */
  blueprint: z.object({ fileName: z.string().max(160), kind: z.string().max(40), summary: z.string().max(800) }).nullish(),
  options: z.object({ rehearsalIncident: z.boolean().default(false), linesInterchangeable: z.boolean().default(true) }).default({}),
});

export type TwinSpec = z.infer<typeof TwinSpecSchema>;
export type TwinSpecInput = z.input<typeof TwinSpecSchema>;
export type SpecLine = z.infer<typeof SpecLineSchema>;
export type SpecMachine = z.infer<typeof SpecMachineSchema>;
export type SpecProduct = z.infer<typeof SpecProductSchema>;
export type SpecMaterial = z.infer<typeof SpecMaterialSchema>;
export type SpecIntegration = z.infer<typeof SpecIntegrationSchema>;
export type SpecRobotFleet = z.infer<typeof SpecRobotFleetSchema>;
export type SpecRule = z.infer<typeof SpecRuleSchema>;

/** Lower-case slug for ids ("Filling Line 1" → "filling-line-1"). */
export const slug = (s: string, max = 32) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "x";

/** Unique id from a name within a set of taken ids. */
export function uniqueId(base: string, taken: Set<string>) {
  const b = slug(base);
  let id = b;
  for (let i = 2; taken.has(id); i++) id = `${b}-${i}`;
  taken.add(id);
  return id;
}
