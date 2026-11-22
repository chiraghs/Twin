"use client";

import { create } from "zustand";

/**
 * Recording aids for the demo video (Shift + C): an EXISTING / NEW badge per screen and large
 * captions of what was said and answered by voice. Off by default; nothing is stored.
 */
interface RecordingStore {
  on: boolean;
  heard: string | null;
  reply: string | null;
  toggle: () => void;
  caption: (heard: string | null, reply: string | null) => void;
}

export const useRecording = create<RecordingStore>((set) => ({
  on: false,
  heard: null,
  reply: null,
  toggle: () => set((s) => ({ on: !s.on })),
  caption: (heard, reply) => set({ heard, reply }),
}));
