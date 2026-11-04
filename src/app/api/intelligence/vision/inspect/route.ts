import { DomainError } from "@/domain/errors";
import { nextId } from "@/domain/ids";
import { primaryProductOf } from "@/domain/simulation";
import type { VisionFinding, VisionReview } from "@/domain/types";
import { addVisionReview, getCamera } from "@/domain/vision";
import { json, nowISO, route } from "@/server/http";
import { backendFetch, featureEnabled } from "@/server/intelligence";
import { ensureFreshSettings } from "@/server/settings";
import { getState, mutate } from "@/server/store";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp"]);

interface AoiResult {
  inspection_id: string;
  verdict: "PASS" | "FAIL" | "REVIEW_REQUIRED" | string;
  detector: string;
  similarity_score_to_golden: number;
  defects: { defect_class: string; confidence: number; severity: string; ipc_clause: string | null; source: string }[];
  advisory: { summary: string; probable_root_cause: string; recommended_containment: string; generated_by: string } | null;
}

const SEVERITY: Record<string, VisionFinding["severity"]> = { CRITICAL: "critical", HIGH: "major", MEDIUM: "minor", LOW: "info" };

/**
 * AOI inspection of a product image from one of this plant's inspection cameras, on the
 * intelligence backend (Muse Spark + SAM 3.1, OpenCV, IPC-A-610 verdict rules). The result is
 * stored as a visual review that waits for a person to confirm or dismiss it.
 */
export const POST = route(async (req: Request) => {
  await ensureFreshSettings();
  if (!featureEnabled("vision")) throw new DomainError("AOI vision inspection is off. An admin can turn it on in Admin → Features.", 409);
  const form = await req.formData().catch(() => {
    throw new DomainError("Expected multipart form data with a 'file' field");
  });
  const file = form.get("file");
  const cameraId = String(form.get("cameraId") ?? "");
  if (!(file instanceof File) || file.size === 0) throw new DomainError("Missing 'file'");
  if (!IMAGE_TYPES.has(file.type)) return json({ error: `Unsupported file type ${file.type || "unknown"}. Use JPEG, PNG, WebP or BMP.` }, 415);
  if (file.size > 15 * 1024 * 1024) return json({ error: "Image is larger than 15 MB." }, 413);

  const state = getState();
  const camera = getCamera(state, cameraId);
  if (camera.kind !== "inspection") throw new DomainError(`${camera.id} is not an inspection camera`);
  const lineId = camera.lineId;
  const productId = String(form.get("productId") ?? "") || (lineId ? primaryProductOf(state, lineId) : null) || state.products[0]?.id || "PART";

  const out = new FormData();
  out.append("image", file, file.name || "inspection.png");
  out.append("camera_id", camera.id);
  if (lineId) out.append("line_id", lineId);
  out.append("product_id", productId);
  out.append("sim_hour", String(state.clock.hour));
  const result = await backendFetch<AoiResult>(`twin/${encodeURIComponent(state.profile.id)}/inspect`, { method: "POST", body: out, signal: AbortSignal.timeout(85_000) });

  const findings: VisionFinding[] = result.defects.map((d) => ({
    timestampSec: null,
    category: d.defect_class.replace(/_/g, " ").toLowerCase(),
    description: [d.ipc_clause, d.source === "MUSE_SPARK_SAM" ? "Muse Spark + SAM 3.1" : "reference detector"].filter(Boolean).join(" · "),
    severity: SEVERITY[d.severity] ?? "major",
    confidence: d.confidence,
  }));
  const at = nowISO();
  const verdict = result.verdict === "REVIEW_REQUIRED" ? "review required" : result.verdict.toLowerCase();
  const review = mutate((s) => {
    const r: VisionReview = {
      id: nextId(s, "VR", 900),
      cameraId: camera.id,
      at,
      hour: s.clock.hour,
      source: "aoi",
      model: `AOI · ${result.detector}`,
      fileName: (file.name || "inspection image").slice(0, 160),
      summary: `AOI verdict: ${verdict} (${findings.length} defect${findings.length === 1 ? "" : "s"}, ${Math.round(result.similarity_score_to_golden * 100)}% similar to the golden board). ${result.advisory?.summary ?? ""}`.trim().slice(0, 600),
      findings,
      disposition: "pending-human-review",
      note: result.advisory ? `Probable cause: ${result.advisory.probable_root_cause}. Containment: ${result.advisory.recommended_containment}`.slice(0, 500) : "",
      externalId: result.inspection_id,
    };
    addVisionReview(s, r, "AOI vision inspection (intelligence backend)", at);
    return r;
  });
  return json({ review, result, state: getState() }, 201);
});
