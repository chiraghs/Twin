import { DomainError } from "@/domain/errors";
import { getClip } from "@/domain/footage";
import { getCamera } from "@/domain/vision";
import { json, route } from "@/server/http";
import { CameraAnalyzeSchema } from "@/server/schemas";
import { getState } from "@/server/store";
import { aiReview, opencvInspect, parseFrames, readFootage } from "@/server/vision/reviews";
import { ensureFreshSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Run visual QA on what a camera is currently showing. JSON `{engine}`, or multipart with
 * `engine`, `sheet` (a contact sheet of frames captured in the browser, for AI providers that
 * can't watch video) and `frames` (their times in seconds). Works on reference footage (the clip is
 * on this server); gateway streams are analysed at the edge, not here. The review records that
 * the video is reference footage from another facility.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  let sheet: File | null = null;
  let frames: number[] | undefined;
  let body: unknown;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const s = form.get("sheet");
    sheet = s instanceof File && s.size > 0 ? s : null;
    frames = parseFrames(form.get("frames"));
    body = { engine: form.get("engine") };
    if (sheet && (!/^image\/(jpeg|png|webp)$/.test(sheet.type) || sheet.size > 8 * 1024 * 1024)) throw new DomainError("The frame sheet must be a JPEG, PNG or WebP image under 8 MB", 415);
  } else body = JSON.parse((await req.text()) || "{}");
  const { engine } = CameraAnalyzeSchema.parse(body);
  await ensureFreshSettings();
  const camera = getCamera(getState(), id);
  if (camera.stream.kind !== "footage" || !camera.stream.clipId) {
    throw new DomainError(
      camera.stream.kind === "simulated"
        ? "This camera shows the twin-rendered feed. Switch it to reference footage in the control room to run visual QA on real video."
        : "Gateway streams are analysed by the edge worker on the plant network (see docs/python-services-plan.md, Phase 3), not by this server.",
      409,
    );
  }
  const clip = getClip(camera.stream.clipId);
  if (!clip) throw new DomainError(`Footage clip ${camera.stream.clipId} not found`, 404);
  const fileName = `${clip.id}.mp4 (reference footage)${sheet ? `, ${frames?.length ?? "several"} frames` : ""}`;
  const note = `Reference footage "${clip.title}" by ${clip.source.author} (${clip.source.site}, ${clip.source.license}). Real video from another facility, not this plant.`;
  const out =
    engine !== "opencv"
      ? await aiReview({
          bytes: sheet ? Buffer.from(await sheet.arrayBuffer()) : await readFootage(clip),
          mime: sheet ? sheet.type : "video/mp4",
          fileName,
          camera,
          note,
          frames: sheet ? frames : undefined,
          context: `The clip is reference footage of a comparable facility (${clip.shows}). Describe only what is visible in it`,
        })
      : await opencvInspect({ kind: "video", file: new File([new Uint8Array(await readFootage(clip))], `${clip.id}.mp4`, { type: "video/mp4" }), camera, note, fileName });
  if (!out.ok) return json({ error: out.error }, out.status);
  return json(out.value, 201);
});
