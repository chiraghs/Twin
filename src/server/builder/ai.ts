import "server-only";
import { ASSET_KINDS } from "@/domain/archetypes";
import { ARCHETYPE_CATALOG, BlueprintReadingSchema, DraftSchema, type ResearchResult } from "@/domain/builder/draft";
import { SpecOpSchema } from "@/domain/builder/ops";
import type { BuilderAi } from "@/domain/builder/pipeline";
import { INTEGRATION_KINDS, ROBOT_MISSIONS, ROBOT_TYPES, RULE_KINDS, type TwinSpec } from "@/domain/builder/spec";
import { aiCapabilities, aiConfig, META_MODELS, modelLabel } from "@/server/ai/config";
import { segmentImage, toGrid } from "@/server/ai/meta-media";
import { mergeSegmentation, type Footprint } from "@/domain/builder/segmentation";
import { llmGenerate } from "@/server/ai/llm";

/**
 * The Twin Builder agent on Meta Model API (Muse Spark, with Responses web search for cited
 * research; SAM 3.1 for equipment footprints). Every call uses a JSON schema (except web research, which returns cited notes) and
 * every response is validated with zod before use.
 */

const SOURCES = ["blueprint", "requirement", "reference", "template", "default"];
const nstr = { type: ["string", "null"] };
const nnum = { type: ["number", "null"] };

const READ_SCHEMA = {
  type: "object",
  properties: {
    legible: { type: "boolean" },
    drawingKind: { type: "string", description: "floor plan, process flow diagram, P&ID, equipment layout, hand sketch, photo or other" },
    summary: { type: "string", description: "Two or three sentences describing what the drawing shows." },
    siteName: nstr,
    industry: nstr,
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "e1, e2, …" },
          label: { type: "string", description: "Label exactly as written on the drawing, or a short description if unlabelled." },
          role: { type: "string", enum: ["machine", "conveyor", "storage", "dock", "utility", "office", "vehicle", "other"], description: "vehicle: AGV/AMR paths, charging stations or automated forklifts shown on the drawing." },
          archetype: { type: "string", enum: [...ASSET_KINDS, "none"] },
          lineHint: nstr,
          box: { type: "array", items: { type: "number" }, description: "[ymin, xmin, ymax, xmax] on a 0–1000 grid" },
          confidence: { type: "number" },
        },
        required: ["id", "label", "role", "archetype", "lineHint", "box", "confidence"],
      },
    },
    flows: { type: "array", items: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] } },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["legible", "drawingKind", "summary", "siteName", "industry", "elements", "flows", "notes"],
};

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    site: {
      type: "object",
      properties: { name: { type: "string" }, industry: { type: "string" }, location: { type: "string" }, productionType: { type: "string" } },
      required: ["name", "industry", "location", "productionType"],
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: ["process", "packing"] },
          products: { type: "array", items: { type: "string" } },
          source: { type: "string", enum: SOURCES },
          note: nstr,
          machines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                archetype: { type: "string", enum: ASSET_KINDS },
                ratePerHour: nnum,
                source: { type: "string", enum: SOURCES },
                note: nstr,
                refs: { type: "array", items: { type: "string" } },
                blueprintElement: nstr,
              },
              required: ["name", "archetype", "ratePerHour", "source", "note", "refs", "blueprintElement"],
            },
          },
        },
        required: ["name", "role", "products", "source", "note", "machines"],
      },
    },
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          unit: { type: "string" },
          ratePerHour: nnum,
          unitPrice: nnum,
          unitMaterialCost: nnum,
          source: { type: "string", enum: SOURCES },
          note: nstr,
          refs: { type: "array", items: { type: "string" } },
          materials: { type: "array", items: { type: "object", properties: { material: { type: "string" }, qtyPerUnit: { type: "number" } }, required: ["material", "qtyPerUnit"] } },
        },
        required: ["name", "unit", "ratePerHour", "unitPrice", "unitMaterialCost", "source", "note", "refs", "materials"],
      },
    },
    materials: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, unit: { type: "string" }, unitCost: nnum, leadTimeHours: nnum, source: { type: "string", enum: SOURCES }, note: nstr },
        required: ["name", "unit", "unitCost", "leadTimeHours", "source", "note"],
      },
    },
    integrations: {
      type: "array",
      items: {
        type: "object",
        properties: { target: { type: "string" }, kind: { type: "string", enum: INTEGRATION_KINDS }, address: nstr, note: nstr, source: { type: "string", enum: SOURCES } },
        required: ["target", "kind", "address", "note", "source"],
      },
    },
    mobileRobots: {
      type: "array",
      description: "Mobile robots (AMRs, AGVs, automated forklifts, tuggers). ONLY when the requirements or the blueprint call for them; otherwise an empty array.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short fleet name, e.g. \"Kitting AMRs Line 1\"." },
          robotType: { type: "string", enum: ROBOT_TYPES },
          mission: { type: "string", enum: ROBOT_MISSIONS, description: "kitting: stores → a process line; line-transfer: a process line → the packing line; finished-goods: the packing line → the shipping dock." },
          line: { type: ["string", "null"], description: "Name of the process line served (kitting, line-transfer). null for finished-goods." },
          count: { type: "integer", description: "Number of robots in this fleet (as stated; if unstated, 1 and say so in note)." },
          unitsPerTrip: nnum,
          source: { type: "string", enum: SOURCES },
          note: nstr,
        },
        required: ["name", "robotType", "mission", "line", "count", "unitsPerTrip", "source", "note"],
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["site", "lines", "products", "materials", "integrations", "mobileRobots", "assumptions", "questions"],
};

