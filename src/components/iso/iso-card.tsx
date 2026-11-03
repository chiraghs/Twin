"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { FactoryState } from "@/domain/types";
import type { Highlight } from "@/client/store";
import { IsoScene } from "./iso-scene";
import { isoModelFromState } from "./model";

/** Compact, read-only isometric twin. Clicking a machine opens it in the Twin Studio. */
export function IsoMini({ state, highlight, orderRisk, className }: { state: FactoryState; highlight?: Highlight | null; orderRisk?: Record<string, boolean>; className?: string }) {
  const router = useRouter();
  const tick = state.clock.tick;
  const model = useMemo(() => isoModelFromState(state, orderRisk), [state, tick, orderRisk]); // eslint-disable-line react-hooks/exhaustive-deps
  const iso = useMemo(
    () =>
      highlight
        ? { assetIds: highlight.assetIds, lineIds: highlight.lineIds, targetAssetId: highlight.targetAssetId, rerouteLineId: highlight.rerouteLineId, targetLabel: highlight.kind === "continue" ? "runs to predicted trip" : "maintenance window" }
        : null,
    [highlight],
  );
  return (
    <IsoScene
      model={model}
      highlight={iso}
      labels="smart"
      onSelect={(id) => router.push(id.includes(":") ? "/twin" : `/twin?asset=${id}`)}
      className={className ?? "h-full w-full"}
    />
  );
}
