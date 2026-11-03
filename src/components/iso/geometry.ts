/** Isometric projection helpers (2:1 dimetric, 30°). World: x/y on the floor, z up. */
import type { AssetKind } from "@/domain/types";
import { FOOTPRINT, type Dir } from "./model";

export const COS30 = Math.cos(Math.PI / 6);
export const UNIT = 30; // px per world unit before zoom

export type V3 = [number, number, number];

export function project([x, y, z]: V3, s = UNIT): [number, number] {
  return [(x - y) * COS30 * s, (x + y) * 0.5 * s - z * s];
}

/** Rotate a floor point by k quarter turns around (cx, cy). */
export function rotatePoint(x: number, y: number, k: number, cx: number, cy: number): [number, number] {
  let dx = x - cx;
  let dy = y - cy;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) {
    const t = dx;
    dx = -dy;
    dy = t;
  }
  return [cx + dx, cy + dy];
}

export interface Box {
  cx: number;
  cy: number;
  ex: number; // half-extent along world x
  ey: number; // half-extent along world y
  z0: number;
  h: number;
}

export const pts = (p: [number, number][]) => p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");

/** The three visible faces of an axis-aligned box (top, +x side, +y side). */
export function boxFaces(b: Box) {
  const x0 = b.cx - b.ex;
  const x1 = b.cx + b.ex;
  const y0 = b.cy - b.ey;
  const y1 = b.cy + b.ey;
  const z0 = b.z0;
  const z1 = b.z0 + b.h;
  return {
    top: pts([project([x0, y0, z1]), project([x1, y0, z1]), project([x1, y1, z1]), project([x0, y1, z1])]),
    right: pts([project([x1, y0, z0]), project([x1, y1, z0]), project([x1, y1, z1]), project([x1, y0, z1])]),
    left: pts([project([x0, y1, z0]), project([x1, y1, z0]), project([x1, y1, z1]), project([x0, y1, z1])]),
  };
}

export function floorQuad(x0: number, y0: number, x1: number, y1: number, z = 0) {
  return pts([project([x0, y0, z]), project([x1, y0, z]), project([x1, y1, z]), project([x0, y1, z])]);
}

/* ───────────────────────────── Machine parts ───────────────────────────── */

export type Tone = "body" | "trim" | "dark" | "belt" | "accent" | "carton" | "white" | "glass";

export type Part =
  | { t: "box"; u: number; v: number; z0: number; L: number; W: number; H: number; tone: Tone }
  | { t: "arm"; points: V3[] } // local (u, v, z)
  | { t: "lamp"; u: number; v: number; z: number }; // stack light top

