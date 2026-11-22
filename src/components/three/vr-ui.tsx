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

const TONE: Record<BoardTone, string> = { title: "#e5e7eb", bad: "#f87171", warn: "#fbbf24", ok: "#4ade80", muted: "#94a3b8", info: "#93c5fd" };

/** A text board in the scene (drawn to a canvas texture), so it is visible inside the headset. */
export function Board({ lines, accent, position, width = 1.5, sparks = [] }: { lines: BoardLine[]; accent: string; position: [number, number, number]; width?: number; sparks?: Spark[] }) {
  const tex = useMemo(() => {
    const W = 640;
    const rowH = 42;
    const sparkH = 74;
    const H = 26 + lines.length * rowH + sparks.length * sparkH + (sparks.length ? 8 : 0);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(10,14,24,0.92)";
    g.beginPath();
    g.roundRect(0, 0, W, H, 22);
    g.fill();
    g.fillStyle = accent;
    g.fillRect(0, 0, 10, H);
    lines.forEach((l, i) => {
      g.font = l.tone === "title" ? "600 30px system-ui, sans-serif" : "25px system-ui, sans-serif";
      g.fillStyle = TONE[l.tone ?? "title"];
      const text = l.text.length > 46 ? `${l.text.slice(0, 45)}…` : l.text;
      g.fillText(text, 28, 42 + i * rowH);
    });
    sparks.forEach((sp, i) => {
      const top = 22 + lines.length * rowH + i * sparkH;
      const x0 = 200;
      const x1 = W - 26;
      const h = sparkH - 22;
      g.font = "21px system-ui, sans-serif";
      g.fillStyle = "#94a3b8";
      g.fillText(sp.label, 28, top + h / 2 + 8);
      const vals = sp.values.filter((v) => Number.isFinite(v));
      if (vals.length < 2) return;
      const hi = Math.max(...vals, sp.limit ?? -Infinity);
      const lo = Math.min(...vals);
      const pad = (hi - lo) * 0.1 || 1;
      const y = (v: number) => top + h - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * h;
      g.fillStyle = "rgba(148,163,184,0.08)";
      g.fillRect(x0, top, x1 - x0, h);
      if (sp.limit !== undefined) {
        g.strokeStyle = "#fbbf24";
        g.setLineDash([8, 6]);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x0, y(sp.limit));
        g.lineTo(x1, y(sp.limit));
        g.stroke();
        g.setLineDash([]);
      }
      g.strokeStyle = sp.color;
      g.lineWidth = 3.5;
      g.beginPath();
      vals.forEach((v, k) => {
        const x = x0 + (k / (vals.length - 1)) * (x1 - x0);
        if (k) g.lineTo(x, y(v));
        else g.moveTo(x, y(v));
      });
      g.stroke();
      g.fillStyle = sp.color;
      g.beginPath();
      g.arc(x1, y(vals[vals.length - 1]), 6, 0, Math.PI * 2);
      g.fill();
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return { t, aspect: H / W };
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

/** Draws text lines to a canvas texture (shared by boards and buttons). */
export function textTexture(lines: { text: string; color?: string; font?: string }[], w: number, h: number, bg: string, border?: string) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 0, w, h, Math.min(24, h / 3));
  g.fill();
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 6;
    g.stroke();
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  lines.forEach((l, i) => {
    g.font = l.font ?? "600 34px system-ui, sans-serif";
    g.fillStyle = l.color ?? "#e5e7eb";
    g.fillText(l.text, w / 2, (h * (i + 1)) / (lines.length + 1));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A 3D button: point with a hand or controller and pinch / pull the trigger (or click on screen). */
export function Button3D({ label, color, position, width = 0.62, disabled, active, onPress }: { label: string; color: string; position: [number, number, number]; width?: number; disabled?: boolean; active?: boolean; onPress: () => void }) {
  const [hover, setHover] = useState(false);
  const tex = useMemo(
    () => textTexture([{ text: label, color: disabled ? "#64748b" : "#f8fafc" }], 384, 128, disabled ? "rgba(30,41,59,0.9)" : hover || active ? color : "rgba(15,23,42,0.95)", disabled ? undefined : color),
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
