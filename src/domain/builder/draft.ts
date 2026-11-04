/**
 * Contracts between the Twin Builder agent and the model, and the deterministic conversion of a
 * model draft into a TwinSpec. The model only ever fills these shapes; ids, provenance links,
 * blueprint boxes and citations are resolved here in code.
 */
import { z } from "zod";
import { ARCHETYPES, ASSET_KINDS } from "../archetypes";
import type { AssetKind } from "../types";
import { INTEGRATION_KINDS, ROBOT_MISSIONS, ROBOT_TYPES, uniqueId, type Prov, type SpecLine, type SpecMaterial, type SpecProduct, type SpecRobotFleet, type TwinSpec } from "./spec";

/* ───────────────────────────── blueprint reading ───────────────────────────── */

export const BlueprintReadingSchema = z.object({
  legible: z.boolean(),
  drawingKind: z.string().max(40),
  summary: z.string().max(800),
  siteName: z.string().max(80).nullable(),
  industry: z.string().max(80).nullable(),
  elements: z
    .array(
      z.object({
        id: z.string().max(12),
        label: z.string().max(80),
        role: z.enum(["machine", "conveyor", "storage", "dock", "utility", "office", "vehicle", "other"]),
        archetype: z.string().max(20).nullable(),
        lineHint: z.string().max(60).nullable(),
        box: z.array(z.number()).length(4).nullable(), // [ymin, xmin, ymax, xmax] on a 0–1000 grid
        confidence: z.number().min(0).max(1),
        /** The box was replaced by a SAM 3.1 segmentation footprint. */
        segmented: z.boolean().optional(),
      }),
    )
    .max(80),
  flows: z.array(z.object({ from: z.string().max(12), to: z.string().max(12) })).max(120),
  notes: z.array(z.string().max(300)).max(10),
  /** SAM 3.1 footprints found on the drawing (0–1000 grid), whether or not they matched an element. */
  segmentation: z
    .object({
      model: z.string().max(40),
      concepts: z.array(z.string().max(40)).max(6),
      footprints: z.array(z.object({ concept: z.string().max(40), box: z.array(z.number()).length(4), matched: z.string().max(12).nullable() })).max(120),
    })
    .optional(),
});
export type BlueprintReading = z.infer<typeof BlueprintReadingSchema>;

/** A model box [ymin, xmin, ymax, xmax] (0–1000) as a normalised {x, y, w, h}. */
export function boxFrom(b: number[] | null | undefined) {
  if (!b || b.length !== 4) return null;
  const [y0, x0, y1, x1] = b.map((v) => Math.min(1, Math.max(0, v / 1000)));
  if (x1 <= x0 || y1 <= y0) return null;
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return { x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) };
}

/* ───────────────────────────── research ───────────────────────────── */

export interface ResearchResult {
  /** Bullet notes with [R#] citation markers. */
  notes: string;
  references: { id: string; title: string; url: string }[];
  queries: string[];
}

/* ───────────────────────────── draft ───────────────────────────── */

const SOURCE = z.enum(["blueprint", "requirement", "reference", "template", "default"]);
const nullableNum = z.number().finite().positive().nullable();

export const DraftSchema = z.object({
  site: z.object({ name: z.string().max(80), industry: z.string().max(80), location: z.string().max(80), productionType: z.string().max(120) }),
  lines: z
    .array(
      z.object({
        name: z.string().max(80),
        role: z.enum(["process", "packing"]),
        products: z.array(z.string().max(80)).max(4),
        source: SOURCE,
        note: z.string().max(300).nullable(),
        machines: z
          .array(
            z.object({
              name: z.string().max(80),
              archetype: z.string().max(20),
              ratePerHour: nullableNum,
              source: SOURCE,
              note: z.string().max(300).nullable(),
              refs: z.array(z.string().max(12)).max(6),
              blueprintElement: z.string().max(12).nullable(),
            }),
          )
          .min(1)
          .max(12),
      }),
    )
    .min(1)
    .max(8),
  products: z
    .array(
      z.object({
        name: z.string().max(80),
        unit: z.string().max(20),
        ratePerHour: nullableNum,
        unitPrice: nullableNum,
        unitMaterialCost: nullableNum,
        source: SOURCE,
        note: z.string().max(300).nullable(),
        refs: z.array(z.string().max(12)).max(6),
        materials: z.array(z.object({ material: z.string().max(80), qtyPerUnit: z.number().finite().positive() })).max(8),
      }),
    )
    .max(8),
  materials: z
    .array(
      z.object({
        name: z.string().max(80),
        unit: z.string().max(20),
        unitCost: nullableNum,
        leadTimeHours: nullableNum,
        /** Only when the requirements or the drawing name them (never invented). */
        supplier: z.string().max(80).nullable().optional(),
        onHand: z.number().finite().min(0).nullable().optional(),
        source: SOURCE,
        note: z.string().max(300).nullable(),
      }),
    )
    .max(16),
  integrations: z
    .array(z.object({ target: z.string().max(80), kind: z.string().max(20), address: z.string().max(200).nullable(), note: z.string().max(300).nullable(), source: SOURCE }))
    .max(40),
  /** Only when the requirements or the blueprint call for mobile robots. */
  mobileRobots: z
    .array(
      z.object({
        name: z.string().max(80),
        robotType: z.string().max(20),
        mission: z.string().max(20),
        /** Name of the line it serves (null for finished goods: the packing line). */
        line: z.string().max(80).nullable(),
        count: z.number().int().min(1).max(50),
        unitsPerTrip: nullableNum,
        source: SOURCE,
        note: z.string().max(300).nullable(),
      }),
    )
    .max(10)
    .default([]),
  assumptions: z.array(z.string().max(400)).max(20),
  questions: z.array(z.string().max(400)).max(8),
});
/** Input shape: `mobileRobots` may be omitted (older recordings, drafts without robots). */
export type Draft = z.input<typeof DraftSchema>;

