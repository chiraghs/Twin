import type { AssetKind } from "./types";

/**
 * Machine axes for commissioning: the drives an engineer jogs by hand to check motion, limits and
 * clearances. Values are in engineering units; the 3D twin moves to them in manual mode.
 */
export interface AxisDef {
  id: string;
  name: string;
  type: "rotary" | "linear" | "gripper";
  unit: "°" | "mm" | "%";
  min: number;
  max: number;
  home: number;
  /** One jog increment. */
  step: number;
  /** Rotary axes with no end stops wrap around instead of stopping at a limit. */
  endless?: boolean;
}

const ROBOT: AxisDef[] = [
  { id: "J1", name: "J1 base", type: "rotary", unit: "°", min: -170, max: 170, home: 0, step: 5 },
  { id: "J2", name: "J2 shoulder", type: "rotary", unit: "°", min: -60, max: 60, home: 0, step: 5 },
  { id: "J3", name: "J3 elbow", type: "rotary", unit: "°", min: -90, max: 90, home: 0, step: 5 },
  { id: "J4", name: "J4 wrist", type: "rotary", unit: "°", min: -90, max: 90, home: 0, step: 5 },
  { id: "GRIP", name: "Gripper", type: "gripper", unit: "%", min: 0, max: 100, home: 50, step: 10 },
];
const RAM: AxisDef[] = [{ id: "Z", name: "Z ram", type: "linear", unit: "mm", min: 0, max: 120, home: 0, step: 10 }];
const SPINDLE: AxisDef[] = [{ id: "C", name: "Spindle angle", type: "rotary", unit: "°", min: 0, max: 360, home: 0, step: 15, endless: true }];
const SHUTTLE: AxisDef[] = [{ id: "X", name: "X carriage", type: "linear", unit: "mm", min: -100, max: 100, home: 0, step: 10 }];

const AXES: Partial<Record<AssetKind, AxisDef[]>> = {
  robot: ROBOT,
  press: RAM,
  welder: RAM,
  molder: RAM,
  cnc: SPINDLE,
  mixer: SPINDLE,
  extruder: SPINDLE,
  pump: SPINDLE,
  packager: SHUTTLE,
  labeler: SHUTTLE,
  filler: SHUTTLE,
  palletizer: SHUTTLE,
};

/** The jog-able axes of a machine type (none for conveyors, cameras, ovens, workstations). */
export function machineAxes(kind: AssetKind): AxisDef[] {
  return AXES[kind] ?? [];
}

/** Home position of every axis. */
export function homePose(kind: AssetKind): Record<string, number> {
  return Object.fromEntries(machineAxes(kind).map((a) => [a.id, a.home]));
}

/** Move an axis by `delta`, stopping at its limits (or wrapping, for endless rotary axes). */
export function jogAxis(axis: AxisDef, value: number, delta: number): number {
  const v = value + delta;
  if (axis.endless) {
    const span = axis.max - axis.min;
    return Math.round((((((v - axis.min) % span) + span) % span) + axis.min) * 100) / 100;
  }
  return Math.round(Math.min(axis.max, Math.max(axis.min, v)) * 100) / 100;
}

/** True when the value sits on a limit switch (never for endless axes). */
export const atLimit = (axis: AxisDef, value: number) => !axis.endless && (value <= axis.min || value >= axis.max);
