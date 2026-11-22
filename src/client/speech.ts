"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Voice settings for the VR plant, remembered on this device: `muted` silences everything the
 * plant says; `micOff` disables push-to-talk entirely.
 */
interface VoiceSettings {
  muted: boolean;
  micOff: boolean;
  setMuted: (m: boolean) => void;
  setMicOff: (m: boolean) => void;
}

export const useVoiceSettings = create<VoiceSettings>()(
  persist(
    (set) => ({
      muted: false,
      micOff: false,
      setMuted: (muted) => {
        if (muted) stopSpeaking();
        set({ muted });
      },
      setMicOff: (micOff) => set({ micOff }),
    }),
    { name: "twin-vr-voice", storage: createJSONStorage(() => localStorage) },
  ),
);

const synth = () => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

let voice: SpeechSynthesisVoice | null = null;
function pickVoice() {
  const s = synth();
  if (!s || voice) return voice;
  const all = s.getVoices();
  voice = all.find((v) => /en[-_](US|GB|IN)/i.test(v.lang) && /natural|neural|google|samantha|daniel/i.test(v.name)) ?? all.find((v) => /^en/i.test(v.lang)) ?? null;
  return voice;
}

/** Say something (unless muted). Replaces whatever is being said. Keeps it short: first ~2 sentences. */
export function speak(text: string, opts: { maxSentences?: number } = {}) {
  const s = synth();
  if (!s || useVoiceSettings.getState().muted || !text.trim()) return;
  const clean = text
    .replace(/\[R\d+\]/g, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\bh\+(\d+)/g, "in $1 hours")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = clean.match(/[^.!?]+[.!?]?/g) ?? [clean];
  const say = sentences.slice(0, opts.maxSentences ?? 2).join(" ").trim();
  s.cancel();
  const u = new SpeechSynthesisUtterance(say);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.05;
  s.speak(u);
}

export function stopSpeaking() {
  synth()?.cancel();
}

export const speechAvailable = () => !!synth();
