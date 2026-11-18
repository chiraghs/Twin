/**
 * Saved 3D viewpoints. A "view" is a camera position you can fly back to from the 3D twin (a
 * bookmark); a "camera" is a virtual camera: the same viewpoint rendered live as a feed on the
 * CCTV control-room wall.
 */

export type Vec3 = [number, number, number];
export type SavedViewKind = "view" | "camera";

export interface SavedView {
  id: string;
  facilityId: string;
  name: string;
  kind: SavedViewKind;
  position: Vec3;
  target: Vec3;
  createdAt: string;
  createdBy: string;
}

export const VIEW_LIMIT = 24;
/** Live virtual-camera feeds each need their own WebGL context, so the wall shows at most this many. */
export const LIVE_CAMERA_LIMIT = 4;

const finite = (v: Vec3) => v.every((n) => Number.isFinite(n));

/** A pose is usable if both points are finite and the camera isn't sitting on its target. */
export function validPose(position: Vec3, target: Vec3): boolean {
  if (!finite(position) || !finite(target)) return false;
  const d = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]);
  return d > 0.1 && d < 1000;
}