const OP_FIELDS = Object.keys(SpecOpSchema.shape).filter((k) => k !== "op" && !["archetype", "kind", "position", "lineId", "machineId", "robotType", "mission", "ruleKind", "when", "action", "metric", "triggerKind", "route"].includes(k));
/** Fields models confuse most, described explicitly. */
const OP_DESCRIPTIONS = {
  archetype: { type: ["string", "null"], enum: [...ASSET_KINDS, null], description: "Machine type. Required for add_machine; optional for update_machine and add_line." },
  kind: { type: ["string", "null"], enum: [...INTEGRATION_KINDS, null], description: "Connection type. Only for add_integration." },
  position: { type: ["number", "null"], description: "0-based index in the line's machine list (add_machine, move_machine). To insert after the machine at index i, use i + 1." },
  lineId: { type: ["string", "null"], description: "Existing line id from the spec." },
  machineId: { type: ["string", "null"], description: "Existing machine id from the spec." },
  robotType: { type: ["string", "null"], enum: [...ROBOT_TYPES, null], description: "Mobile robot type. For add_robot_fleet (default amr) and update_robot_fleet." },
  mission: { type: ["string", "null"], enum: [...ROBOT_MISSIONS, null], description: "Mobile robot move. Required for add_robot_fleet." },
  ruleKind: { type: ["string", "null"], enum: [...RULE_KINDS, null], description: "Rule type. Required for add_rule." },
  when: { type: ["string", "null"], enum: ["upstream-stops", "downstream-stops", "buffer-full", null], description: "Connector rule trigger: upstream-stops = lineId itself stops; downstream-stops = the packing line after it stops; buffer-full = the buffer between lineId and packing reaches bufferUnits." },
  action: { type: ["string", "null"], enum: ["divert", "slow", "pause", null], description: "Connector rule action: divert (toLineId takes over lineId's work; only with upstream-stops), slow (lineId to speedPct), pause (lineId stops until the condition clears)." },
  metric: { type: ["string", "null"], enum: ["health", "vibration", null], description: "Maintenance rule metric: health score (0–100, fires below threshold) or vibration (mm/s, fires above threshold)." },
  triggerKind: { type: ["string", "null"], enum: ["output", "schedule", null], description: "Robot trips: output = sized from line output; schedule = one trip every everyMinutes." },
  route: { type: ["array", "null"], items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] }, description: "set_robot_route waypoints in floor units; [] restores the standard route." },
};
const REFINE_SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string", description: "One or two sentences on what you changed and why." },
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: SpecOpSchema.shape.op.options },
          ...OP_DESCRIPTIONS,
          ...Object.fromEntries(
            OP_FIELDS.map((k) => [
              k,
              ["position", "ratePerHour", "unitPrice", "unitMaterialCost", "unitCost", "leadTimeHours", "onHand", "count", "unitsPerTrip", "speedMps", "x", "y", "rot", "everyMinutes", "below", "orderQty", "threshold", "speedPct", "bufferUnits"].includes(k)
                ? nnum
                : ["clearRate", "value", "enabled"].includes(k)
                  ? { type: ["boolean", "null"] }
                  : k === "productIds"
                    ? { type: ["array", "null"], items: { type: "string" } }
                    : k === "materials"
                      ? { type: ["array", "null"], items: { type: "object", properties: { materialId: { type: "string" }, qtyPerUnit: { type: "number" } }, required: ["materialId", "qtyPerUnit"] } }
                      : nstr,
            ]),
          ),
        },
        // Every field is required (null when it does not apply): optional fields get silently dropped otherwise.
        required: ["op", ...Object.keys(OP_DESCRIPTIONS), ...OP_FIELDS],
      },
    },
  },
  required: ["explanation", "ops"],
};


