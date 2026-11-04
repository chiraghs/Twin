import "server-only";
import { ASSET_KINDS } from "@/domain/archetypes";
import { ARCHETYPE_CATALOG, BlueprintReadingSchema, DraftSchema } from "@/domain/builder/draft";
import type { BuilderAi } from "@/domain/builder/pipeline";
import { INTEGRATION_KINDS, ROBOT_MISSIONS, ROBOT_TYPES } from "@/domain/builder/spec";
import { baseten, OpenModelError, openJson } from "./baseten";

/**
 * Blueprint → Twin on Meta's open-weight Muse Spark Open (Baseten), for the Plant-Private AI
 * section. Implements the same BuilderAi port as the hosted Twin Builder, so the existing pipeline
 * (provenance, validation, deterministic compile) runs unchanged. Plant-private means no call to a
 * hosted model: no web research and no SAM 3.1; element boxes are Muse Spark Open's own estimates.
 */

const READ_SHAPE = `{
  "legible": true,
  "drawingKind": "floor plan | process flow diagram | P&ID | equipment layout | hand sketch | photo | other",
  "summary": "2-3 sentences on what the drawing shows",
  "siteName": "name written on the drawing, or null",
  "industry": "industry if evident, or null",
  "elements": [
    { "id": "e1", "label": "label exactly as written", "role": "machine | conveyor | storage | dock | utility | office | vehicle | other",
      "archetype": "one of: ${ASSET_KINDS.join(", ")} | null", "lineHint": "line or area it belongs to, or null",
      "box": [ymin, xmin, ymax, xmax], "confidence": 0.0-1.0 }
  ],
  "flows": [ { "from": "e1", "to": "e2" } ],
  "notes": ["anything uncertain"]
}
box values are numbers on a 0-1000 grid over the image. Use null (not a string) where a value is unknown.`;

const SOURCES = "blueprint | requirement | default";

const DRAFT_SHAPE = `{
  "site": { "name": "", "industry": "", "location": "", "productionType": "" },
  "lines": [
    { "name": "", "role": "process | packing", "products": ["product name"], "source": "${SOURCES}", "note": null,
      "machines": [ { "name": "", "archetype": "one of: ${ASSET_KINDS.join(", ")}", "ratePerHour": null, "source": "${SOURCES}",
                      "note": null, "refs": [], "blueprintElement": "e1 or null" } ] }
  ],
  "products": [ { "name": "", "unit": "pcs", "ratePerHour": null, "unitPrice": null, "unitMaterialCost": null, "source": "${SOURCES}",
                  "note": null, "refs": [], "materials": [ { "material": "material name", "qtyPerUnit": 1 } ] } ],
  "materials": [ { "name": "", "unit": "pcs", "unitCost": null, "leadTimeHours": null, "supplier": "only if stated, else null", "onHand": null, "source": "${SOURCES}", "note": null } ],
  "integrations": [ { "target": "line name, machine name or site", "kind": "one of: ${INTEGRATION_KINDS.join(", ")}", "address": null, "note": null, "source": "${SOURCES}" } ],
  "mobileRobots": [ { "name": "", "robotType": "one of: ${ROBOT_TYPES.join(", ")}", "mission": "one of: ${ROBOT_MISSIONS.join(", ")}", "line": "process line name or null",
                      "count": 1, "unitsPerTrip": null, "source": "${SOURCES}", "note": null } ],
  "assumptions": ["each assumption you made"],
  "questions": ["up to 6 short questions about missing information"]
}
Numbers that are not stated must be null (the system derives documented defaults). "mobileRobots" is [] unless robots are asked for or drawn.`;

/** Harmless model habits normalised before validation (never invents content). */
function prepareReading(raw: unknown) {
  const r = (raw ?? {}) as Record<string, unknown>;
  const elements = Array.isArray(r.elements) ? (r.elements as Record<string, unknown>[]) : [];
  return {
    ...r,
    siteName: r.siteName ?? null,
    industry: r.industry ?? null,
    notes: Array.isArray(r.notes) ? r.notes.slice(0, 10) : [],
    flows: Array.isArray(r.flows) ? r.flows.slice(0, 120) : [],
    elements: elements.slice(0, 80).map((e, i) => ({
      ...e,
      id: String(e.id ?? `e${i + 1}`).slice(0, 12),
      archetype: e.archetype === "none" || e.archetype === "" || e.archetype === undefined ? null : e.archetype,
      lineHint: e.lineHint ?? null,
      box: Array.isArray(e.box) && e.box.length === 4 && e.box.every((v) => typeof v === "number") ? e.box : null,
      confidence: typeof e.confidence === "number" ? Math.min(1, Math.max(0, e.confidence)) : 0.5,
    })),
  };
}

