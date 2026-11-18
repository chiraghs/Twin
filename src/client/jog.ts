"use client";

import { create } from "zustand";
import { homePose, jogAxis, machineAxes } from "@/domain/axes";
import type { AssetKind } from "@/domain/types";

/**
 * Manual (jog) mode for machine axes in the twin. While a machine is in manual mode its 3D model
 * follows these axis values instead of its automatic cycle. Twin-only: nothing reaches equipment.
 */
interface JogStore {
  manual: Record<string, Record<string, number>>;
  enter: (assetId: string, kind: AssetKind) => void;
  leave: (assetId: string) => void;
  jog: (assetId: string, kind: AssetKind, axisId: string, delta: number) => void;
  set: (assetId: string, kind: AssetKind, axisId: string, value: number) => void;
  home: (assetId: string, kind: AssetKind) => void;
}

export const useJog = create<JogStore>((set) => ({
  manual: {},
  enter: (id, kind) => set((s) => (s.manual[id] ? s : { manual: { ...s.manual, [id]: homePose(kind) } })),
  leave: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.manual;
      return { manual: rest };
    }),
  jog: (id, kind, axisId, delta) =>
    set((s) => {
      const pose = s.manual[id];
      const axis = machineAxes(kind).find((a) => a.id === axisId);
      if (!pose || !axis) return s;
      return { manual: { ...s.manual, [id]: { ...pose, [axisId]: jogAxis(axis, pose[axisId] ?? axis.home, delta) } } };
    }),
  set: (id, kind, axisId, value) =>
    set((s) => {
      const pose = s.manual[id];
      const axis = machineAxes(kind).find((a) => a.id === axisId);
      if (!pose || !axis) return s;
      return { manual: { ...s.manual, [id]: { ...pose, [axisId]: jogAxis(axis, value, 0) } } };
    }),
  home: (id, kind) => set((s) => (s.manual[id] ? { manual: { ...s.manual, [id]: homePose(kind) } } : s)),
}));
