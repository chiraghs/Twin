import type { AssetStatus, MobileRobot } from "@/domain/types";

/** Display names shared by every view, so the same thing is called the same everywhere. */

export const ROBOT_TYPE: Record<MobileRobot["robotType"], { name: string; short: string }> = {
  amr: { name: "Autonomous mobile robot", short: "AMR" },
  agv: { name: "Automated guided vehicle", short: "AGV" },
  "forklift-agv": { name: "Automated forklift", short: "Forklift AGV" },
  tugger: { name: "Tugger train", short: "Tugger" },
};

export const MISSION: Record<MobileRobot["mission"], { route: string; description: string; chip: string }> = {
  kitting: { route: "Kitting: stores → line", description: "Line-side kitting", chip: "kitting" },
  "line-transfer": { route: "Transfer: line → packing", description: "Product to the packing line", chip: "transfer" },
  "finished-goods": { route: "Finished goods: packing → dock", description: "Finished goods to dock", chip: "pallets" },
};

/** Status colours as hex, for canvases and WebGL, which can't read CSS variables. */
export const STATUS_COLOR: Record<AssetStatus, string> = {
  healthy: "#10b981",
  warning: "#f59e0b",
  critical: "#ef4444",
  offline: "#64748b",
  maintenance: "#818cf8",
};

/** Lens tint per camera kind in the isometric and 3D views. */
export const CAMERA_LENS_COLOR: Record<string, string> = { area: "#38bdf8", inspection: "#4c8dff", thermal: "#fb923c", dock: "#38bdf8" };
