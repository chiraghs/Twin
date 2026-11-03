"use client";

import { useEffect, useState } from "react";

const VARS = ["floor", "floor-edge", "grid", "bay", "top", "trim-top", "dark", "belt", "arm", "label-bg", "label-border", "label-ink", "label-muted"] as const;
export type Palette = Record<(typeof VARS)[number], string> & {
  accent: string;
  theme: "dark" | "light";
  /** Resolve a colour that may be a CSS variable reference such as var(--color-series-1). */
  resolve: (c: string) => string;
};

function read(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string, fallback: string) => cs.getPropertyValue(n).trim() || fallback;
  const p = Object.fromEntries(VARS.map((v) => [v, get(`--iso-${v}`, "#888")])) as unknown as Palette;
  p.accent = get("--color-accent", "#4c8dff");
  p.theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const cache = new Map<string, string>();
  p.resolve = (c: string) => {
    const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
    if (!m) return c;
    if (!cache.has(m[1])) cache.set(m[1], get(m[1], "#4c8dff"));
    return cache.get(m[1])!;
  };
  return p;
}

/** The isometric view's colour tokens (they change with the theme), resolved for three.js materials. */
export function usePalette(): Palette | null {
  const [p, setP] = useState<Palette | null>(null);
  useEffect(() => {
    setP(read());
    const obs = new MutationObserver(() => setP(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return p;
}
