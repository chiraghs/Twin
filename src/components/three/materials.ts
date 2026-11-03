"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Palette } from "./palette";

export type Quality = "high" | "standard";

/** Physically based materials shared across the scene (one instance per look, so hundreds of meshes stay cheap). */
export interface Materials {
  get: (name: MaterialName, dim?: boolean) => THREE.Material;
  /** A painted accent in a line's colour (cached per colour). */
  paint: (color: string, dim?: boolean) => THREE.Material;
  floor: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
}

export type MaterialName =
  | "enclosure"
  | "enclosureDark"
  | "steel"
  | "darkPlastic"
  | "rubber"
  | "glass"
  | "carton"
  | "white"
  | "robot"
  | "joint"
  | "safetyYellow"
  | "rackUpright"
  | "rackBeam"
  | "pallet"
  | "bezel"
  | "screen"
  | "tyre"
  | "fenceMesh"
  | "column"
  | "windowBand"
  | "trailer"
  | "cabGlass";

/** Procedural concrete with saw-cut joints: no texture download, so the view never depends on another site. */
function concreteTexture(base: string, joint: string) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  // Deterministic speckle so the floor looks the same on every load.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const a = rnd() * 0.07;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 14; i++) {
    const g = ctx.createRadialGradient(rnd() * size, rnd() * size, 0, rnd() * size, rnd() * size, 60 + rnd() * 120);
    g.addColorStop(0, "rgba(0,0,0,0.05)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.strokeStyle = joint;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Insulated wall panels with vertical seams. */
function panelTexture(base: string, seam: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = seam;
  for (let x = 0; x < 256; x += 32) ctx.fillRect(x, 0, 2, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function useMaterials(pal: Palette, quality: Quality): Materials {
  const dark = pal.theme === "dark";
  const m = useMemo(() => {
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
    const base: Record<MaterialName, THREE.Material> = {
      enclosure: std({ color: dark ? "#c7cdd5" : "#dfe3e8", roughness: 0.45, metalness: 0.25 }),
      enclosureDark: std({ color: "#3b4350", roughness: 0.5, metalness: 0.3 }),
      steel: std({ color: "#a9b1bb", roughness: 0.32, metalness: 0.85 }),
      darkPlastic: std({ color: "#262b33", roughness: 0.6, metalness: 0.1 }),
      rubber: std({ color: "#1b1e23", roughness: 0.92, metalness: 0 }),
      glass: new THREE.MeshPhysicalMaterial({ color: "#a5d8f0", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false }),
      carton: std({ color: "#c49563", roughness: 0.85, metalness: 0 }),
      white: std({ color: "#f1f3f6", roughness: 0.5, metalness: 0.05 }),
      robot: std({ color: "#f08a24", roughness: 0.38, metalness: 0.2 }),
      joint: std({ color: "#2b3038", roughness: 0.45, metalness: 0.6 }),
      safetyYellow: std({ color: "#f2c500", roughness: 0.55, metalness: 0.1 }),
      rackUpright: std({ color: "#2457c5", roughness: 0.5, metalness: 0.4 }),
      rackBeam: std({ color: "#ea6a1a", roughness: 0.5, metalness: 0.35 }),
      pallet: std({ color: "#b58a57", roughness: 0.9, metalness: 0 }),
      bezel: std({ color: "#1e232b", roughness: 0.4, metalness: 0.4 }),
      screen: std({ color: "#0b2033", emissive: "#4fb3ff", emissiveIntensity: quality === "high" ? 1.6 : 1, toneMapped: false }),
      tyre: std({ color: "#111317", roughness: 0.95 }),
      fenceMesh: std({ color: "#7d8793", roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
      column: std({ color: "#8a939e", roughness: 0.4, metalness: 0.7 }),
      windowBand: std({ color: "#d9ecff", emissive: "#cfe6ff", emissiveIntensity: dark ? 0.9 : 0.5, toneMapped: false }),
      trailer: std({ color: "#f4f6f8", roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.32, depthWrite: false }),
      cabGlass: std({ color: "#13202e", roughness: 0.08, metalness: 0.6 }),
    };
    const floor = std({ map: concreteTexture(dark ? "#3a4048" : "#a3abb3", dark ? "#2a2f36" : "#8a929b"), roughness: 0.82, metalness: 0.05 });
    const wall = std({ map: panelTexture(dark ? "#4a525d" : "#c4cad1", dark ? "#3c434c" : "#b1b8c0"), roughness: 0.7, metalness: 0.2 });
    return { base, floor, wall, dimmed: new Map<string, THREE.Material>(), paints: new Map<string, THREE.Material>() };
  }, [dark, quality]);

  useEffect(
    () => () => {
      for (const x of Object.values(m.base)) x.dispose();
      for (const x of m.dimmed.values()) x.dispose();
      for (const x of m.paints.values()) x.dispose();
      m.floor.map?.dispose();
      m.floor.dispose();
      m.wall.map?.dispose();
      m.wall.dispose();
    },
    [m],
  );

  return useMemo<Materials>(() => {
    const ghost = (key: string, src: THREE.Material) => {
      let g = m.dimmed.get(key);
      if (!g) {
        g = src.clone();
        g.transparent = true;
        g.opacity = 0.22;
        g.depthWrite = false;
        m.dimmed.set(key, g);
      }
      return g;
    };
    return {
      get: (name, dim) => (dim ? ghost(name, m.base[name]) : m.base[name]),
      paint: (color, dim) => {
        let p = m.paints.get(color);
        if (!p) {
          p = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.3 });
          m.paints.set(color, p);
        }
        return dim ? ghost(`paint:${color}`, p) : p;
      },
      floor: m.floor,
      wall: m.wall,
    };
  }, [m]);
}