/** Local part geometry per machine kind. u = along flow, v = across flow. */
export function machineParts(kind: AssetKind): { parts: Part[]; height: number } {
  const f = FOOTPRINT[kind];
  switch (kind) {
    case "conveyor":
      return {
        height: 0.5,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.3, tone: "body" },
          { t: "box", u: 0, v: 0, z0: 0.3, L: f.L - 0.1, W: f.W - 0.22, H: 0.06, tone: "belt" },
          { t: "box", u: -f.L / 2 + 0.1, v: f.W / 2 - 0.06, z0: 0.3, L: 0.16, W: 0.12, H: 0.12, tone: "accent" },
        ],
      };
    case "press":
      return {
        height: 1.6,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.45, tone: "body" },
          { t: "box", u: 0, v: -0.34, z0: 0.45, L: 0.52, W: 0.4, H: 1.05, tone: "body" },
          { t: "box", u: 0, v: 0.05, z0: 0.92, L: 0.22, W: 0.22, H: 0.32, tone: "trim" },
          { t: "box", u: 0, v: -0.05, z0: 1.24, L: 0.72, W: 0.78, H: 0.3, tone: "body" },
          { t: "box", u: 0, v: 0.12, z0: 0.45, L: 0.6, W: 0.5, H: 0.05, tone: "accent" },
        ],
      };
    case "robot":
      return {
        height: 1.55,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.22, tone: "trim" },
          { t: "box", u: 0, v: 0, z0: 0.22, L: 0.52, W: 0.52, H: 0.34, tone: "body" },
          { t: "box", u: 0.62, v: 0.0, z0: 0, L: 0.5, W: 0.6, H: 0.38, tone: "carton" },
          {
            t: "arm",
            points: [
              [0, 0, 0.56],
              [-0.12, 0, 1.42],
              [0.5, 0, 1.3],
              [0.66, 0, 0.98],
            ],
          },
        ],
      };
    case "camera":
      return {
        height: 1.0,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.52, tone: "body" },
          { t: "box", u: 0, v: 0, z0: 0.52, L: 0.9, W: 0.55, H: 0.05, tone: "glass" },
          { t: "box", u: -0.1, v: -0.25, z0: 0.57, L: 0.5, W: 0.32, H: 0.28, tone: "trim" },
          { t: "box", u: 0.2, v: -0.25, z0: 0.62, L: 0.12, W: 0.12, H: 0.1, tone: "accent" },
        ],
      };
    case "packager":
      return {
        height: 1.45,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 1.0, tone: "body" },
          { t: "box", u: 0, v: 0.05, z0: 1.0, L: 1.1, W: 0.85, H: 0.04, tone: "dark" },
          { t: "box", u: 0.25, v: 0.95, z0: 0, L: 0.5, W: 0.5, H: 0.36, tone: "carton" },
          { t: "box", u: 0.25, v: 0.95, z0: 0.36, L: 0.42, W: 0.42, H: 0.3, tone: "carton" },
          { t: "box", u: -0.55, v: -0.45, z0: 1.0, L: 0.4, W: 0.3, H: 0.18, tone: "accent" },
        ],
      };
    case "labeler":
      return {
        height: 1.2,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.68, tone: "body" },
          { t: "box", u: 0.1, v: -0.2, z0: 0.68, L: 0.34, W: 0.34, H: 0.32, tone: "white" },
          { t: "box", u: -0.3, v: 0.2, z0: 0.68, L: 0.3, W: 0.4, H: 0.12, tone: "accent" },
        ],
      };
    case "cnc":
      return {
        height: 1.5,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 1.2, tone: "body" },
          { t: "box", u: 0.05, v: 0.2, z0: 0.35, L: 0.9, W: f.W - 0.35, H: 0.6, tone: "glass" },
          { t: "box", u: -0.55, v: f.W / 2 - 0.12, z0: 0.6, L: 0.3, W: 0.12, H: 0.45, tone: "dark" },
          { t: "box", u: 0, v: 0, z0: 1.2, L: f.L - 0.2, W: f.W - 0.2, H: 0.06, tone: "trim" },
        ],
      };
    case "mixer":
      return {
        height: 1.75,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.35, tone: "trim" },
          { t: "box", u: 0, v: 0, z0: 0.35, L: 0.9, W: 0.9, H: 0.75, tone: "white" },
          { t: "box", u: 0, v: -0.42, z0: 0.35, L: 0.3, W: 0.2, H: 1.25, tone: "body" },
          { t: "box", u: 0, v: -0.12, z0: 1.38, L: 0.5, W: 0.8, H: 0.22, tone: "body" },
          { t: "box", u: 0, v: 0.05, z0: 1.15, L: 0.1, W: 0.1, H: 0.23, tone: "dark" },
        ],
      };
    case "oven":
      return {
        height: 1.55,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.25, tone: "trim" },
          { t: "box", u: 0, v: 0, z0: 0.25, L: f.L - 0.2, W: f.W, H: 0.75, tone: "body" },
          { t: "box", u: 0, v: f.W / 2 - 0.04, z0: 0.45, L: f.L - 0.6, W: 0.06, H: 0.12, tone: "accent" },
          { t: "box", u: 0.7, v: -0.25, z0: 1.0, L: 0.28, W: 0.28, H: 0.45, tone: "dark" },
          { t: "box", u: -0.7, v: -0.25, z0: 1.0, L: 0.28, W: 0.28, H: 0.3, tone: "dark" },
        ],
      };
    case "filler":
      return {
        height: 1.5,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.55, tone: "body" },
          { t: "box", u: 0, v: 0, z0: 0.55, L: 1.1, W: 1.1, H: 0.12, tone: "trim" },
          { t: "box", u: 0, v: 0, z0: 0.67, L: 0.85, W: 0.85, H: 0.35, tone: "glass" },
          { t: "box", u: 0, v: 0, z0: 1.02, L: 0.55, W: 0.55, H: 0.3, tone: "white" },
          { t: "box", u: 0.55, v: 0.55, z0: 0.55, L: 0.16, W: 0.16, H: 0.22, tone: "accent" },
        ],
      };
    case "molder":
      return {
        height: 1.4,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.6, tone: "body" },
          { t: "box", u: -0.45, v: 0, z0: 0.6, L: 1.1, W: 0.55, H: 0.35, tone: "trim" },
          { t: "box", u: 0.55, v: 0, z0: 0.6, L: 0.7, W: 0.75, H: 0.45, tone: "glass" },
          { t: "box", u: -0.75, v: 0, z0: 0.95, L: 0.3, W: 0.3, H: 0.4, tone: "white" },
          { t: "box", u: 0.95, v: 0.35, z0: 0.6, L: 0.2, W: 0.12, H: 0.25, tone: "accent" },
        ],
      };
    case "welder":
      return {
        height: 1.6,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.2, tone: "trim" },
          { t: "box", u: 0, v: -f.W / 2 + 0.04, z0: 0.2, L: f.L, W: 0.06, H: 1.05, tone: "glass" },
          { t: "box", u: -f.L / 2 + 0.04, v: 0, z0: 0.2, L: 0.06, W: f.W, H: 1.05, tone: "glass" },
          { t: "box", u: 0.25, v: 0.2, z0: 0.2, L: 0.6, W: 0.5, H: 0.3, tone: "dark" },
          { t: "box", u: -0.3, v: 0.1, z0: 0.2, L: 0.4, W: 0.4, H: 0.3, tone: "body" },
          {
            t: "arm",
            points: [
              [-0.3, 0.1, 0.5],
              [-0.4, 0.1, 1.25],
              [0.15, 0.15, 1.15],
              [0.28, 0.2, 0.72],
            ],
          },
        ],
      };
    case "palletizer":
      return {
        height: 1.85,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.12, tone: "carton" },
          { t: "box", u: 0, v: 0, z0: 0.12, L: 1.1, W: 1.1, H: 0.3, tone: "carton" },
          { t: "box", u: 0, v: 0, z0: 0.42, L: 1.1, W: 1.1, H: 0.3, tone: "carton" },
          { t: "box", u: -f.L / 2 + 0.06, v: -f.W / 2 + 0.06, z0: 0.12, L: 0.1, W: 0.1, H: 1.6, tone: "trim" },
          { t: "box", u: f.L / 2 - 0.06, v: -f.W / 2 + 0.06, z0: 0.12, L: 0.1, W: 0.1, H: 1.6, tone: "trim" },
          { t: "box", u: 0, v: -f.W / 2 + 0.06, z0: 1.62, L: f.L, W: 0.12, H: 0.12, tone: "trim" },
          { t: "box", u: 0.1, v: -0.2, z0: 1.2, L: 0.35, W: 0.35, H: 0.42, tone: "accent" },
        ],
      };
    case "pump":
      return {
        height: 0.85,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.12, tone: "trim" },
          { t: "box", u: -0.15, v: 0, z0: 0.12, L: 0.45, W: 0.38, H: 0.38, tone: "body" },
          { t: "box", u: 0.28, v: 0, z0: 0.12, L: 0.26, W: 0.46, H: 0.46, tone: "accent" },
          { t: "box", u: 0.28, v: 0, z0: 0.58, L: 0.1, W: 0.1, H: 0.18, tone: "dark" },
        ],
      };
    case "workstation":
      return {
        height: 1.45,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0.68, L: f.L, W: f.W, H: 0.07, tone: "white" },
          { t: "box", u: -f.L / 2 + 0.06, v: 0, z0: 0, L: 0.08, W: f.W - 0.1, H: 0.68, tone: "trim" },
          { t: "box", u: f.L / 2 - 0.06, v: 0, z0: 0, L: 0.08, W: f.W - 0.1, H: 0.68, tone: "trim" },
          { t: "box", u: 0, v: -f.W / 2 + 0.05, z0: 0.75, L: f.L, W: 0.06, H: 0.55, tone: "trim" },
          { t: "box", u: -0.2, v: -0.2, z0: 1.05, L: 0.7, W: 0.22, H: 0.05, tone: "body" },
          { t: "box", u: 0.25, v: 0.05, z0: 0.75, L: 0.3, W: 0.22, H: 0.14, tone: "carton" },
          { t: "box", u: -0.3, v: 0.1, z0: 0.75, L: 0.1, W: 0.1, H: 0.25, tone: "accent" },
        ],
      };
    case "extruder":
      return {
        height: 1.35,
        parts: [
          { t: "box", u: 0, v: 0, z0: 0, L: f.L, W: f.W, H: 0.4, tone: "body" },
          { t: "box", u: 0.2, v: 0, z0: 0.4, L: 1.7, W: 0.3, H: 0.28, tone: "trim" },
          { t: "box", u: -0.9, v: 0, z0: 0.4, L: 0.5, W: 0.6, H: 0.45, tone: "body" },
          { t: "box", u: -0.45, v: 0, z0: 0.68, L: 0.32, W: 0.32, H: 0.55, tone: "white" },
          { t: "box", u: 1.12, v: 0, z0: 0.42, L: 0.12, W: 0.36, H: 0.24, tone: "accent" },
        ],
      };
  }
}

/** Convert a local (u, v) offset of a machine to world (x, y). */
export function localToWorld(x: number, y: number, dir: Dir, u: number, v: number): [number, number] {
  return dir === "x" ? [x + u, y + v] : [x - v, y + u];
}

export function localExtents(dir: Dir, L: number, W: number): [number, number] {
  return dir === "x" ? [L / 2, W / 2] : [W / 2, L / 2];
}
