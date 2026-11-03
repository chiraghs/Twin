import { describe, expect, it } from "vitest";
import { DomainError } from "@/domain/actions";
import { cameraView, computeQuality, inspectionFrames } from "@/domain/quality";
import { dispositionReview, findingsFromInspection, logCameraView, reviewInspectionLog, setCameraStream, type ImageInspectionResult, type VideoInspectionResult } from "@/domain/vision";
import { crisis, demo, NOW } from "./helpers";

describe("camera layout", () => {
  it("places area, inspection, thermal, dock and stores cameras", () => {
    const s = demo();
    const ids = s.cameras.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["CCTV-A1", "CCTV-B1", "CCTV-C1", "VIS-A-CAM-04", "VIS-B-CAM-04", "VIS-C-CAM-04", "THM-A1", "CCTV-DOCK", "CCTV-STORES"]));
    for (const c of s.cameras) {
      expect(c.stream.kind).toBe("simulated");
      for (const id of c.covers) expect(s.assets.some((a) => a.id === id)).toBe(true);
    }
    expect(s.cameras.find((c) => c.id === "THM-A1")!.covers).toContain("A-ROB-03");
    expect(s.cameras.filter((c) => c.kind === "area").every((c) => c.privacy.faceBlur)).toBe(true);
  });
});

describe("quality model", () => {
  it("attributes every scrapped unit to a cause", () => {
    const s = demo();
    for (const r of s.production.filter((x) => x.scrapUnits > 0)) {
      const attributed = Object.values(r.scrapByCause).reduce((a, b) => a + b, 0);
      expect(attributed).toBeCloseTo(r.scrapUnits, 6);
    }
  });

  it("reports consistent yields and a Pareto that sums to 100%", () => {
    const q = computeQuality(demo(), 24);
    expect(q.stations).toHaveLength(3);
    for (const st of q.stations) {
      expect(st.fpy).toBeCloseTo(1 - st.defects / st.inspected, 4);
      expect(st.dpmo).toBeGreaterThan(0);
    }
    expect(q.rty).toBeGreaterThan(0.9);
    expect(q.rty).toBeLessThan(1);
    expect(q.pareto[q.pareto.length - 1].cumulative).toBeCloseTo(1, 3);
  });

  it("links the degrading robot to Line A's rising reject rate", () => {
    const s = crisis();
    const q = computeQuality(s, 24);
    const a = q.stations.find((x) => x.lineId === "LINE-A")!;
    expect(a.recentRate).toBeGreaterThan(a.baselineRate * 1.4);
    const top = q.correlations[0];
    expect(top.assetId).toBe("A-ROB-03");
    expect(top.r).toBeGreaterThan(0.8);
  });

  it("gives the same inspection frames for the same state", () => {
    const s = crisis();
    const cam = s.cameras.find((c) => c.id === "VIS-A-CAM-04")!;
    expect(inspectionFrames(s, cam, 40)).toEqual(inspectionFrames(structuredClone(s), cam, 40));
    expect(inspectionFrames(s, cam, 40).filter((f) => !f.pass).every((f) => f.defect !== null)).toBe(true);
  });

  it("thermal view reads the twin's temperatures", () => {
    const s = crisis();
    const cam = s.cameras.find((c) => c.id === "THM-A1")!;
    const v = cameraView(s, cam);
    const robot = s.assets.find((a) => a.id === "A-ROB-03")!;
    expect(v.thermal.find((t) => t.assetId === "A-ROB-03")!.temperature).toBeCloseTo(robot.signal.temperature, 1);
  });
});

