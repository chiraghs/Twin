"use client";

import { useEffect, useMemo, useState } from "react";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";

export type BoardTone = "title" | "warn" | "bad" | "ok" | "muted" | "info";
export interface BoardLine {
  text: string;
  tone?: BoardTone;
}
/** A small trend drawn under the text: values oldest → newest, optional alarm limit. */
export interface Spark {
  label: string;
  values: number[];
  color: string;
  limit?: number;
}

/** The website's theme (globals.css), so cards and buttons in the headset look like the site. */
export const THEME = {
  canvas: "#070b14",
  surface: "#111a2e",
  surface2: "#16213a",
  surface3: "#1c2a47",
  line: "#1e2a44",
  lineStrong: "#2b3b5e",
  ink: "#e6ebf5",
  ink2: "#a9b4c8",
  muted: "#6f7d99",
  accent: "#4c8dff",
  accentInk: "#9cc0ff",
  agent: "#9085e9",
  healthy: "#10b981",
  healthyInk: "#5ee0b0",
  warning: "#f59e0b",
  warningInk: "#fbc561",
  critical: "#ef4444",
  criticalInk: "#ff8a8a",
} as const;
export const FONT = "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif";
/** Canvas pixels per design pixel: crisp text in the headset. */
const PX = 2;

const TONE: Record<BoardTone, string> = { title: THEME.ink, bad: THEME.criticalInk, warn: THEME.warningInk, ok: THEME.healthyInk, muted: THEME.ink2, info: THEME.accentInk };

const canvasTexture = (c: HTMLCanvasElement) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

/** A card like the website's: surface, hairline border, rounded corners. */
function card(g: CanvasRenderingContext2D, w: number, h: number, r = 16, border: string = THEME.lineStrong) {
  g.fillStyle = "rgba(17,26,46,0.97)";
  g.beginPath();
  g.roundRect(1, 1, w - 2, h - 2, r);
  g.fill();
  g.strokeStyle = border;
  g.lineWidth = 1.5;
  g.stroke();
}

const ellipsize = (g: CanvasRenderingContext2D, text: string, max: number) => {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
};

/**
 * A card in the scene (drawn to a canvas texture), styled like the website's cards: a header with
 * a status dot, a hairline under it, then the lines and small trend charts.
 */
export function Board({ lines, accent, position, width = 1.5, sparks = [] }: { lines: BoardLine[]; accent: string; position: [number, number, number]; width?: number; sparks?: Spark[] }) {
  const tex = useMemo(() => {
    const W = 640;
    const pad = 26;
    const headH = 58;
    const rowH = 38;
    const subH = 34;
    const sparkH = 66;
    const [head, ...rest] = lines;
    const bodyH = rest.reduce((h, l) => h + (l.tone === "title" ? subH : rowH), 0);
    const H = headH + (rest.length ? 12 + bodyH : 0) + (sparks.length ? 10 + sparks.length * sparkH : 0) + 16;
    const c = document.createElement("canvas");
    c.width = W * PX;
    c.height = H * PX;
    const g = c.getContext("2d")!;
    g.scale(PX, PX);
    card(g, W, H);
    g.textBaseline = "middle";
    // Header: status dot + title
    g.fillStyle = accent;
    g.beginPath();
    g.arc(pad + 5, headH / 2 + 2, 5.5, 0, Math.PI * 2);
    g.fill();
    if (head) {
      g.font = `600 25px ${FONT}`;
      g.fillStyle = THEME.ink;
      g.fillText(ellipsize(g, head.text, W - pad * 2 - 22), pad + 22, headH / 2 + 2);
    }
    let y = headH;
    if (rest.length) {
      g.fillStyle = THEME.line;
      g.fillRect(pad, y, W - pad * 2, 1.5);
      y += 12;
      for (const l of rest) {
        if (l.tone === "title") {
          // A sub-heading inside the card: small caps, like the site's section labels.
          g.font = `600 15px ${FONT}`;
          g.fillStyle = THEME.muted;
          g.fillText(ellipsize(g, l.text.toUpperCase(), W - pad * 2), pad, y + subH / 2 + 2);
          y += subH;
          continue;
        }
        g.font = `${l.tone === "bad" || l.tone === "warn" ? 600 : 400} 21px ${FONT}`;
        g.fillStyle = TONE[l.tone ?? "muted"];
        g.fillText(ellipsize(g, l.text, W - pad * 2), pad, y + rowH / 2);
        y += rowH;
      }
    }
    if (sparks.length) y += 10;
    sparks.forEach((sp, i) => {
      const top = y + i * sparkH;
      const x0 = pad + 150;
      const x1 = W - pad;
      const h = sparkH - 16;
      g.font = `600 14px ${FONT}`;
      g.fillStyle = THEME.muted;
      g.fillText(sp.label.toUpperCase(), pad, top + h / 2);
      g.fillStyle = THEME.surface2;
      g.beginPath();
      g.roundRect(x0, top, x1 - x0, h, 8);
      g.fill();
      const vals = sp.values.filter((v) => Number.isFinite(v));
      if (vals.length < 2) return;
      const hi = Math.max(...vals, sp.limit ?? -Infinity);
      const lo = Math.min(...vals);
      const padV = (hi - lo) * 0.12 || 1;
      const yy = (v: number) => top + h - 6 - ((v - (lo - padV)) / (hi + padV - (lo - padV))) * (h - 12);
      const xs = (k: number) => x0 + 8 + (k / (vals.length - 1)) * (x1 - x0 - 16);
      if (sp.limit !== undefined) {
        g.strokeStyle = THEME.warning;
        g.globalAlpha = 0.7;
        g.setLineDash([6, 5]);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(x0 + 8, yy(sp.limit));
        g.lineTo(x1 - 8, yy(sp.limit));
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
      // Soft area under the line, then the line, like the site's charts.
      g.beginPath();
      vals.forEach((v, k) => (k ? g.lineTo(xs(k), yy(v)) : g.moveTo(xs(k), yy(v))));
      g.lineTo(xs(vals.length - 1), top + h - 4);
      g.lineTo(xs(0), top + h - 4);
      g.closePath();
      g.globalAlpha = 0.14;
      g.fillStyle = sp.color;
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = sp.color;
      g.lineWidth = 2.5;
      g.lineJoin = "round";
      g.beginPath();
      vals.forEach((v, k) => (k ? g.lineTo(xs(k), yy(v)) : g.moveTo(xs(k), yy(v))));
      g.stroke();
      g.fillStyle = sp.color;
      g.beginPath();
      g.arc(xs(vals.length - 1), yy(vals[vals.length - 1]), 4.5, 0, Math.PI * 2);
      g.fill();
    });
    return { t: canvasTexture(c), aspect: H / W };
  }, [lines, accent, sparks]);
  useEffect(() => () => tex.t.dispose(), [tex]);
  return (
    <Billboard position={position}>
      <mesh>
        <planeGeometry args={[width, width * tex.aspect]} />
        <meshBasicMaterial map={tex.t} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </Billboard>
  );
}

/**
 * Centered text lines on a themed card (status lines, tags). `bg` and `border` override the card's
 * surface and hairline; sizes are in design pixels (drawn at 2× for sharpness).
 */
export function textTexture(lines: { text: string; color?: string; font?: string }[], w: number, h: number, bg?: string, border?: string) {
  const c = document.createElement("canvas");
  c.width = w * PX;
  c.height = h * PX;
  const g = c.getContext("2d")!;
  g.scale(PX, PX);
  const r = Math.min(16, h / 3);
  g.fillStyle = bg ?? "rgba(17,26,46,0.97)";
  g.beginPath();
  g.roundRect(1, 1, w - 2, h - 2, r);
  g.fill();
  g.strokeStyle = border ?? THEME.lineStrong;
  g.lineWidth = border ? 2.5 : 1.5;
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => {
    g.font = (l.font ?? `600 32px sans-serif`).replace(/system-ui, sans-serif|sans-serif$/, FONT);
    g.fillStyle = l.color ?? THEME.ink;
    g.fillText(ellipsize(g, l.text, w - 24), w / 2, (h * (i + 1)) / (lines.length + 1) + 1);
  });
  return canvasTexture(c);
}

