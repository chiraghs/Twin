"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { amrFleet } from "@/domain/intralogistics";
import { lineFlows } from "@/domain/live";
import type { FactoryState } from "@/domain/types";
import type { SavedView } from "@/domain/views";
import { isoModelFromState, layoutIso } from "../iso/model";
import { amrPaths } from "./amr-paths";
import { usePalette } from "./palette";
import { Scene } from "./twin-3d";

/** Points the camera from the saved position at the saved target. */
function Aim({ view }: { view: SavedView }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    camera.position.set(...view.position);
    camera.lookAt(new THREE.Vector3(...view.target));
    camera.updateProjectionMatrix();
  }, [camera, view]);
  return null;
}

const noop = () => undefined;
const all = () => true;

/**
 * A virtual camera: the 3D twin rendered live from a saved viewpoint. Machines move, belts run and
 * robots drive exactly as in the 3D view. Standard quality and a capped pixel ratio keep several
 * of these affordable on one wall.
 */
export function VirtualCameraFeed({ state, view }: { state: FactoryState; view: SavedView }) {
  const pal = usePalette();
  const model = useMemo(() => isoModelFromState(state, {}, { cameras: true }), [state]);
  const layout = useMemo(() => layoutIso(model), [model]);
  const paths = useMemo(() => amrPaths(layout, amrFleet(state), state.lines.map((l) => l.id)), [layout, state]);
  const flows = useMemo(() => lineFlows(state), [state]);
  const plantRef = useRef<THREE.Group | null>(null);
  if (!pal) return <div className="h-full w-full bg-black" />;
  return (
    <Canvas
      dpr={[1, 1]}
      camera={{ fov: 38, near: 0.1, far: 400, position: view.position }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
      }}
      aria-label={`Virtual camera ${view.name}`}
    >
      <Aim view={view} />
      <Scene
        pal={pal}
        quality="standard"
        layout={layout}
        paths={paths}
        selectedId={null}
        onSelect={noop}
        cameras={false}
        affected={all}
        highlight={null}
        registerAmr={noop}
        flows={flows}
        plantRef={plantRef}
        facility={{ id: state.profile.id, name: state.profile.name }}
      />
    </Canvas>
  );
}