describe("camera access and reviews", () => {
  it("only accepts https (or localhost) gateway URLs", () => {
    const s = demo();
    expect(() => setCameraStream(s, "CCTV-A1", { kind: "hls", url: "http://10.0.0.5/live.m3u8" }, "Tester", NOW)).toThrow(DomainError);
    expect(() => setCameraStream(s, "CCTV-A1", { kind: "hls", url: null }, "Tester", NOW)).toThrow(DomainError);
    setCameraStream(s, "CCTV-A1", { kind: "hls", url: "https://gw.example.com/a1/index.m3u8" }, "Tester", NOW);
    expect(s.cameras.find((c) => c.id === "CCTV-A1")!.stream).toEqual({ kind: "hls", url: "https://gw.example.com/a1/index.m3u8" });
    setCameraStream(s, "CCTV-A1", { kind: "simulated", url: "ignored" }, "Tester", NOW);
    expect(s.cameras.find((c) => c.id === "CCTV-A1")!.stream).toEqual({ kind: "simulated", url: null });
  });

  it("logs every live view in the audit trail", () => {
    const s = demo();
    const before = s.audit.length;
    logCameraView(s, "CCTV-DOCK", "Shift Lead", NOW);
    expect(s.audit.length).toBe(before + 1);
    expect(s.audit.some((e) => e.title === "Live view opened: CCTV-DOCK" && e.actor === "Shift Lead")).toBe(true);
  });

  it("creates a deterministic inspection-log review that needs human disposition", () => {
    const s = crisis();
    const r = reviewInspectionLog(s, "VIS-A-CAM-04", NOW);
    expect(r.source).toBe("simulated-inspection-log");
    expect(r.disposition).toBe("pending-human-review");
    expect(r.findings.every((f) => f.confidence === 1)).toBe(true);
    expect(reviewInspectionLog(structuredClone(crisis()), "VIS-A-CAM-04", NOW).findings).toEqual(r.findings);
    expect(() => reviewInspectionLog(s, "CCTV-A1", NOW)).toThrow(DomainError);

    dispositionReview(s, r.id, "confirmed", "Checked at rework", "QA Lead", NOW);
    expect(s.visionReviews[0].disposition).toBe("confirmed");
    expect(() => dispositionReview(s, r.id, "dismissed", "", "QA Lead", NOW)).toThrow(DomainError);
  });
});

describe("vision service results → review findings", () => {
  const image: ImageInspectionResult = {
    kind: "image",
    width: 1200,
    height: 800,
    quality: { sharpness: 180, brightness: 90, contrast: 40, usable: true, issues: [] },
    codes: [{ format: "EAN_13", data: "4006381333931", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, symbolContrast: 27, contrastGrade: "D" }],
    comparison: {
      alignment: "homography",
      alignmentNote: "",
      inliers: 420,
      threshold: 40,
      minAreaPct: 0.05,
      changedPct: 1.2,
      defects: [{ box: { x: 0.7, y: 0.6, w: 0.08, h: 0.13 }, areaPct: 1.0, meanDiff: 51 }],
      truncated: false,
    },
    engine: "OpenCV 4.14.0",
    durationMs: 200,
  };

  it("maps deviations and codes to measured findings with boxes", () => {
    const { summary, findings } = findingsFromInspection(image);
    expect(summary).toContain("1 region differs from the golden reference");
    const dev = findings.find((f) => f.category === "Deviation from golden reference")!;
    expect(dev.severity).toBe("major");
    expect(dev.confidence).toBe(1);
    expect(dev.box).toEqual(image.comparison!.defects[0].box);
    expect(findings.find((f) => f.category === "Barcode grade below C")!.description).toContain("Indicative only");
  });

  it("flags unusable images and still periods in video", () => {
    const blurry = findingsFromInspection({ ...image, quality: { ...image.quality, usable: false, issues: ["blurry"] }, comparison: null, codes: [] });
    expect(blurry.findings[0].category).toBe("Image not usable for inspection");
    const video: VideoInspectionResult = {
      kind: "video",
      fps: 10,
      durationSec: 10,
      analysedSec: 10,
      truncated: false,
      sampleFps: 2,
      framesAnalysed: 20,
      motionThresholdPct: 1,
      movingPct: 60,
      segments: [],
      stillPeriods: [{ startSec: 4, endSec: 8, durationSec: 4 }],
      quality: { blurryFrames: 0, underexposedFrames: 0, overexposedFrames: 0 },
      codes: [],
      series: [],
      engine: "OpenCV 4.14.0",
      durationMs: 300,
    };
    const v = findingsFromInspection(video);
    expect(v.findings).toHaveLength(1);
    expect(v.findings[0]).toMatchObject({ category: "Line motion stopped", timestampSec: 4, severity: "minor" });
  });
});
