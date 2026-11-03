/**
 * Merge SAM 3.1 footprints into a blueprint reading. Muse Spark names the equipment and the flow;
 * SAM 3.1 gives each piece of equipment a pixel-accurate footprint. Each machine or conveyor the
 * model recognised takes the footprint that overlaps it best (or contains its centre); footprints
 * no element claimed are kept so the review can show equipment the reading may have missed.
 */
import type { BlueprintReading } from "./draft";

export type GridBox = [number, number, number, number]; // [ymin, xmin, ymax, xmax], 0–1000
export interface Footprint {
  concept: string;
  box: GridBox;
}

const area = (b: GridBox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
export function iou(a: GridBox, b: GridBox) {
  const inter = area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}
const contains = (b: GridBox, y: number, x: number) => y >= b[0] && y <= b[2] && x >= b[1] && x <= b[3];

/** Drop near-duplicate footprints (the same object found by two concepts). */
export function dedupe(footprints: Footprint[], threshold = 0.6): Footprint[] {
  const out: Footprint[] = [];
  for (const f of [...footprints].sort((a, b) => area(b.box) - area(a.box))) if (out.every((o) => iou(o.box, f.box) < threshold)) out.push(f);
  return out;
}

export function mergeSegmentation(reading: BlueprintReading, footprints: Footprint[], model: string, concepts: string[]): BlueprintReading {
  const prints = dedupe(footprints).slice(0, 120);
  const claimed = new Map<number, string>();
  const elements = reading.elements.map((e) => {
    if ((e.role !== "machine" && e.role !== "conveyor") || !e.box || e.box.length !== 4) return e;
    const box = e.box as GridBox;
    const cy = (box[0] + box[2]) / 2;
    const cx = (box[1] + box[3]) / 2;
    let best = -1;
    let bestScore = 0;
    prints.forEach((f, i) => {
      if (claimed.has(i)) return;
      const score = iou(box, f.box) + (contains(f.box, cy, cx) ? 0.25 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0 || bestScore < 0.2) return e;
    claimed.set(best, e.id);
    return { ...e, box: [...prints[best].box], segmented: true };
  });
  const matched = claimed.size;
  const unmatched = prints.length - matched;
  const note = `${model} segmented ${prints.length} equipment footprint(s); ${matched} matched recognised element(s)${unmatched ? `, ${unmatched} unlabelled footprint(s) may be equipment the reading missed` : ""}.`;
  return {
    ...reading,
    elements,
    notes: [...reading.notes, note].slice(-10),
    segmentation: { model, concepts, footprints: prints.map((f, i) => ({ concept: f.concept, box: f.box, matched: claimed.get(i) ?? null })) },
  };
}