/**
 * A button styled like the website's: a dark surface with a hairline border and a small colored
 * dot for its kind; hover lifts it and tints the border; active fills it with its color.
 */
export function controlTexture(label: string, color: string, { hover = false, active = false, disabled = false } = {}, w = 384, h = 128) {
  const c = document.createElement("canvas");
  c.width = w * PX;
  c.height = h * PX;
  const g = c.getContext("2d")!;
  g.scale(PX, PX);
  const r = Math.min(20, h / 3.2);
  g.beginPath();
  g.roundRect(2, 2, w - 4, h - 4, r);
  g.fillStyle = disabled ? "#0d1426" : hover ? THEME.surface3 : THEME.surface2;
  g.fill();
  if (active && !disabled) {
    g.globalAlpha = 0.28;
    g.fillStyle = color;
    g.fill();
    g.globalAlpha = 1;
  }
  g.strokeStyle = disabled ? THEME.line : active || hover ? color : THEME.lineStrong;
  g.lineWidth = active || hover ? 3 : 2;
  g.stroke();
  const size = Math.round(h * 0.27);
  g.font = `600 ${size}px ${FONT}`;
  g.textBaseline = "middle";
  const showDot = !disabled && !/^[▲▼▴▾‹›✕↻]/.test(label);
  const dot = showDot ? size * 0.32 : 0;
  const gap = showDot ? size * 0.45 : 0;
  const text = ellipsize(g, label, w - 28 - dot * 2 - gap);
  const tw = g.measureText(text).width + dot * 2 + gap;
  let x = (w - tw) / 2;
  if (showDot) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x + dot, h / 2, dot, 0, Math.PI * 2);
    g.fill();
    x += dot * 2 + gap;
  }
  g.fillStyle = disabled ? THEME.muted : active || hover ? "#ffffff" : THEME.ink;
  g.fillText(text, x, h / 2 + 1);
  return canvasTexture(c);
}

/** A 3D button: point with a hand or controller and pinch / pull the trigger (or click on screen). */
export function Button3D({ label, color, position, width = 0.62, disabled, active, onPress }: { label: string; color: string; position: [number, number, number]; width?: number; disabled?: boolean; active?: boolean; onPress: () => void }) {
  const [hover, setHover] = useState(false);
  const tex = useMemo(
    () => controlTexture(label, color, { hover: hover && !disabled, active, disabled }),
    [label, color, hover, disabled, active],
  );
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh
      position={position}
      scale={hover && !disabled ? 1.06 : 1}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onPress();
      }}
    >
      <planeGeometry args={[width, width / 3]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}
