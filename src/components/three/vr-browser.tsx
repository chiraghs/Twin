"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useXRInputSourceState } from "@react-three/xr";
import * as THREE from "three";
import { useFactory } from "@/client/store";
import { pageLabel, VR_PAGES } from "@/domain/site-pages";
import { capturePage, clickPage, scrollPage, VR_BROWSER_NAME } from "./vr-page-capture";
import { FONT, THEME } from "./vr-ui";

/** CSS size of the page area; the window adds the site's sidebar and a top bar around it. */
const VW = 1280;
const VH = 800;
const SB = 232;
const TB = 52;
const TW = SB + VW;
const TH = TB + VH;
/** Pixels per CSS pixel: sharper text in the headset. */
const S = 1.5;
/** The window's size in metres. */
const PW = 1.9;
const PH = PW * (TH / TW);

const C = {
  canvas: THEME.canvas,
  surface: THEME.surface,
  line: THEME.line,
  ink: THEME.ink,
  muted: THEME.ink2,
  faint: THEME.muted,
  accent: THEME.accent,
  teal: "#14b8a6",
  hover: "rgba(148,163,184,0.12)",
  active: "rgba(76,141,255,0.16)",
};

type Action = { kind: "nav"; href: string } | { kind: "back" } | { kind: "reload" } | { kind: "up" } | { kind: "down" } | { kind: "screen" } | { kind: "close" };
interface Hit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: Action;
}

/**
 * The whole website in a window in front of you, drawn like the site itself: its sidebar on the
 * left, a top bar (back, reload, scroll, open on screen, close) and the live page. A same-origin
 * copy of the page runs in a hidden iframe; what it shows is drawn into the window, and your
 * pointer's clicks and scrolls are passed to it.
 */
