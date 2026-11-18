import * as THREE from "three";
import type { FactoryState } from "@/domain/types";

/**
 * Downloads the plant as a binary glTF (.glb). Every machine and conveyor carries Twin metadata in
 * its glTF `extras` (type, asset id, kind, line, status), so the file opens in any 3D tool and can
 * be traced back to the twin.
 */
export async function exportPlantGlb(root: THREE.Object3D, state: FactoryState) {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  root.updateMatrixWorld(true);
  root.userData = {
    ...root.userData,
    twin: { ...(root.userData.twin ?? {}), exportedAt: new Date().toISOString(), simHour: Math.round(state.clock.hour * 100) / 100, machines: state.assets.length, lines: state.lines.length },
  };
  const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
  const blob = new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
  const slug = (state.profile.name || "plant").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${slug || "plant"}-twin.glb`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
