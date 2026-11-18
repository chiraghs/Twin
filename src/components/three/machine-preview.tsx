"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { FactoryState } from "@/domain/types";
import { isoModelFromState, layoutIso } from "../iso/model";
import { useMaterials } from "./materials";
import { usePalette, type Palette } from "./palette";
import { Machine3D, P } from "./scene";

function Rig({ state, assetId, pal }: { state: FactoryState; assetId: string; pal: Palette }) {
  const mats = useMaterials(pal, "standard");
  const pm = useMemo(() => layoutIso(isoModelFromState(state, {}, { cameras: false })).machines.find((m) => m.m.id === assetId) ?? null, [state, assetId]);
  if (!pm) return null;
  return (
    <group position={P(-pm.x, -pm.y)}>
      <Machine3D pm={pm} pal={pal} mats={mats} quality="standard" status={pm.m.status} dim={false} selected={false} target={false} reroute={false} />
    </group>
  );
}

/** One machine on its own, close up: the commissioning view for jogging its axes. */
export function MachinePreview({ state, assetId }: { state: FactoryState; assetId: string }) {
  const pal = usePalette();
  if (!pal) return <div className="h-full w-full" />;
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ fov: 35, near: 0.05, far: 50, position: [2.4, 2.1, 2.6] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
      aria-label="3D preview of the machine"
    >
      <hemisphereLight args={["#ffffff", "#5b636c", 1.1]} />
      <directionalLight position={[3, 5, 2]} intensity={1.6} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <circleGeometry args={[2.2, 48]} />
        <meshStandardMaterial color={pal.theme === "dark" ? "#2a313c" : "#d9dde3"} />
      </mesh>
      <Rig state={state} assetId={assetId} pal={pal} />
      <OrbitControls target={[0, 0.6, 0]} enablePan={false} minDistance={1.2} maxDistance={7} maxPolarAngle={Math.PI / 2.1} />
    </Canvas>
  );
}
