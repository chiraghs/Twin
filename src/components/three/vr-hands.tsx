"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR, useXRInputSourceEvent, useXRInputSourceState, XRSpace } from "@react-three/xr";
import * as THREE from "three";
import { create } from "zustand";
import { controlTexture, textTexture, THEME } from "./vr-ui";

/** Frames per second and frametime in milliseconds, measured in the render loop (XR frames in a headset). */
export const useFps = create<{ fps: number; ms: number; set: (fps: number, ms?: number) => void }>((set) => ({
  fps: 0,
  ms: 0,
  set: (fps, ms = 0) => set({ fps, ms: ms || (fps > 0 ? Math.round((1000 / fps) * 10) / 10 : 0) }),
}));

/* ─────────────────────────── hand menu ─────────────────────────── */

export interface HandMenuItem {
  key: string;
  label: string;
  color: string;
  active?: boolean;
  onPress: () => void;
}

/** A small flat button sized for a fingertip (about 7 × 2.6 cm). Poke it, or pinch at it. */
function PokeButton({ item, position }: { item: HandMenuItem; position: [number, number, number] }) {
  const [hover, setHover] = useState(false);
  const last = useRef(0);
  const tex = useMemo(
    () => controlTexture(item.label, item.color, { hover, active: item.active }, 320, 120),
    [item.label, item.color, item.active, hover],
  );
  useEffect(() => () => tex.dispose(), [tex]);
  const press = () => {
    // A poke can fire twice as the finger passes through; one press per 400 ms.
    const now = performance.now();
    if (now - last.current < 400) return;
    last.current = now;
    item.onPress();
  };
  return (
    <mesh
      position={position}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}
      onClick={(e) => {
        e.stopPropagation();
        press();
      }}
    >
      <planeGeometry args={[0.07, 0.07 * (120 / 320)]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

const palmNormal = new THREE.Vector3();
const toHead = new THREE.Vector3();
const wristPos = new THREE.Vector3();
const q = new THREE.Quaternion();

/**
 * Hands-first menu: turn your left palm toward your face and the menu appears above the palm;
 * press its buttons with your right index finger. Hidden when the palm turns away, so it never
 * gets in the way. Controllers keep the waist-height buttons.
 */
export function HandMenu({ items, label }: { items: HandMenuItem[]; label?: string }) {
  const fps = useFps((s) => s.fps);
  const ms = useFps((s) => s.ms);
  const status = `${label ? `${label} · ` : ""}${fps ? `${fps} fps` : ""}${ms ? ` · ${ms}ms` : ""}`.replace(/ · $/, "");
  const left = useXRInputSourceState("hand", "left");
  const right = useXRInputSourceState("hand", "right");
  const wrist = left?.inputSource.hand?.get("wrist") ?? right?.inputSource.hand?.get("wrist");
  const isRight = !left?.inputSource.hand?.get("wrist") && !!right?.inputSource.hand?.get("wrist");
  const panel = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const [open, setOpen] = useState(false);
  const shown = useRef(false);
  useFrame(() => {
    const g = panel.current?.parent;
    if (!g) return;
    g.getWorldPosition(wristPos);
    g.getWorldQuaternion(q);
    // WebXR hand joints: +Y points out of the back of the hand, so the palm faces -Y.
    palmNormal.set(0, -1, 0).applyQuaternion(q);
    camera.getWorldPosition(toHead);
    toHead.sub(wristPos).normalize();
    const facing = palmNormal.dot(toHead);
    // Hysteresis so it doesn't flicker at the threshold.
    const next = shown.current ? facing > 0.35 : facing > 0.6;
    if (next !== shown.current) {
      shown.current = next;
      setOpen(next);
    }
  });
  const cols = 2;
  const rows = Math.ceil(items.length / cols);
  const statusTex = useMemo(() => (status ? textTexture([{ text: status, color: THEME.ink2, font: "500 26px system-ui, sans-serif" }], 480, 70) : null), [status]);
  useEffect(() => () => statusTex?.dispose(), [statusTex]);
  if (!wrist) return null;
  return (
    <XRSpace space={wrist}>
      {/* Above the palm, offset toward the thumb side and lifted off the skin. */}
      <group ref={panel} position={[0, -0.06, -0.07]} rotation={[Math.PI / 2, 0, Math.PI]} visible={open}>
        {open &&
          items.map((it, i) => (
            <PokeButton key={it.key} item={it} position={[(i % cols) * 0.078 - 0.039, 0.05 + (rows - 1 - Math.floor(i / cols)) * 0.034, 0]} />
          ))}
        {open && statusTex && (
          <mesh position={[0, 0.05 + rows * 0.034, 0]}>
            <planeGeometry args={[0.15, 0.022]} />
            <meshBasicMaterial map={statusTex} transparent toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        )}
      </group>
    </XRSpace>
  );
}

/* ─────────────────────────── tabletop placement ─────────────────────────── */

const hitMatrix = new THREE.Matrix4();
const hitPos = new THREE.Vector3();
const hitQuat = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const hitNormal = new THREE.Vector3();

/**
 * Finds a real horizontal surface (your desk or table) where you look, using WebXR hit testing
 * against the room's detected planes and mesh; a ring marks it. Pinch, pull the trigger or tap
 * to put the plant there. Wall hits are ignored.
 */
export function TablePlacer({ onPlace, children }: { onPlace: (p: THREE.Vector3, yaw: number) => void; children?: ReactNode }) {
  const camera = useThree((s) => s.camera);
  const session = useXR((s) => s.session);
  const origin = useXR((s) => s.origin);
  const originSpace = useXR((s) => s.originReferenceSpace);
  const ring = useRef<THREE.Group>(null);
  const valid = useRef(false);
  const steady = useRef<{ since: number; at: THREE.Vector3 } | null>(null);
  const placed = useRef(false);
  const [source, setSource] = useState<XRHitTestSource | null>(null);
  // Hit test along a ray 30° below where you look: you glance down at a desk, not straight at it.
  useEffect(() => {
    if (!session?.requestHitTestSource) return;
    let src: XRHitTestSource | undefined;
    let alive = true;
    void session
      .requestReferenceSpace("viewer")
      .then((viewer) => session.requestHitTestSource!({ space: viewer, offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: -0.58, z: -1, w: 0 }), entityTypes: ["plane", "mesh"] } as XRHitTestOptionsInit))
      .then((s) => {
        if (!s) return;
        if (alive) setSource((src = s));
        else s.cancel();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      src?.cancel();
    };
  }, [session]);
  const place = () => {
    if (placed.current || !valid.current || !ring.current) return;
    placed.current = true;
    const p = ring.current.position.clone();
    const head = camera.getWorldPosition(new THREE.Vector3());
    // Turn the model so its front (+z, the dock side) faces you.
    onPlace(p, Math.atan2(head.x - p.x, head.z - p.z));
  };
  useFrame((st, _dt, frame?: XRFrame) => {
    if (!frame || !source || !originSpace) return;
    valid.current = false;
    for (const r of frame.getHitTestResults(source)) {
      const pose = r.getPose(originSpace);
      if (!pose) continue;
      hitMatrix.fromArray(pose.transform.matrix);
      if (origin) hitMatrix.premultiply(origin.matrixWorld);
      hitMatrix.decompose(hitPos, hitQuat, new THREE.Vector3());
      hitNormal.set(0, 1, 0).applyQuaternion(hitQuat);
      if (Math.abs(hitNormal.dot(up)) < 0.9) continue; // horizontal surfaces only
      if (hitPos.y < 0.3 || hitPos.y > 1.4) continue; // table height, not the floor
      valid.current = true;
      ring.current?.position.copy(hitPos);
      break;
    }
    if (ring.current) ring.current.visible = valid.current;
    // Held steady on a surface for 1.5 s: place it there (pinch places at once).
    const now = st.clock.elapsedTime;
    if (!valid.current) steady.current = null;
    else if (!steady.current || steady.current.at.distanceTo(hitPos) > 0.1) steady.current = { since: now, at: hitPos.clone() };
    else if (now - steady.current.since > 1.5) place();
  });
  useXRInputSourceEvent("all", "select", place, [onPlace, camera]);
  return (
    <group ref={ring} visible={false}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.16, 0.19, 48]} />
        <meshBasicMaterial color="#4c8dff" transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.001, 0]}>
        <circleGeometry args={[0.16, 48]} />
        <meshBasicMaterial color="#4c8dff" transparent opacity={0.18} toneMapped={false} />
      </mesh>
      {children}
    </group>
  );
}

/* ─────────────────────────── frame rate ─────────────────────────── */

/** Measures frames per second and render frame time (XR frames inside a headset), twice a second. */
export function FpsProbe() {
  const onFps = useFps((s) => s.set);
  const acc = useRef({ t: 0, n: 0 });
  useFrame((_, dt) => {
    const a = acc.current;
    a.t += dt;
    a.n += 1;
    if (a.t >= 0.5) {
      const fps = Math.round(a.n / a.t);
      const ms = Math.round((a.t / a.n) * 1000 * 10) / 10;
      onFps(fps, ms);
      a.t = 0;
      a.n = 0;
    }
  });
  return null;
}

/** The current XR session mode, for switching to the tabletop in passthrough. */
export const useXRMode = () => useXR((s) => s.mode);