export function VRBrowser({ path, onPath, onClose, onOpenOnScreen, position }: { path: string; onPath: (p: string) => void; onClose: () => void; onOpenOnScreen: (p: string) => void; position: [number, number, number] }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const pageCanvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = VW * S;
    c.height = VH * S;
    const g = c.getContext("2d")!;
    g.fillStyle = C.canvas;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }, []);
  const out = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = TW * S;
    c.height = TH * S;
    return c;
  }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(out);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [out]);
  useEffect(() => () => tex.dispose(), [tex]);

  const shownPath = useRef(path);
  const hits = useRef<Hit[]>([]);
  const hover = useRef<string | null>(null);
  const status = useRef<string>("Loading the page…");
  const scroll = useRef({ top: 0, height: VH });
  const busy = useRef(false);
  const again = useRef(false);
  const cursor = useRef<THREE.Mesh>(null);
  const lastPoint = useRef({ x: VW / 2, y: VH / 2 });
  const [, setTick] = useState(0);

  /** Draws the window: sidebar, top bar, the page and its scrollbar. */
  const compose = () => {
    const g = out.getContext("2d")!;
    g.setTransform(S, 0, 0, S, 0, 0);
    g.clearRect(0, 0, TW, TH);
    g.save();
    g.beginPath();
    g.roundRect(0, 0, TW, TH, 18);
    g.clip();
    g.fillStyle = C.canvas;
    g.fillRect(0, 0, TW, TH);
    const list: Hit[] = [];
    const cur = shownPath.current;
    const isOn = (href: string) => cur === href || cur.startsWith(`${href}/`);

    // Sidebar
    g.fillStyle = C.surface;
    g.fillRect(0, 0, SB, TH);
    g.fillStyle = C.line;
    g.fillRect(SB - 1, 0, 1, TH);
    g.fillStyle = C.accent;
    g.beginPath();
    g.roundRect(16, 14, 24, 24, 6);
    g.fill();
    g.fillStyle = "#fff";
    g.font = `700 14px ${FONT}`;
    g.textBaseline = "middle";
    g.fillText("T", 23.5, 26.5);
    g.fillStyle = C.ink;
    g.font = `600 16px ${FONT}`;
    g.fillText("Twin", 50, 26);
    g.fillStyle = C.accent;
    g.fillText("AI", 50 + g.measureText("Twin ").width, 26);
    g.fillStyle = C.line;
    g.fillRect(0, TB - 1, SB, 1);
    let y = TB + 12;
    for (const sec of VR_PAGES) {
      g.fillStyle = C.faint;
      g.font = `600 10.5px ${FONT}`;
      g.fillText(sec.section.toUpperCase().split("").join(String.fromCharCode(8202)), 18, y + 9);
      y += 22;
      for (const p of sec.pages) {
        const id = `nav:${p.href}`;
        const on = isOn(p.href);
        if (on || hover.current === id) {
          g.fillStyle = on ? C.active : C.hover;
          g.beginPath();
          g.roundRect(8, y, SB - 16, 28, 7);
          g.fill();
        }
        if (on) {
          g.fillStyle = C.accent;
          g.beginPath();
          g.roundRect(8, y + 6, 3, 16, 2);
          g.fill();
        }
        g.fillStyle = on ? "#fff" : hover.current === id ? C.ink : "#cbd5e1";
        g.font = `${on ? 600 : 500} 13.5px ${FONT}`;
        g.fillText(p.label, 22, y + 14.5);
        list.push({ id, x: 8, y, w: SB - 16, h: 28, action: { kind: "nav", href: p.href } });
        y += 29;
      }
      y += 8;
    }

    // Top bar
    g.fillStyle = C.surface;
    g.fillRect(SB, 0, VW, TB);
    g.fillStyle = C.line;
    g.fillRect(SB, TB - 1, VW, 1);
    const iconBtn = (id: string, x: number, label: string, action: Action, w = 36) => {
      const h = hover.current === id;
      g.fillStyle = h ? "rgba(148,163,184,0.18)" : "rgba(148,163,184,0.06)";
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.beginPath();
      g.roundRect(x, 9, w, 34, 8);
      g.fill();
      g.stroke();
      g.fillStyle = h ? "#fff" : C.ink;
      g.font = `600 15px ${FONT}`;
      g.textAlign = "center";
      g.fillText(label, x + w / 2, 26.5);
      g.textAlign = "left";
      list.push({ id, x, y: 9, w, h: 34, action });
    };
    iconBtn("back", SB + 14, "‹", { kind: "back" });
    iconBtn("reload", SB + 56, "↻", { kind: "reload" });
    g.fillStyle = C.ink;
    g.font = `600 16px ${FONT}`;
    g.fillText(pageLabel(cur), SB + 108, 26);
    const tw = g.measureText(pageLabel(cur)).width;
    g.fillStyle = C.faint;
    g.font = `13px ${FONT}`;
    g.fillText(`twin${cur}`, SB + 108 + tw + 12, 26.5);
    // Right side: scroll, open on screen, close.
    const rx = TW - 14;
    iconBtn("close", rx - 36, "✕", { kind: "close" });
    const sw = 150;
    const sid = "screen";
    g.fillStyle = hover.current === sid ? C.teal : "rgba(20,184,166,0.14)";
    g.strokeStyle = C.teal;
    g.beginPath();
    g.roundRect(rx - 46 - sw, 9, sw, 34, 8);
    g.fill();
    g.stroke();
    g.fillStyle = hover.current === sid ? "#04201c" : "#5eead4";
    g.font = `600 13.5px ${FONT}`;
    g.textAlign = "center";
    g.fillText("Open on screen  ↗", rx - 46 - sw / 2, 26.5);
    g.textAlign = "left";
    list.push({ id: sid, x: rx - 46 - sw, y: 9, w: sw, h: 34, action: { kind: "screen" } });
    iconBtn("down", rx - 56 - sw - 36, "▾", { kind: "down" });
    iconBtn("up", rx - 98 - sw - 36, "▴", { kind: "up" });

    // The page, and a scrollbar when it is longer than the window.
    g.drawImage(pageCanvas, SB, TB, VW, VH);
    const { top, height } = scroll.current;
    if (height > VH + 4) {
      const th = Math.max(40, (VH / height) * VH);
      const ty = TB + (top / (height - VH)) * (VH - th);
      g.fillStyle = "rgba(148,163,184,0.35)";
      g.beginPath();
      g.roundRect(TW - 9, ty + 2, 5, th - 4, 3);
      g.fill();
    }
    if (status.current) {
      g.font = `500 14px ${FONT}`;
      const w = g.measureText(status.current).width + 36;
      g.fillStyle = "rgba(17,26,46,0.96)";
      g.strokeStyle = C.line;
      g.beginPath();
      g.roundRect(SB + VW / 2 - w / 2, TB + VH - 58, w, 36, 18);
      g.fill();
      g.stroke();
      g.fillStyle = C.ink;
      g.textAlign = "center";
      g.fillText(status.current, SB + VW / 2, TB + VH - 39.5);
      g.textAlign = "left";
    }
    g.restore();
    // Frame
    g.strokeStyle = THEME.lineStrong;
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(1, 1, TW - 2, TH - 2, 18);
    g.stroke();
    hits.current = list;
    tex.needsUpdate = true;
  };
  const composeRef = useRef(compose);
  composeRef.current = compose;
  useEffect(() => composeRef.current(), []);

  const refresh = async () => {
    const win = frameRef.current?.contentWindow;
    if (!win?.document?.body) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      await capturePage(win, pageCanvas, VW, VH);
      const p = win.location.pathname;
      scroll.current = { top: win.scrollY, height: win.document.documentElement.scrollHeight };
      if (p !== shownPath.current) {
        shownPath.current = p;
        onPath(p);
      }
      status.current = "";
    } catch (e) {
      status.current = `Could not draw the page (${e instanceof Error ? e.message : "error"})`;
    } finally {
      busy.current = false;
      composeRef.current();
      if (again.current) {
        again.current = false;
        void refreshRef.current();
      }
    }
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const soon = (...ms: number[]) => ms.forEach((d) => window.setTimeout(() => void refreshRef.current(), d));

  // The hidden page: same origin, real size, invisible and not clickable on the 2D screen.
  useEffect(() => {
    const f = document.createElement("iframe");
    f.name = VR_BROWSER_NAME;
    f.title = "Website shown in VR";
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    Object.assign(f.style, { position: "fixed", left: "0", top: "0", width: `${VW}px`, height: `${VH}px`, border: "0", opacity: "0", pointerEvents: "none", zIndex: "-1" });
    f.addEventListener("load", () => soon(400, 1200, 2500));
    f.src = path;
    document.body.appendChild(f);
    frameRef.current = f;
    // Live telemetry: keep the picture current.
    const id = window.setInterval(() => void refreshRef.current(), 2500);
    return () => {
      window.clearInterval(id);
      f.remove();
      frameRef.current = null;
    };
    // The iframe is created once; later paths navigate it (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigation from the sidebar (or voice): client-side when the page is up, so it's instant.
  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (!win || shownPath.current === path) return;
    shownPath.current = path;
    status.current = `Opening ${pageLabel(path)}…`;
    composeRef.current();
    const link = Array.from(win.document.querySelectorAll<HTMLAnchorElement>("a[href]")).find((a) => a.getAttribute("href") === path);
    if (link) link.click();
    else win.location.assign(path);
    win.scrollTo(0, 0);
    soon(300, 900, 1800);
  }, [path]);

  const scrollBy = (dy: number, at = lastPoint.current) => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    scrollPage(win, at.x, at.y, dy);
    soon(60, 400);
  };
  const run = (a: Action) => {
    const win = frameRef.current?.contentWindow;
    switch (a.kind) {
      case "nav":
        return onPath(a.href);
      case "back":
        win?.history.back();
        return soon(300, 900);
      case "reload":
        return soon(0);
      case "up":
        return scrollBy(-450, { x: VW / 2, y: VH / 2 });
      case "down":
        return scrollBy(450, { x: VW / 2, y: VH / 2 });
      case "screen":
        return onOpenOnScreen(shownPath.current);
      case "close":
        return onClose();
    }
  };

  /** Where the pointer is, in window CSS pixels. */
  const at = (e: ThreeEvent<PointerEvent | MouseEvent | WheelEvent>) => (e.uv ? { x: e.uv.x * TW, y: (1 - e.uv.y) * TH } : null);
  const inPage = (p: { x: number; y: number }) => p.x >= SB && p.y >= TB;
  const hitAt = (p: { x: number; y: number }) => hits.current.find((h) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) ?? null;
  const setHover = (id: string | null) => {
    if (hover.current === id) return;
    hover.current = id;
    composeRef.current();
    setTick((n) => n + 1);
  };

  // Right thumbstick scrolls the page while you point at it.
  const right = useXRInputSourceState("controller", "right");
  const hovering = useRef(false);
  const stickAcc = useRef(0);
  useFrame((_, dt) => {
    if (!hovering.current) return;
    const y = (right?.gamepad?.["xr-standard-thumbstick"] as { yAxis?: number } | undefined)?.yAxis ?? 0;
    if (Math.abs(y) < 0.2) return;
    stickAcc.current += y * 900 * dt;
    if (Math.abs(stickAcc.current) > 60) {
      scrollBy(stickAcc.current);
      stickAcc.current = 0;
    }
  });

  return (
    <group position={position}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          const p = at(e);
          if (!p) return;
          if (!inPage(p)) {
            const h = hitAt(p);
            if (h) run(h.action);
            return;
          }
          const win = frameRef.current?.contentWindow;
          if (!win) return;
          const q = { x: p.x - SB, y: p.y - TB };
          lastPoint.current = q;
          clickPage(win, q.x, q.y);
          soon(150, 600, 1400);
          // The plant may have changed (an approval, a speed change): refresh the twin too.
          window.setTimeout(() => void useFactory.getState().load(), 1200);
        }}
        onPointerMove={(e) => {
          const p = at(e);
          if (!p) return;
          if (inPage(p)) {
            lastPoint.current = { x: p.x - SB, y: p.y - TB };
            setHover(null);
          } else setHover(hitAt(p)?.id ?? null);
          if (cursor.current) {
            cursor.current.visible = true;
            cursor.current.position.set((p.x / TW - 0.5) * PW, (0.5 - p.y / TH) * PH, 0.004);
          }
        }}
        onPointerOver={() => void (hovering.current = true)}
        onPointerOut={() => {
          hovering.current = false;
          setHover(null);
          if (cursor.current) cursor.current.visible = false;
        }}
        onWheel={(e) => {
          e.stopPropagation();
          const p = at(e);
          const q = p && inPage(p) ? { x: p.x - SB, y: p.y - TB } : undefined;
          scrollBy(Math.sign(e.deltaY) * Math.min(400, Math.abs(e.deltaY) * 2 + 80), q);
        }}
      >
        <planeGeometry args={[PW, PH]} />
        <meshBasicMaterial map={tex} transparent toneMapped={false} />
      </mesh>
      {/* A soft shadow behind the window so it reads against the plant */}
      <mesh position={[0, -0.01, -0.01]}>
        <planeGeometry args={[PW + 0.06, PH + 0.06]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={cursor} visible={false}>
        <ringGeometry args={[0.005, 0.009, 24]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} depthTest={false} />
      </mesh>
    </group>
  );
}

