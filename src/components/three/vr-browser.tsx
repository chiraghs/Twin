"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useXRInputSourceState } from "@react-three/xr";
import * as THREE from "three";
import { useFactory } from "@/client/store";
import { Button3D, textTexture } from "./vr-ui";
import { pageLabel, sectionOf, VR_PAGES } from "@/domain/site-pages";
import { capturePage, clickPage, scrollPage, VR_BROWSER_NAME } from "./vr-page-capture";

/** CSS size of the page shown on the panel. */
const VW = 1280;
const VH = 800;
const PW = 1.6;
const PH = PW * (VH / VW);

/**
 * The whole website on a panel in front of you: a same-origin copy of the page runs in a hidden
 * iframe; what it shows is drawn onto the panel, and your pointer's clicks and scrolls are passed
 * to it. The buttons on the left are the site's navigation; "Open on screen" leaves the headset
 * on that page.
 */
export function VRBrowser({ path, onPath, onClose, onOpenOnScreen, position }: { path: string; onPath: (p: string) => void; onClose: () => void; onOpenOnScreen: (p: string) => void; position: [number, number, number] }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const canvas = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = VW;
    c.height = VH;
    const g = c.getContext("2d")!;
    g.fillStyle = "#070b14";
    g.fillRect(0, 0, VW, VH);
    g.fillStyle = "#94a3b8";
    g.font = "32px system-ui, sans-serif";
    g.textAlign = "center";
    g.fillText("Loading the page…", VW / 2, VH / 2);
    return c;
  }, []);
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }, [canvas]);
  useEffect(() => () => tex.dispose(), [tex]);
  const busy = useRef(false);
  const again = useRef(false);
  const shownPath = useRef(path);
  const [section, setSection] = useState<string>(sectionOf(path));
  const [status, setStatus] = useState("Loading…");
  const cursor = useRef<THREE.Mesh>(null);
  const lastPoint = useRef({ x: VW / 2, y: VH / 2 });

  const refresh = async () => {
    const win = frameRef.current?.contentWindow;
    if (!win?.document?.body) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      await capturePage(win, canvas, VW, VH);
      tex.needsUpdate = true;
      const p = win.location.pathname;
      if (p !== shownPath.current) {
        shownPath.current = p;
        onPath(p);
        setSection(sectionOf(p));
      }
      setStatus("");
    } catch (e) {
      setStatus(`Could not draw the page (${e instanceof Error ? e.message : "error"})`);
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void refresh();
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

  // Navigation from the VR buttons (or voice): client-side when the page is up, so it's instant.
  useEffect(() => {
    const win = frameRef.current?.contentWindow;
    if (!win || shownPath.current === path) return;
    shownPath.current = path;
    setSection(sectionOf(path));
    setStatus(`Opening ${pageLabel(path)}…`);
    const link = Array.from(win.document.querySelectorAll<HTMLAnchorElement>("a[href]")).find((a) => a.getAttribute("href") === path);
    if (link) link.click();
    else win.location.assign(path);
    win.scrollTo(0, 0);
    soon(300, 900, 1800);
  }, [path]);

  const toPage = (e: ThreeEvent<PointerEvent | MouseEvent | WheelEvent>) => {
    const uv = e.uv;
    if (!uv) return null;
    return { x: uv.x * VW, y: (1 - uv.y) * VH };
  };
  const afterAction = () => {
    soon(150, 600, 1400);
    // The plant state may have changed (an approval, a speed change): refresh the twin too.
    window.setTimeout(() => void useFactory.getState().load(), 1200);
  };
  const scrollBy = (dy: number, at = lastPoint.current) => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    scrollPage(win, at.x, at.y, dy);
    soon(60, 400);
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

  const statusTex = useMemo(() => (status ? textTexture([{ text: status, color: "#e5e7eb", font: "28px system-ui, sans-serif" }], 900, 64, "rgba(10,14,24,0.9)") : null), [status]);
  useEffect(() => () => statusTex?.dispose(), [statusTex]);
  const current = VR_PAGES.find((s) => s.section === section) ?? VR_PAGES[0];

  return (
    <group position={position}>
      {/* The page */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          const p = toPage(e);
          const win = frameRef.current?.contentWindow;
          if (!p || !win) return;
          lastPoint.current = p;
          clickPage(win, p.x, p.y);
          afterAction();
        }}
        onPointerMove={(e) => {
          const p = toPage(e);
          if (!p) return;
          lastPoint.current = p;
          if (cursor.current) {
            cursor.current.visible = true;
            cursor.current.position.set((p.x / VW - 0.5) * PW, (0.5 - p.y / VH) * PH, 0.004);
          }
        }}
        onPointerOver={() => void (hovering.current = true)}
        onPointerOut={() => {
          hovering.current = false;
          if (cursor.current) cursor.current.visible = false;
        }}
        onWheel={(e) => {
          e.stopPropagation();
          const p = toPage(e);
          scrollBy(Math.sign(e.deltaY) * Math.min(400, Math.abs(e.deltaY) * 2 + 80), p ?? undefined);
        }}
      >
        <planeGeometry args={[PW, PH]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {/* Frame */}
      <mesh position={[0, 0, -0.006]}>
        <planeGeometry args={[PW + 0.04, PH + 0.04]} />
        <meshBasicMaterial color="#334155" toneMapped={false} />
      </mesh>
      <mesh ref={cursor} visible={false}>
        <circleGeometry args={[0.008, 20]} />
        <meshBasicMaterial color="#38bdf8" toneMapped={false} depthTest={false} />
      </mesh>
      {statusTex && (
        <mesh position={[0, -PH / 2 + 0.05, 0.006]}>
          <planeGeometry args={[0.9, 0.064]} />
          <meshBasicMaterial map={statusTex} transparent toneMapped={false} />
        </mesh>
      )}

      {/* Section tabs above the page */}
      {VR_PAGES.map((s, i) => (
        <Button3D key={s.section} label={s.section} color="#4c8dff" width={0.32} active={s.section === section} position={[-PW / 2 + 0.16 + i * 0.34, PH / 2 + 0.1, 0]} onPress={() => setSection(s.section)} />
      ))}

      {/* The site's navigation, on the left like its sidebar */}
      {current.pages.map((p, i) => (
        <Button3D key={p.href} label={p.label} color="#22c55e" width={0.38} active={path === p.href || shownPath.current === p.href} position={[-PW / 2 - 0.23, PH / 2 - 0.07 - i * 0.135, 0]} onPress={() => onPath(p.href)} />
      ))}

      {/* On the right: close, leave the headset on this page, and scrolling (or the thumbstick / mouse wheel while pointing at the page) */}
      <Button3D label="Close" color="#64748b" width={0.3} position={[PW / 2 + 0.18, PH / 2 - 0.07, 0]} onPress={onClose} />
      <Button3D label="On screen" color="#14b8a6" width={0.3} position={[PW / 2 + 0.18, PH / 2 - 0.2, 0]} onPress={() => onOpenOnScreen(shownPath.current)} />
      <Button3D label="▲" color="#64748b" width={0.3} position={[PW / 2 + 0.18, 0.02, 0]} onPress={() => scrollBy(-450)} />
      <Button3D label="▼" color="#64748b" width={0.3} position={[PW / 2 + 0.18, -0.12, 0]} onPress={() => scrollBy(450)} />
      <Button3D label="↻ Refresh" color="#64748b" width={0.3} position={[PW / 2 + 0.18, -PH / 2 + 0.07, 0]} onPress={() => soon(0)} />
    </group>
  );
}