const SAM_CONCEPTS = ["machine", "conveyor"];

/** SAM 3.1: one request per concept (the API segments one concept at a time). Never throws. */
async function segmentFootprints(media: { mimeType: string; data: string }): Promise<{ footprints: Footprint[]; error: string | null }> {
  const results = await Promise.allSettled(SAM_CONCEPTS.map((c) => segmentImage(media, c, 60_000).then((boxes) => boxes.map((b) => ({ concept: c, box: toGrid(b) })))));
  const footprints = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  return { footprints, error: !footprints.length && failed ? String(failed.reason instanceof Error ? failed.reason.message : failed.reason) : null };
}

function compactSpec(spec: TwinSpec) {
  return {
    site: { name: spec.site.name, industry: spec.site.industry, location: spec.site.location, productionType: spec.site.productionType },
    lines: spec.lines.map((l) => ({ id: l.id, name: l.name, role: l.role, productIds: l.productIds, machines: l.machines.map((m) => ({ id: m.id, name: m.name, archetype: m.archetype, ratePerHour: m.ratePerHour, pos: m.pos ?? null })) })),
    products: spec.products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, ratePerHour: p.ratePerHour, materials: p.materials })),
    materials: spec.materials.map((m) => ({ id: m.id, name: m.name, unit: m.unit })),
    integrations: spec.integrations.map((i) => ({ id: i.id, target: i.target, kind: i.kind, address: i.address })),
    mobileRobots: spec.mobileRobots.map((f) => ({ id: f.id, name: f.name, robotType: f.robotType, mission: f.mission, lineId: f.lineId, count: f.count, unitsPerTrip: f.unitsPerTrip, trigger: f.trigger, route: f.route })),
    rules: spec.rules.map(({ prov: _prov, ...r }) => r),
    questions: spec.questions,
    options: spec.options,
  };
}

