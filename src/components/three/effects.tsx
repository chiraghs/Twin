"use client";

import { Bloom, EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

/** High-quality post-processing: soft ambient occlusion and bloom on lights and screens. Loaded only when used. */
export default function Effects() {
  return (
    <EffectComposer multisampling={4}>
      <N8AO aoRadius={0.55} intensity={2.4} distanceFalloff={0.7} halfRes />
      <Bloom mipmapBlur luminanceThreshold={1} intensity={0.6} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
