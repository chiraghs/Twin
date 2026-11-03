import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { nextId } from "@/domain/ids";
import type { FootageClip } from "@/domain/footage";
import type { Camera } from "@/domain/types";
import { addVisionReview, findingsFromInspection, VISION_CATEGORIES, type InspectionResult } from "@/domain/vision";
import { analyzeMedia } from "@/server/ai/provider";
import { nowISO } from "@/server/http";
import { recordCheck } from "@/server/integrations/status";
import { inspectWithService, visionService, VisionServiceError } from "@/server/integrations/vision-service";
import { getState, mutate } from "@/server/store";

/**
 * Visual reviews shared by uploads (Visual Quality) and camera feeds (CCTV control room).
 * Both engines are advisory: every result is stored as a review awaiting a person's disposition.
 */

/**
 * The configured AI model looks at an image, a clip, or a contact sheet of frames from a clip
 * (`frames`: their times in seconds) and reports findings in the plant's defect categories.
 */
export async function aiReview(input: { bytes: Buffer; mime: string; fileName: string; camera: Camera | null; note?: string; context?: string; frames?: number[] }) {
  const { camera } = input;
  const result = await analyzeMedia(input.bytes, input.mime, {
    station: camera ? `${camera.name} (${camera.purpose})${input.context ? `. ${input.context}` : ""}` : (input.context ?? "Unspecified station"),
    standard: camera?.standard ?? null,
    categories: VISION_CATEGORIES,
    frames: input.frames,
  });
  if (!result.ok) return { ok: false as const, error: result.error, status: result.status };
  const at = nowISO();
  const review = mutate((s) => {
    const r = {
      id: nextId(s, "VR", 900),
      cameraId: camera?.id ?? null,
      at,
      hour: s.clock.hour,
      source: "ai" as const,
      model: result.analysis.model,
      fileName: input.fileName.slice(0, 160),
      summary: result.analysis.summary,
      findings: result.analysis.findings,
      disposition: "pending-human-review" as const,
      note: input.note ?? "",
    };
    addVisionReview(s, r, `AI review (${result.analysis.model})`, at);
    return r;
  });
  return { ok: true as const, value: { review, state: getState() } };
}

/** Deterministic OpenCV checks on the Python vision service. */
export async function opencvInspect(input: { kind: "image" | "video"; file: File; reference?: File | null; camera: Camera | null; note?: string; fileName?: string }) {
  if (!visionService.configured()) {
    return { ok: false as const, error: "The vision service is not configured. Set its URL in Integrations → Vision service (or VISION_SERVICE_URL); see docs/python-services-plan.md.", status: 503 };
  }
  const out = new FormData();
  out.append(input.kind, input.file, input.file.name);
  if (input.reference) out.append("reference", input.reference, input.reference.name);
  let result: InspectionResult;
  let latencyMs: number;
  try {
    ({ data: result, latencyMs } = await inspectWithService<InspectionResult>(input.kind, out));
  } catch (e) {
    if (e instanceof VisionServiceError) {
      if (e.status >= 500) recordCheck("vision-service", false, e.message);
      return { ok: false as const, error: e.message, status: e.status };
    }
    throw e;
  }
  recordCheck("vision-service", true, `${visionService.url()} · ${result.engine} · last inspection ${latencyMs} ms`);
  const { summary, findings } = findingsFromInspection(result);
  const at = nowISO();
  const review = mutate((s) => {
    const r = {
      id: nextId(s, "VR", 900),
      cameraId: input.camera?.id ?? null,
      at,
      hour: s.clock.hour,
      source: "opencv" as const,
      model: `${result.engine} · vision service`,
      fileName: (input.fileName ?? [input.file.name, input.reference ? `vs ${input.reference.name}` : null].filter(Boolean).join(" ")).slice(0, 160),
      summary,
      findings,
      disposition: "pending-human-review" as const,
      note: input.note ?? "",
    };
    addVisionReview(s, r, "Vision service (OpenCV)", at);
    return r;
  });
  return { ok: true as const, value: { review, result, state: getState() } };
}

/** Read a footage clip's bytes from the bundled public/ folder (the path comes from the library, never the request). */
export async function readFootage(clip: FootageClip): Promise<Buffer> {
  const rel = clip.src.replace(/^\/+/, "");
  if (!/^footage\/[a-z0-9-]+\.mp4$/.test(rel)) throw new Error(`Unexpected footage path ${clip.src}`);
  for (const base of [path.join(process.cwd(), "public"), path.join(process.cwd(), ".next", "standalone", "public")]) {
    try {
      return await fs.readFile(path.join(base, rel));
    } catch {
      /* try the next location */
    }
  }
  throw new Error(`Footage file ${clip.src} is not on this server`);
}

/** "1.2,3.5,…" → [1.2, 3.5, …] (at most 9 frames), or undefined. */
export function parseFrames(v: FormDataEntryValue | null): number[] | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  const xs = v.split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n < 36000).slice(0, 9);
  return xs.length ? xs : undefined;
}
