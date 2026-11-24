"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useFactory, useUi } from "@/client/store";
import { ASSET_TABS, AssetPanel, type AssetTab } from "@/components/assets/asset-panel";

/**
 * One machine's panel (Overview, Telemetry, History, Links, Docs, Configure) as a page of its own:
 * the same panel the 3D view opens beside a clicked machine. The VR headset shows it in its website
 * window ("Details"); `?tab=telemetry` opens a tab directly.
 */
function AssetDetail() {
  const { id } = useParams<{ id: string }>();
  const tabParam = useSearchParams().get("tab");
  const router = useRouter();
  const state = useFactory((s) => s.state);
  const asset = state?.assets.find((a) => a.id === decodeURIComponent(id)) ?? null;
  const tab: AssetTab = ASSET_TABS.includes(tabParam as AssetTab) ? (tabParam as AssetTab) : "overview";

  // The Links tab selects a neighbouring machine: open its page (the headset follows the path).
  const selected = useUi((s) => s.selectedAssetId);
  const first = useRef(selected);
  useEffect(() => {
    if (selected === first.current) return;
    first.current = selected;
    if (selected && selected !== asset?.id) router.push(`/assets/${encodeURIComponent(selected)}`);
  }, [selected, asset?.id, router]);

  if (!state) return null;
  if (!asset)
    return (
      <div className="p-8 text-center text-[13px] text-muted">
        No machine {decodeURIComponent(id)} in this plant.{" "}
        <Link href="/assets" className="text-accent hover:underline">
          All assets
        </Link>
      </div>
    );
  return (
    <div className="mx-auto h-[calc(100dvh-24px)] max-w-2xl overflow-hidden rounded-xl border border-line bg-surface [[data-vr-embed]_&]:max-w-none">
      <AssetPanel key={`${asset.id}:${tab}`} state={state} asset={asset} initialTab={tab} />
    </div>
  );
}

export default function AssetDetailPage() {
  return (
    <Suspense fallback={null}>
      <AssetDetail />
    </Suspense>
  );
}
