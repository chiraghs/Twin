"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { DefaultXRHand, useXR, useXRInputSourceEvent, useXRInputSourceState, XRHandModel, XRSpace } from "@react-three/xr";
import * as THREE from "three";
import { create } from "zustand";
import { controlTexture, textTexture, THEME } from "./vr-ui";

/** Frames per second and frametime in milliseconds, measured in the render loop (XR frames in a headset). */
export const useFps = create<{ fps: number; ms: number; set: (fps: number, ms?: number) => void }>((set) => ({
  fps: 0,
  ms: 0,
  set: (fps, ms = 0) => set({ fps, ms: ms || (fps > 0 ? Math.round((1000 / fps) * 10) / 10 : 0) }),
}));

/* ─────────────────────────── hands ─────────────────────────── */

/**
 * Hands in the style of Meta's Quest hands: a light, frosted, see-through hand with a bright outline
 * along its silhouette, fading out toward the wrist, with the thumb and index tips lighting up as
 * they close into a pinch. In WebXR the page draws the hands itself, so this is what you see on a
 * headset. Skinned: it follows every tracked joint.
 */
const HAND_VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 w = modelMatrix * vec4(transformed, 1.0);
    vec4 mv = viewMatrix * w;
    vW = w.xyz;
    vN = normalize(normalMatrix * objectNormal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const HAND_FRAG = /* glsl */ `
  uniform vec3 uFill;
  uniform vec3 uRim;
  uniform vec3 uGlow;
  uniform vec3 uWrist;
  uniform vec3 uForward;
  uniform vec3 uIndex;
  uniform vec3 uThumb;
  uniform float uPinch;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  void main() {
    // Fade out from the palm toward the wrist (no forearm stub).
    float along = dot(vW - uWrist, uForward);
    float fade = smoothstep(-0.015, 0.05, along);
    #ifdef DEPTH_ONLY
      if (fade < 0.5) discard;
      gl_FragColor = vec4(0.0);
    #else
      float facing = abs(dot(normalize(vN), normalize(vV)));
      float rim = pow(1.0 - facing, 3.0);
      // Fingertip glow: grows as thumb and index close.
      float tip = min(distance(vW, uIndex), distance(vW, uThumb));
      float glow = (1.0 - smoothstep(0.004, 0.03, tip)) * (0.18 + 0.82 * uPinch);
      vec3 col = mix(uFill, uRim, rim);
      col = mix(col, uGlow, glow);
      float alpha = (0.3 + 0.7 * rim + 0.6 * glow) * fade;
      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    #endif
  }`;

type HandUniforms = Record<"uWrist" | "uForward" | "uIndex" | "uThumb", { value: THREE.Vector3 }> & { uPinch: { value: number } };

const handUniforms = (): HandUniforms & Record<string, THREE.IUniform> => ({
  uFill: { value: new THREE.Color("#c9d3e3") },
  uRim: { value: new THREE.Color("#ffffff") },
  uGlow: { value: new THREE.Color("#8fd0ff") },
  uWrist: { value: new THREE.Vector3() },
  uForward: { value: new THREE.Vector3(0, 0, -1) },
  uIndex: { value: new THREE.Vector3(1e3, 1e3, 1e3) },
  uThumb: { value: new THREE.Vector3(1e3, 1e3, 1e3) },
  uPinch: { value: 0 },
});

function QuestHandModel() {
  const ref = useRef<THREE.Object3D>(null);
  const uniforms = useMemo(handUniforms, []);
  const bones = useRef<{ wrist?: THREE.Object3D; middle?: THREE.Object3D; index?: THREE.Object3D; thumb?: THREE.Object3D }>({});
  const prepass = useRef<THREE.SkinnedMesh[]>([]);
  useEffect(() => {
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader: HAND_VERT, fragmentShader: HAND_FRAG, transparent: true, depthWrite: false });
    // A depth-only copy draws first (opaque pass), so the see-through hand shows only its front
    // surface: curled fingers don't show through the palm. It skips the faded wrist.
    const depth = new THREE.ShaderMaterial({ uniforms, vertexShader: HAND_VERT, fragmentShader: HAND_FRAG, defines: { DEPTH_ONLY: "" }, colorWrite: false });
    const added: THREE.Object3D[] = [];
    const meshes: THREE.SkinnedMesh[] = [];
    ref.current?.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
      if (o.name === "wrist") bones.current.wrist = o;
      if (o.name === "middle-finger-phalanx-proximal") bones.current.middle = o;
      if (o.name === "index-finger-tip") bones.current.index = o;
      if (o.name === "thumb-tip") bones.current.thumb = o;
    });
    for (const m of meshes) {
      m.material = material;
      const pre = new THREE.SkinnedMesh(m.geometry, depth);
      pre.bind(m.skeleton, m.bindMatrix);
      pre.frustumCulled = false;
      // Last among opaque objects, so it never hides scene geometry behind the hand.
      pre.renderOrder = 1e6;
      pre.position.copy(m.position);
      pre.quaternion.copy(m.quaternion);
      pre.scale.copy(m.scale);
      m.parent?.add(pre);
      added.push(pre);
    }
    prepass.current = added as THREE.SkinnedMesh[];
    return () => {
      prepass.current = [];
      added.forEach((o) => o.removeFromParent());
      depth.dispose();
      material.dispose();
    };
  }, [uniforms]);
  useFrame(() => {
    // The hand model re-applies colorWrite / renderOrder to every mesh inside it; keep the
    // depth-only copies depth-only and last among opaque objects.
    for (const pre of prepass.current) {
      (pre.material as THREE.Material).colorWrite = false;
      pre.renderOrder = 1e6;
    }
    const { wrist, middle, index, thumb } = bones.current;
    if (!wrist || !middle || !index || !thumb) return;
    wrist.getWorldPosition(uniforms.uWrist.value);
    middle.getWorldPosition(uniforms.uForward.value).sub(uniforms.uWrist.value).normalize();
    index.getWorldPosition(uniforms.uIndex.value);
    thumb.getWorldPosition(uniforms.uThumb.value);
    const d = uniforms.uIndex.value.distanceTo(uniforms.uThumb.value);
    uniforms.uPinch.value = 1 - THREE.MathUtils.smoothstep(d, 0.012, 0.06);
  });
  return <XRHandModel ref={ref} />;
}

