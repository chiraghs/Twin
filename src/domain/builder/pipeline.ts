/**
 * Twin Builder agent workflow: READ the blueprint → RESEARCH the industry → DRAFT a spec →
 * VALIDATE it. The model is injected (`BuilderAi`), so the workflow is the same in production,
 * in tests (recorded responses) and without AI (templates + keyword matching). Each stage
 * streams what it actually produced; failures fall back explicitly and say so.
 */
import { applyOps, type SpecOp } from "./ops";
import { specFromDraft, type BlueprintReading, type Draft, type ResearchResult } from "./draft";
import type { TwinSpec } from "./spec";
import { mentionsRobots, robotsFromRequirements } from "./robots";
import { matchTemplate, templateById } from "./templates";
import { validateSpec, type ValidationResult } from "./validate";

export type BuilderStage = "read" | "research" | "draft" | "validate";

export interface BlueprintFile {
  /** Base64 file content. */
  data: string;
  mimeType: string;
  fileName: string;
}

export interface DraftContext {
  requirements: string;
  site: BuilderInput["site"];
  reading: BlueprintReading | null;
  research: ResearchResult | null;
  template: TwinSpec | null;
}

export interface BuilderAi {
  available: boolean;
  model: string | null;
  /** Set when the provider can't search the web: the research stage is skipped with this reason. */
  researchUnavailable?: string | null;
  readBlueprint(file: BlueprintFile, hints: { industry?: string; requirements: string }): Promise<BlueprintReading>;
  research(q: { industry: string; productionType: string; requirements: string; drawing: string | null }): Promise<ResearchResult>;
  draft(ctx: DraftContext): Promise<Draft>;
  refine(spec: TwinSpec, instruction: string): Promise<{ ops: SpecOp[]; explanation: string }>;
}

export interface BuilderInput {
  requirements: string;
  site: { name?: string; industry?: string; location?: string };
  templateId: string | null;
  blueprint: BlueprintFile | null;
  research: boolean;
}

export type BuilderEvent =
  | { type: "stage"; stage: BuilderStage; status: "running" | "done" | "skipped" | "error"; summary?: string }
  | { type: "reading"; reading: BlueprintReading }
  | { type: "research"; research: ResearchResult }
  | { type: "draft"; spec: TwinSpec; mode: "ai" | "template"; note: string | null }
  | { type: "validation"; result: ValidationResult }
  | { type: "error"; message: string }
  | { type: "complete"; spec: TwinSpec | null };

const NO_AI = "AI is turned off";

function fromTemplate(input: BuilderInput, reason: string): { spec: TwinSpec; note: string } | null {
  const chosen = input.templateId ? templateById(input.templateId) : null;
  const matched = chosen ? null : matchTemplate(`${input.site.industry ?? ""} ${input.requirements}`);
  const tpl = chosen ?? matched?.template ?? null;
  if (!tpl) return null;
  const spec = structuredClone(tpl.spec);
  if (input.site.name?.trim()) spec.site.name = input.site.name.trim();
  if (input.site.industry?.trim()) spec.site.industry = input.site.industry.trim();
  if (input.site.location?.trim()) spec.site.location = input.site.location.trim();
  const how = chosen ? `the "${tpl.name}" template you picked` : `the "${tpl.name}" template, the closest match to your description`;
  const robots = robotsFromRequirements(input.requirements, spec);
  spec.mobileRobots.push(...robots);
  const note = `${reason}: started from ${how}.${robots.length ? ` ${robots.length} mobile robot fleet(s) were read from your requirements.` : ""} Other details in your description need AI to be read.`;
  spec.assumptions.unshift(note);
  return { spec, note };
}