export function builderAi(): BuilderAi {
  const cfg = aiConfig();
  const caps = aiCapabilities(cfg);
  return {
    available: caps.available,
    model: caps.available ? modelLabel(cfg) : null,
    researchUnavailable: caps.available && !caps.webSearch ? `Web research is unavailable with ${modelLabel(cfg)}.` : null,

    async readBlueprint(file, hints) {
      const prompt = [
        "You are reading a drawing of an industrial facility for a digital-twin builder. It may be a floor plan, process flow diagram, P&ID, equipment layout, hand sketch or photo.",
        "List every production machine, conveyor or transfer path, storage area, dock and utility you can actually see. Do not invent anything that is not on the drawing.",
        "For each element: give the label exactly as written (or a short description if unlabelled), its role, the closest machine archetype from this catalog (\"none\" if it is not production equipment), a lineHint grouping elements that belong to the same line (from arrows, flow lines or layout), and a bounding box [ymin, xmin, ymax, xmax] on a 0–1000 grid.",
        "Report material-flow links between elements. confidence is your own 0–1 estimate. If the drawing is illegible, set legible to false and explain in summary.",
        "",
        "Machine archetype catalog:",
        ARCHETYPE_CATALOG,
        "",
        `Context from the user (may be empty): industry=${hints.industry ?? ""}; requirements=${hints.requirements.slice(0, 1500)}`,
      ].join("\n");
      const media = { mimeType: file.mimeType, data: file.data };
      // Muse Spark reads labels and flow; SAM 3.1 finds equipment footprints in parallel.
      const [r, footprints] = await Promise.all([
        llmGenerate({ prompt, media: [media], json: { name: "blueprint_reading", schema: READ_SCHEMA }, maxOutputTokens: 8192, timeoutMs: 90_000 }),
        file.mimeType.startsWith("image/") ? segmentFootprints(media) : Promise.resolve({ footprints: [], error: null }),
      ]);
      const raw = r.json as { elements?: { archetype?: string | null }[] };
      for (const e of raw.elements ?? []) if (e.archetype === "none") e.archetype = null;
      const reading = BlueprintReadingSchema.parse(raw);
      if (footprints.error) return { ...reading, notes: [...reading.notes, `SAM 3.1 segmentation unavailable (${footprints.error.slice(0, 120)}); boxes are Muse Spark estimates.`].slice(-10) };
      return footprints.footprints.length ? mergeSegmentation(reading, footprints.footprints, META_MODELS.segmentation, SAM_CONCEPTS) : reading;
    },

    async research(q) {
      const prompt = [
        `Research the standard production setup for this factory, using current web sources: industry "${q.industry}"${q.productionType ? `, process "${q.productionType}"` : ""}.`,
        q.requirements ? `The owner says: ${q.requirements.slice(0, 1500)}` : "",
        q.drawing ? `Their layout drawing shows: ${q.drawing}` : "",
        "Report concisely in bullet points:",
        "1. The typical sequence of process steps and equipment from raw material to packed product (standard line layout).",
        "2. Typical throughput of a line and of the key machines, with units, only where sources state them.",
        "3. Common failure modes and condition-monitoring sensors for the key equipment.",
        "4. Quality checks and the standards that apply.",
        "5. Typical data interfaces for this equipment (for example OPC UA, MQTT, Modbus).",
        "Do not state numbers that your sources do not support.",
      ]
        .filter(Boolean)
        .join("\n");
      const r = await llmGenerate({ prompt, webSearch: true, maxOutputTokens: 8192, timeoutMs: 90_000 });
      const references: ResearchResult["references"] = r.citations.map((c) => ({ id: c.id, title: c.title, url: c.url }));
      return { notes: r.markedText.slice(0, 8000), references, queries: r.queries, searchEntryPoint: r.searchEntryPoint };
    },

    async draft(ctx) {
      const prompt = [
        "You are the Twin Builder agent of an industrial digital-twin platform. Propose the factory structure as JSON matching the schema.",
        "",
        "Rules:",
        "- Use ONLY these machine archetypes. Map each real machine to the closest archetype. `name` is a short descriptive name plus the tag shown on the drawing, if any (for example \"Blow molder BM-101\"):",
        ARCHETYPE_CATALOG,
        "- The simulator supports 1–4 process lines and at most one packing / end-of-line area (role \"packing\") that receives all process-line output. List machines in material-flow order, at most 8 per line. Represent parallel identical machines as one machine with their combined rate and say so in `note`.",
        "- Provenance (`source`): \"blueprint\" only for elements on the blueprint reading (set `blueprintElement` to its id); \"requirement\" for what the user asked for; \"reference\" only when supported by the research notes, citing their [R#] ids in `refs`; \"template\" for elements kept from the given template; otherwise \"default\" for your own typical assumptions.",
        "- Numbers: give ratePerHour, prices and costs ONLY when stated in the requirements, the blueprint or the cited research; otherwise use null and the system will derive stated defaults. Never invent supplier names, addresses or credentials.",
        "- Integrations: only connections the user asked for or that the blueprint shows (PLC, SCADA, historian, cameras). `target` is a line name, a machine name, or \"site\". If the user asks to monitor something without naming the protocol, pick the most likely interface, set source to \"default\" and explain the choice in `note`.",
        "- Mobile robots: add `mobileRobots` ONLY if the requirements or the blueprint mention AMRs, AGVs, automated forklifts, tuggers or mobile robots; never add them on your own. Map each fleet to one move (kitting, line-transfer or finished-goods), the line it serves, and the count stated (if no count is stated, use 1 and say so in `note`). Mark them \"requirement\" or \"blueprint\". If a requested move is not one of these three, leave it out and say so in `assumptions`.",
        "- Put every assumption you make in `assumptions`, and ask up to 6 short `questions` where information that matters is missing.",
        "- If a template is given, start from it and change it to match the requirements and blueprint.",
        "",
        "INPUT:",
        JSON.stringify({
          requirements: ctx.requirements.slice(0, 4000),
          site: ctx.site,
          blueprintReading: ctx.reading,
          researchNotes: ctx.research?.notes ?? null,
          references: ctx.research?.references.map((r) => ({ id: r.id, title: r.title })) ?? [],
          template: ctx.template ? compactSpec(ctx.template) : null,
        }),
      ].join("\n");
      const r = await llmGenerate({ prompt, json: { name: "factory_draft", schema: DRAFT_SCHEMA }, maxOutputTokens: 16384, timeoutMs: 120_000 });
      return DraftSchema.parse(r.json);
    },

    async refine(spec, instruction) {
      const prompt = [
        "You edit a factory digital-twin spec by returning edit operations as JSON. Apply exactly what the user asks, nothing more.",
        "Use existing ids from the spec for lineId, machineId, productId, materialId, integrationId and questionId. For new items give a `name`.",
        `Machine archetypes (archetype field): ${ASSET_KINDS.join(", ")}. Connection kinds (kind field): ${INTEGRATION_KINDS.join(", ")}. For add_integration, target is a line id, machine id or "site".`,
        `Mobile robots: add_robot_fleet (mission ${ROBOT_MISSIONS.join("|")}, robotType ${ROBOT_TYPES.join("|")}, lineId of the process line served — null for finished-goods, count, name), update_robot_fleet (fleetId plus the fields to change, e.g. count), remove_robot_fleet (fleetId).`,
        "Floor plan (playground): positions are in floor units (1 unit ≈ 2 m; machines in a line sit about 2.7 apart, lines about 3.4 apart). place_machine moves a machine (machineId, x, y, rot 0|90|180|270); add_machine and add_line also accept x, y. Unplaced machines (pos null) use the automatic layout.",
        "Material flow: connect (machineId → targetId) makes targetId the next machine after machineId, moving it into that line; disconnect (machineId) splits its line after that machine. Machines on a line run in series.",
        "Rules (simulated automation, never real equipment): add_rule with ruleKind inventory (materialId, below = reorder when stock plus open orders fall below it, orderQty), maintenance (machineId or null for every machine, metric, threshold; it proposes maintenance for a person to approve) or connector (lineId, when, action, toLineId for divert, speedPct for slow, bufferUnits for buffer-full). update_rule (ruleId plus fields, enabled true/false), remove_rule (ruleId).",
        "Robot movement: update_robot_fleet with triggerKind schedule and everyMinutes (or triggerKind output), set_robot_route (fleetId, route waypoints).",
        "Do every part of the request that these operations can express. Skip only the parts they cannot (for example an unsupported protocol) and say which parts you skipped and why in `explanation`.",
        "Only set numbers the user states. Never include credentials.",
        "",
        `SPEC: ${JSON.stringify(compactSpec(spec))}`,
        "",
        `USER REQUEST: ${instruction.slice(0, 2000)}`,
      ].join("\n");
      const r = await llmGenerate({ prompt, json: { name: "spec_edits", schema: REFINE_SCHEMA }, maxOutputTokens: 8192, timeoutMs: 60_000 });
      const raw = r.json as { explanation?: string; ops?: unknown[] };
      return { explanation: String(raw.explanation ?? "").slice(0, 600), ops: (raw.ops ?? []) as never };
    },
  };
}