/** Archetype catalog given to the model (the only machine types it may use). */
export const ARCHETYPE_CATALOG = ASSET_KINDS.map((k) => `- ${k}: ${ARCHETYPES[k].name} — ${ARCHETYPES[k].covers}`).join("\n");

const near = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Deterministic conversion of a model draft into a TwinSpec: ids, name → id links, blueprint boxes,
 * citation filtering and provenance. Archetypes outside the catalog fall back to "workstation"
 * and are flagged as assumptions, never silently accepted.
 */
export function specFromDraft(
  draft: Draft,
  ctx: { reading: BlueprintReading | null; references: ResearchResult["references"]; blueprintFile: string | null; userSite: { name?: string; industry?: string; location?: string } },
): TwinSpec {
  const refIds = new Set(ctx.references.map((r) => r.id));
  const elements = new Map((ctx.reading?.elements ?? []).map((e) => [e.id, e]));
  const assumptions = [...draft.assumptions];
  const prov = (source: Draft["lines"][number]["source"], note: string | null, refs: string[] = []): Prov => {
    const kept = refs.filter((r) => refIds.has(r));
    // A "reference" claim without a valid citation is downgraded to a default assumption.
    const src = source === "reference" && !kept.length ? "default" : source;
    return { source: src, note: note ?? (src !== source ? "No valid citation was given for this value." : null), refs: kept };
  };

  const taken = new Set<string>();
  const products: SpecProduct[] = [];
  const productByName = new Map<string, string>();
  const materials: SpecMaterial[] = [];
  const materialByName = new Map<string, string>();
  const ensureMaterial = (name: string): string => {
    const hit = [...materialByName.entries()].find(([n]) => near(n, name));
    if (hit) return hit[1];
    const id = uniqueId(name, taken);
    materialByName.set(name, id);
    materials.push({ id, name, unit: "pcs", onHand: null, unitCost: null, leadTimeHours: null, supplier: null, prov: { source: "default", note: "Named in a bill of materials." } });
    return id;
  };
  for (const m of draft.materials) {
    const id = uniqueId(m.name, taken);
    materialByName.set(m.name, id);
    materials.push({ id, name: m.name, unit: m.unit || "pcs", onHand: m.onHand ?? null, unitCost: m.unitCost, leadTimeHours: m.leadTimeHours, supplier: m.supplier?.trim() || null, prov: prov(m.source, m.note) });
  }
  const ensureProduct = (name: string, note: string): string => {
    const hit = [...productByName.entries()].find(([n]) => near(n, name));
    if (hit) return hit[1];
    const id = uniqueId(name, taken);
    productByName.set(name, id);
    products.push({ id, name, unit: "units", ratePerHour: null, unitPrice: null, unitMaterialCost: null, materials: [], prov: { source: "default", note } });
    return id;
  };
  for (const p of draft.products) {
    const id = uniqueId(p.name, taken);
    productByName.set(p.name, id);
    products.push({
      id,
      name: p.name,
      unit: p.unit || "units",
      ratePerHour: p.ratePerHour,
      unitPrice: p.unitPrice,
      unitMaterialCost: p.unitMaterialCost,
      materials: p.materials.map((b) => ({ materialId: ensureMaterial(b.material), qtyPerUnit: b.qtyPerUnit })),
      prov: prov(p.source, p.note, p.refs),
    });
  }

  const lines: SpecLine[] = draft.lines.map((l) => {
    const lineId = uniqueId(l.name, taken);
    const machines = l.machines.slice(0, 8).map((m) => {
      let archetype = m.archetype as AssetKind;
      if (!(ASSET_KINDS as string[]).includes(m.archetype)) {
        assumptions.push(`"${m.name}" was proposed as "${m.archetype}", which is not a supported machine type; modelled as a manual/semi-automatic station. Please choose the right type.`);
        archetype = "workstation";
      }
      const el = m.blueprintElement ? elements.get(m.blueprintElement) : undefined;
      const source = m.source === "blueprint" && !el ? "default" : m.source;
      return {
        id: uniqueId(`${l.name} ${m.name}`, taken),
        name: m.name,
        archetype,
        ratePerHour: m.ratePerHour,
        notes: null,
        box: el ? boxFrom(el.box) : null,
        prov: prov(source, source !== m.source ? "Marked as from the blueprint, but no matching element was found on the drawing." : m.note, m.refs),
      };
    });
    if (l.machines.length > 8) assumptions.push(`${l.name}: ${l.machines.length - 8} machine(s) beyond the 8-per-line limit were left out; combine parallel stations.`);
    const boxes = machines.map((m) => m.box).filter((b): b is NonNullable<typeof b> => !!b);
    const box = boxes.length
      ? (() => {
          const x0 = Math.min(...boxes.map((b) => b.x));
          const y0 = Math.min(...boxes.map((b) => b.y));
          const x1 = Math.max(...boxes.map((b) => b.x + b.w));
          const y1 = Math.max(...boxes.map((b) => b.y + b.h));
          const r = (v: number) => Math.round(v * 10000) / 10000;
          return { x: r(x0), y: r(y0), w: r(x1 - x0), h: r(y1 - y0) };
        })()
      : null;
    return {
      id: lineId,
      name: l.name,
      role: l.role,
      machines,
      productIds: l.role === "process" ? l.products.map((p) => ensureProduct(p, `Named on ${l.name}.`)) : [],
      box,
      prov: prov(l.source, l.note),
    };
  });

  const targetByName = new Map<string, string>([["site", "site"]]);
  for (const l of lines) {
    targetByName.set(l.name.toLowerCase(), l.id);
    for (const m of l.machines) targetByName.set(m.name.toLowerCase(), m.id);
  }
  // "simulated" is the default for every machine, so planning it adds nothing; drop it.
  const integrations = draft.integrations
    .filter((i) => (INTEGRATION_KINDS as readonly string[]).includes(i.kind) && i.kind !== "simulated")
    .map((i) => ({
      id: uniqueId(`conn ${i.kind} ${i.target}`, taken),
      target: targetByName.get(i.target.trim().toLowerCase()) ?? i.target,
      kind: i.kind as (typeof INTEGRATION_KINDS)[number],
      address: i.address,
      notes: i.note,
      prov: prov(i.source, null),
    }));

  // Mobile robots: map line names to ids; unknown types or missions are flagged, never guessed silently.
  const lineByName = (n: string | null) => (n ? lines.find((l) => near(l.name, n) || l.id === n) : undefined);
  const mobileRobots: SpecRobotFleet[] = [];
  for (const r of draft.mobileRobots ?? []) {
    const type = (ROBOT_TYPES as readonly string[]).includes(r.robotType) ? (r.robotType as SpecRobotFleet["robotType"]) : "amr";
    const mission = (ROBOT_MISSIONS as readonly string[]).includes(r.mission) ? (r.mission as SpecRobotFleet["mission"]) : null;
    if (!mission) {
      assumptions.push(`Mobile robots "${r.name}" were proposed for "${r.mission}", which the simulator does not model; left out. Supported moves: kitting, line-transfer, finished-goods.`);
      continue;
    }
    if (type !== r.robotType) assumptions.push(`"${r.name}": robot type "${r.robotType}" is not supported; modelled as AMRs.`);
    const count = Math.min(12, r.count);
    if (count < r.count) assumptions.push(`"${r.name}": ${r.count} robots requested; at most 12 per fleet are simulated.`);
    mobileRobots.push({
      id: uniqueId(r.name, taken),
      name: r.name,
      robotType: type,
      mission,
      lineId: lineByName(r.line)?.id ?? null,
      count,
      unitsPerTrip: r.unitsPerTrip,
      speedMps: null,
      trigger: { kind: "output", everyMinutes: null },
      route: [],
      prov: prov(r.source, r.note),
    });
  }

  const userName = ctx.userSite.name?.trim();
  const userIndustry = ctx.userSite.industry?.trim();
  return {
    version: 1,
    site: {
      name: userName || draft.site.name || ctx.reading?.siteName || "New factory",
      industry: userIndustry || draft.site.industry || ctx.reading?.industry || "Manufacturing",
      location: ctx.userSite.location?.trim() || draft.site.location || "",
      productionType: draft.site.productionType || "",
      prov: { source: userName || userIndustry ? "user" : ctx.reading?.siteName ? "blueprint" : "requirement", note: null, refs: [] },
    },
    lines,
    products,
    materials,
    integrations,
    mobileRobots,
    rules: [],
    references: ctx.references.map((r) => ({ id: r.id, title: r.title, url: r.url, note: null })),
    assumptions,
    questions: draft.questions.map((text, i) => ({ id: `q${i + 1}`, text, answer: null })),
    blueprint: ctx.reading && ctx.blueprintFile ? { fileName: ctx.blueprintFile.slice(0, 160), kind: ctx.reading.drawingKind, summary: ctx.reading.summary } : null,
    options: { rehearsalIncident: false, linesInterchangeable: true },
  };
}
