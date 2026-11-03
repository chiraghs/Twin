import { describe, expect, it } from "vitest";
import { dedupe, iou, mergeSegmentation, type Footprint } from "@/domain/builder/segmentation";
import { parseSamBoxes, toGrid } from "@/server/ai/meta-media";
import type { BlueprintReading } from "@/domain/builder/draft";

const reading = (): BlueprintReading => ({
  legible: true,
  drawingKind: "floor plan",
  summary: "Two machines on a line.",
  siteName: null,
  industry: null,
  elements: [
    { id: "e1", label: "CNC-01", role: "machine", archetype: "cnc", lineHint: "L1", box: [100, 100, 300, 300], confidence: 0.9 },
    { id: "e2", label: "Oven", role: "machine", archetype: "oven", lineHint: "L1", box: [100, 600, 300, 800], confidence: 0.8 },
    { id: "e3", label: "Office", role: "office", archetype: null, lineHint: null, box: [700, 700, 900, 900], confidence: 0.9 },
  ],
  flows: [{ from: "e1", to: "e2" }],
  notes: [],
});

describe("SAM 3.1 output", () => {
  it("parses box tokens (with and without confidence) and maps them to the 0–1000 grid", () => {
    const text = "<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=1000;h=500|><|mask;x=0;y=0;data=46,101,~abc|>1<|box;x1=0;y1=0;x2=500;y2=250;w=1000;h=500;c=0.91|><|mask;x=0;y=0;data=1,1,~a|>";
    const boxes = parseSamBoxes(text);
    expect(boxes).toHaveLength(2);
    expect(boxes[1].confidence).toBe(0.91);
    expect(toGrid(boxes[0])).toEqual([764, 353, 854, 453]);
    expect(parseSamBoxes("")).toEqual([]);
  });
});

describe("blueprint segmentation merge", () => {
  it("gives recognised machines SAM footprints and keeps unlabelled ones for review", () => {
    const prints: Footprint[] = [
      { concept: "machine", box: [90, 110, 310, 290] }, // CNC, slightly different
      { concept: "machine", box: [120, 620, 280, 790] }, // oven
      { concept: "conveyor", box: [92, 108, 312, 292] }, // duplicate of the CNC footprint
      { concept: "machine", box: [500, 100, 600, 200] }, // equipment the reading missed
    ];
    const merged = mergeSegmentation(reading(), prints, "sam-3.1", ["machine", "conveyor"]);
    expect(merged.elements[0]).toMatchObject({ id: "e1", segmented: true });
    expect(merged.elements[1]).toMatchObject({ id: "e2", segmented: true, box: [120, 620, 280, 790] });
    expect(merged.elements[2].segmented).toBeUndefined(); // offices are never re-boxed
    expect(merged.segmentation!.footprints).toHaveLength(3); // duplicate dropped
    expect(merged.segmentation!.footprints.filter((f) => !f.matched)).toHaveLength(1);
    expect(merged.notes.at(-1)).toMatch(/3 equipment footprint\(s\); 2 matched/);
  });

  it("dedupes overlapping footprints and computes IoU", () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
    expect(iou([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
    expect(dedupe([{ concept: "a", box: [0, 0, 10, 10] }, { concept: "b", box: [0, 0, 10, 9] }])).toHaveLength(1);
  });
});