export async function* runBuilder(input: BuilderInput, ai: BuilderAi): AsyncGenerator<BuilderEvent, void> {
  let reading: BlueprintReading | null = null;
  let research: ResearchResult | null = null;
  let spec: TwinSpec | null = null;
  const template = input.templateId ? (templateById(input.templateId)?.spec ?? null) : null;

  // READ
  if (!input.blueprint) {
    yield { type: "stage", stage: "read", status: "skipped", summary: "No blueprint uploaded." };
  } else if (!ai.available) {
    yield { type: "stage", stage: "read", status: "skipped", summary: `${NO_AI}, so the drawing wasn't read.` };
  } else {
    yield { type: "stage", stage: "read", status: "running" };
    try {
      reading = await ai.readBlueprint(input.blueprint, { industry: input.site.industry, requirements: input.requirements });
      yield { type: "reading", reading };
      const machines = reading.elements.filter((e) => e.role === "machine" || e.role === "conveyor").length;
      yield {
        type: "stage",
        stage: "read",
        status: "done",
        summary: reading.legible ? `${reading.drawingKind}: ${machines} machine(s) and ${reading.flows.length} flow link(s) recognised.` : `The drawing was hard to read: ${reading.summary}`,
      };
    } catch (e) {
      yield { type: "stage", stage: "read", status: "error", summary: `Could not read the blueprint: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // RESEARCH
  if (!input.research) {
    yield { type: "stage", stage: "research", status: "skipped", summary: "Research turned off." };
  } else if (!ai.available) {
    yield { type: "stage", stage: "research", status: "skipped", summary: `Skipped: ${NO_AI}.` };
  } else if (ai.researchUnavailable) {
    yield { type: "stage", stage: "research", status: "skipped", summary: ai.researchUnavailable };
  } else {
    yield { type: "stage", stage: "research", status: "running" };
    try {
      research = await ai.research({
        industry: input.site.industry || reading?.industry || template?.site.industry || "manufacturing",
        productionType: template?.site.productionType ?? "",
        requirements: input.requirements,
        drawing: reading?.summary ?? null,
      });
      yield { type: "research", research };
      yield { type: "stage", stage: "research", status: "done", summary: `${research.references.length} source(s) found${research.queries.length ? ` for “${research.queries[0]}”` : ""}.` };
    } catch (e) {
      yield { type: "stage", stage: "research", status: "error", summary: `Research failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // DRAFT
  yield { type: "stage", stage: "draft", status: "running" };
  if (ai.available && (input.requirements.trim() || reading || template)) {
    try {
      const draft = await ai.draft({ requirements: input.requirements, site: input.site, reading, research, template });
      spec = specFromDraft(draft, { reading, references: research?.references ?? [], blueprintFile: input.blueprint?.fileName ?? null, userSite: input.site });
      // Safety net: robots the owner asked for are never dropped silently.
      if (!spec.mobileRobots.length && mentionsRobots(input.requirements)) {
        const robots = robotsFromRequirements(input.requirements, spec);
        if (robots.length) {
          spec.mobileRobots = robots;
          spec.assumptions.push("The AI draft left out the mobile robots in your requirements; they were added by keyword matching. Check their counts, moves and lines.");
        }
      }
      yield { type: "draft", spec, mode: "ai", note: null };
      const robotCount = spec.mobileRobots.reduce((n, f) => n + f.count, 0);
      yield { type: "stage", stage: "draft", status: "done", summary: `${spec.lines.length} line(s), ${spec.lines.reduce((n, l) => n + l.machines.length, 0)} machine(s), ${spec.products.length} product(s)${robotCount ? `, ${robotCount} mobile robot(s)` : ""}, ${spec.questions.length} open question(s).` };
    } catch (e) {
      const reason = `The AI draft failed (${e instanceof Error ? e.message.slice(0, 160) : String(e)})`;
      const fb = fromTemplate(input, reason);
      if (fb) {
        spec = fb.spec;
        yield { type: "draft", spec, mode: "template", note: fb.note };
        yield { type: "stage", stage: "draft", status: "done", summary: fb.note };
      } else {
        yield { type: "stage", stage: "draft", status: "error", summary: `${reason}, and no template matched. Pick a template to start from.` };
      }
    }
  } else {
    const fb = fromTemplate(input, ai.available ? "No requirements or blueprint were given" : NO_AI);
    if (fb) {
      spec = fb.spec;
      yield { type: "draft", spec, mode: "template", note: fb.note };
      yield { type: "stage", stage: "draft", status: "done", summary: fb.note };
    } else {
      yield { type: "stage", stage: "draft", status: "error", summary: `${ai.available ? "Nothing to draft from" : NO_AI}. Pick a template, or describe the plant with words such as bottling, machining, molding, bakery, welding, tablets or SMT.` };
    }
  }

  // VALIDATE
  if (spec) {
    yield { type: "stage", stage: "validate", status: "running" };
    const result = validateSpec(spec);
    if (result.spec) spec = result.spec;
    yield { type: "validation", result };
    const counts = { error: 0, warning: 0, info: 0 };
    for (const i of result.issues) counts[i.level]++;
    yield {
      type: "stage",
      stage: "validate",
      status: result.ok ? "done" : "error",
      summary: result.ok ? `Ready to review: ${counts.warning} warning(s), ${counts.info} note(s).` : `${counts.error} error(s) to fix before building.`,
    };
  } else {
    yield { type: "stage", stage: "validate", status: "skipped" };
  }
  yield { type: "complete", spec };
}

/** Chat refinement: the model proposes edit operations; they are applied and validated in code. */
export async function refineSpec(spec: TwinSpec, instruction: string, ai: BuilderAi) {
  const { ops, explanation } = await ai.refine(spec, instruction);
  const result = applyOps(spec, ops, { source: "requirement", note: `Changed by the agent at your request: “${instruction.slice(0, 200)}”`, refs: [] });
  const validation = validateSpec(result.spec);
  return { ...result, spec: validation.spec ?? result.spec, explanation, validation, proposed: ops };
}