/** Tracked hand: the Quest-style model plus the usual pointers (touch, grab, ray, pinch-to-teleport). */
export function QuestHand() {
  return (
    <>
      <Suspense fallback={null}>
        <QuestHandModel />
      </Suspense>
      <DefaultXRHand model={false} teleportPointer />
    </>
  );
}

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

/* ─────────────────────────── simulator mouse ─────────────────────────── */

/**
 * Headset simulator only: the simulator draws its controls on a transparent layer above the 3D view,
 * so mouse clicks never reach the scene. This casts a ray from the headset's camera through the
 * mouse and calls the object's own pointer handlers: hover, click and wheel work on every button,
 * the nav bar and the website window. A real headset doesn't need it.
 */
export function SimulatorMouse({ enabled }: { enabled: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const fallback = useThree((s) => s.camera);
  useEffect(() => {
    if (!enabled) return;
    let stop: (() => void) | null = null;
    let tries = 0;
    // The simulator builds its layer when the session starts: wait for it.
    const id = window.setInterval(() => {
      const runtime = gl.domElement.closest("[data-webxr_runtime]");
      const layer = runtime
        ? Array.from(runtime.querySelectorAll<HTMLCanvasElement>(":scope > canvas"))
            .filter((c) => c !== gl.domElement)
            .sort((a, b) => Number(getComputedStyle(b).zIndex) - Number(getComputedStyle(a).zIndex))[0]
        : undefined;
      if (!layer && ++tries < 40) return;
      window.clearInterval(id);
      const from = layer ?? gl.domElement;
      const camera = () => {
        const xr = gl.xr.getCamera();
        return (xr.cameras[0] as THREE.PerspectiveCamera | undefined) ?? (fallback as THREE.PerspectiveCamera);
      };
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      type Handlers = Record<string, ((e: unknown) => void) | undefined>;
      const handlersOf = (o: THREE.Object3D | null) => (o as unknown as { __r3f?: { handlers?: Handlers } } | null)?.__r3f?.handlers;
      /** The first object under the mouse that listens for pointer events (or its nearest listening parent). */
      const pick = (ev: MouseEvent) => {
        const rc = from.getBoundingClientRect();
        ndc.set(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
        ray.setFromCamera(ndc, camera());
        for (const hit of ray.intersectObject(scene, true)) {
          let shown = true;
          for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (!o.visible) shown = false;
          if (!shown) continue;
          for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
            const h = handlersOf(o);
            if (h && Object.keys(h).length) return { hit, target: o, h };
          }
        }
        return null;
      };
      const event = (ev: MouseEvent, hit: THREE.Intersection) => ({ ...hit, eventObject: hit.object, nativeEvent: ev, deltaY: (ev as WheelEvent).deltaY ?? 0, stopPropagation: () => undefined, pointerId: 1, pointerType: "mouse" });
      let hovered: THREE.Object3D | null = null;
      const move = (ev: PointerEvent) => {
        const p = pick(ev);
        if (hovered && hovered !== p?.target) handlersOf(hovered)?.onPointerOut?.({ nativeEvent: ev, stopPropagation: () => undefined });
        if (p && hovered !== p.target) p.h.onPointerOver?.(event(ev, p.hit));
        hovered = p?.target ?? null;
        p?.h.onPointerMove?.(event(ev, p.hit));
      };
      const down = (ev: PointerEvent) => {
        const p = pick(ev);
        p?.h.onPointerDown?.(event(ev, p.hit));
      };
      const up = (ev: PointerEvent) => {
        const p = pick(ev);
        p?.h.onPointerUp?.(event(ev, p.hit));
      };
      const click = (ev: MouseEvent) => {
        const p = pick(ev);
        p?.h.onClick?.(event(ev, p.hit));
      };
      const wheel = (ev: WheelEvent) => {
        const p = pick(ev);
        p?.h.onWheel?.(event(ev, p.hit));
      };
      from.addEventListener("pointermove", move);
      from.addEventListener("pointerdown", down);
      from.addEventListener("pointerup", up);
      from.addEventListener("click", click);
      from.addEventListener("wheel", wheel, { passive: true });
      stop = () => {
        from.removeEventListener("pointermove", move);
        from.removeEventListener("pointerdown", down);
        from.removeEventListener("pointerup", up);
        from.removeEventListener("click", click);
        from.removeEventListener("wheel", wheel);
      };
    }, 150);
    return () => {
      window.clearInterval(id);
      stop?.();
    };
  }, [enabled, gl, scene, fallback]);
  return null;
}