function prepareDraft(raw: unknown) {
  const d = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  return {
    ...d,
    lines: arr(d.lines).map((l: Record<string, unknown>) => ({
      ...l,
      note: l.note ?? null,
      products: arr(l.products),
      machines: arr(l.machines).map((m: Record<string, unknown>) => ({ ...m, ratePerHour: pos(m.ratePerHour), note: m.note ?? null, refs: [], blueprintElement: m.blueprintElement ?? null })),
    })),
    products: arr(d.products).map((p: Record<string, unknown>) => ({
      ...p,
      ratePerHour: pos(p.ratePerHour),
      unitPrice: pos(p.unitPrice),
      unitMaterialCost: pos(p.unitMaterialCost),
      note: p.note ?? null,
      refs: [],
      materials: arr(p.materials).filter((x: Record<string, unknown>) => pos(x?.qtyPerUnit) !== null),
    })),
    materials: arr(d.materials).map((m: Record<string, unknown>) => ({ ...m, unitCost: pos(m.unitCost), leadTimeHours: pos(m.leadTimeHours), note: m.note ?? null })),
    integrations: arr(d.integrations).map((i: Record<string, unknown>) => ({ ...i, address: i.address ?? null, note: i.note ?? null })),
    mobileRobots: arr(d.mobileRobots).map((r: Record<string, unknown>) => ({ ...r, line: r.line ?? null, unitsPerTrip: pos(r.unitsPerTrip), note: r.note ?? null })),
    assumptions: arr(d.assumptions).slice(0, 20),
    questions: arr(d.questions).slice(0, 6),
  };
}

export function privateBuilderAi(): BuilderAi {
  return {
    available: baseten.configured(),
    model: baseten.configured() ? baseten.label() : null,
    researchUnavailable: "Plant-private mode: no web research; nothing about the plant leaves the open-weight model.",

    async readBlueprint(file, hints) {
      if (!file.mimeType.startsWith("image/")) throw new OpenModelError("Plant-private mode reads images (PNG, JPEG, WebP).", 415);
      const out = await openJson(BlueprintReadingSchema, {
        purpose: "blueprint reading",
        system:
          "You read drawings of industrial facilities (floor plans, process flow diagrams, P&IDs, equipment layouts, hand sketches, photos) for a digital-twin builder. " +
          "List only production machines, conveyors, storage areas, docks, utilities and vehicles you can actually see. Never invent elements.",
        user: [
          "Read this drawing. For each element give the label as written, its role, the closest machine archetype from the catalog (null if it is not production equipment), a lineHint grouping elements of the same line, and a bounding box.",
          "Report material-flow links between elements. If the drawing is illegible, set legible to false and explain in summary.",
          "",
          "Machine archetype catalog:",
          ARCHETYPE_CATALOG,
          "",
          `Context from the user (may be empty): industry=${hints.industry ?? ""}; requirements=${hints.requirements.slice(0, 1500)}`,
        ].join("\n"),
        images: [{ mimeType: file.mimeType, data: file.data }],
        shape: READ_SHAPE,
        prepare: prepareReading,
        maxTokens: 6000,
        timeoutMs: 120_000,
      });
      return { ...out.value, notes: [...out.value.notes, `Read by ${baseten.label()} (open weights); boxes are the model's estimates (no SAM 3.1 in plant-private mode).`].slice(-10) };
    },

    async research() {
      throw new OpenModelError("Web research is not part of plant-private mode.", 415);
    },

    async draft(ctx) {
      const out = await openJson(DraftSchema, {
        purpose: "twin draft",
        system:
          "You are the Twin Builder agent of an industrial digital-twin platform running on-premise. Propose the factory structure from the owner's requirements and the blueprint reading. " +
          "Use only the given machine archetypes, list machines in material-flow order, and never invent numbers, supplier names, addresses or credentials.",
        user: [
          "Rules:",
          "- Machine archetypes (map each real machine to the closest one; `name` is a short descriptive name plus the drawing tag, if any):",
          ARCHETYPE_CATALOG,
          "- 1–4 process lines and at most one packing / end-of-line area (role \"packing\") that receives all process-line output. At most 8 machines per line. Parallel identical machines become one machine with a note.",
          "- source: \"blueprint\" only for elements in the blueprint reading (set blueprintElement to its id); \"requirement\" for what the user asked for; otherwise \"default\".",
          "- ratePerHour, prices and costs only when stated in the requirements or the drawing; otherwise null.",
          "- Integrations only when the user asks for them or the drawing shows them. Mobile robots only when asked for or drawn.",
          "- Put every assumption in `assumptions`; ask up to 6 short `questions` where important information is missing.",
          "",
          "INPUT:",
          JSON.stringify({ requirements: ctx.requirements.slice(0, 4000), site: ctx.site, blueprintReading: ctx.reading }),
        ].join("\n"),
        shape: DRAFT_SHAPE,
        prepare: prepareDraft,
        maxTokens: 8000,
        timeoutMs: 150_000,
      });
      return out.value;
    },

    async refine() {
      throw new OpenModelError("Chat edits are not part of the plant-private Blueprint to Twin flow.", 415);
    },
  };
}