/** The pages on the always-visible VR nav bar; "All pages" opens the window with the full sidebar. */
const DOCK = [
  { href: "/dashboard", label: "Command Center" },
  { href: "/agents", label: "AI Operations" },
  { href: "/approvals", label: "Approvals" },
  { href: "/simulator", label: "What-If" },
  { href: "/assets", label: "Assets" },
  { href: "/analytics/supply", label: "Supply Chain" },
  { href: "/sustainability", label: "Sustainability" },
  { href: "/control-room", label: "CCTV" },
  { href: "*", label: "All pages ▾" },
] as const;
const NW = 1180;
const NH = 56;
const NAV_W = 1.2;
const eyeTmp = new THREE.Vector3();

/**
 * The website's nav bar, always in view at the top while in VR (like a site header): pick a page
 * and it opens in the website window in front of you.
 */
export function VRNavBar({ position, rotationX = 0.32, current, onOpen, aboveEyes }: { position: [number, number, number]; rotationX?: number; current: string | null; onOpen: (href: string | null) => void; /** Keep the bar this far from your eye height (metres, negative is below) instead of a fixed height. */ aboveEyes?: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const camera = useThree((st) => st.camera);
  useFrame(() => {
    const m = mesh.current;
    if (!m?.parent || aboveEyes === undefined) return;
    camera.getWorldPosition(eyeTmp);
    m.parent.worldToLocal(eyeTmp);
    const y = eyeTmp.y + aboveEyes;
    // Follow the head height smoothly (standing up, sitting down), not every small nod.
    m.position.y += (y - m.position.y) * 0.08;
  });
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = NW * S;
    c.height = NH * S;
    return c;
  }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, [canvas]);
  useEffect(() => () => tex.dispose(), [tex]);
  const [hover, setHover] = useState<string | null>(null);
  const hits = useRef<{ href: string; x: number; w: number }[]>([]);
  useEffect(() => {
    const g = canvas.getContext("2d")!;
    g.setTransform(S, 0, 0, S, 0, 0);
    g.clearRect(0, 0, NW, NH);
    g.fillStyle = "rgba(17,26,46,0.97)";
    g.strokeStyle = THEME.lineStrong;
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(1, 1, NW - 2, NH - 2, NH / 2);
    g.fill();
    g.stroke();
    g.textBaseline = "middle";
    g.fillStyle = C.accent;
    g.beginPath();
    g.roundRect(18, 16, 24, 24, 6);
    g.fill();
    g.fillStyle = "#fff";
    g.font = `700 14px ${FONT}`;
    g.fillText("T", 25.5, 28.5);
    g.fillStyle = C.ink;
    g.font = `600 16px ${FONT}`;
    g.fillText("Twin", 52, 28);
    g.fillStyle = C.accent;
    g.fillText("AI", 52 + g.measureText("Twin ").width, 28);
    g.fillStyle = C.line;
    g.fillRect(110, 14, 1, NH - 28);
    let x = 122;
    const list: { href: string; x: number; w: number }[] = [];
    g.font = `500 14px ${FONT}`;
    for (const d of DOCK) {
      const w = g.measureText(d.label).width + 26;
      const on = d.href !== "*" && current !== null && (current === d.href || current.startsWith(`${d.href}/`));
      const h = hover === d.href;
      if (on || h) {
        g.fillStyle = on ? C.active : C.hover;
        g.beginPath();
        g.roundRect(x, 10, w, NH - 20, (NH - 20) / 2);
        g.fill();
      }
      g.fillStyle = on ? "#fff" : h ? C.ink : "#cbd5e1";
      g.font = `${on ? 600 : 500} 14px ${FONT}`;
      g.fillText(d.label, x + 13, 28.5);
      if (on) {
        g.fillStyle = C.accent;
        g.fillRect(x + 13, NH - 13, w - 26, 2.5);
      }
      list.push({ href: d.href, x, w });
      x += w + 4;
    }
    hits.current = list;
    tex.needsUpdate = true;
  }, [canvas, tex, hover, current]);
  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (!e.uv) return null;
    const px = e.uv.x * NW;
    return hits.current.find((h) => px >= h.x && px <= h.x + h.w)?.href ?? null;
  };
  return (
    <mesh
      ref={mesh}
      position={position}
      rotation-x={-rotationX}
      onClick={(e) => {
        e.stopPropagation();
        const h = pick(e);
        if (h) onOpen(h === "*" ? null : h);
      }}
      onPointerMove={(e) => setHover(pick(e))}
      onPointerOut={() => setHover(null)}
    >
      <planeGeometry args={[NAV_W, NAV_W * (NH / NW)]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}
