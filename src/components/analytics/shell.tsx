"use client";

import Link from "next/link";
import { PowerOff, RefreshCw } from "lucide-react";
import { useJson } from "@/client/intelligence";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, EmptyState } from "@/components/ui/primitives";
import { FEATURE_META, type FeatureId } from "@/domain/intelligence";

export interface AnalyticsPayload<I> {
  feature: FeatureId;
  enabled: boolean;
  facilityName: string;
  simHour: number;
  sync: { synced_at: string; sim_hour: number } | null;
  insights: I | null;
  series?: Record<string, number | string>[];
  message?: string;
}

/**
 * Frame of an Analytics page: loads the feature's data (refreshing every 15 s), and shows
 * clear states when the feature is off, the backend is unreachable or nothing is computed yet.
 */
export function AnalyticsShell<I>({
  feature,
  title,
  description,
  children,
}: {
  feature: FeatureId;
  title: string;
  description: string;
  children: (data: AnalyticsPayload<I> & { insights: I }, reload: () => Promise<void>) => React.ReactNode;
}) {
  const { data, error, loading, reload } = useJson<AnalyticsPayload<I>>(`/api/intelligence/${feature}/analytics`, 15_000);
  const engine = (data?.insights as { engine?: string } | null)?.engine;
  return (
    <div className="animate-fade-in">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button size="sm" variant="secondary" loading={loading} onClick={() => reload()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />
      {data?.enabled === false ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<PowerOff className="h-5 w-5" />}
              title={`${FEATURE_META[feature].name} is off`}
              description="All four intelligence features are off by default. An admin can turn this one on in Admin → Features; the plant is then synced to the intelligence backend and this page fills in."
              action={
                <Link href="/features" className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white hover:bg-accent-strong">
                  Open Features
                </Link>
              }
            />
          </CardBody>
        </Card>
      ) : error && !data ? (
        <Card>
          <CardBody>
            <EmptyState title="Analytics unavailable" description={`${error} Check Integrations → Intelligence backend.`} />
          </CardBody>
        </Card>
      ) : !data ? (
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`h-28 animate-pulse rounded-xl bg-surface ${i >= 4 ? "md:col-span-2 h-64" : ""}`} />
          ))}
        </div>
      ) : !data.insights ? (
        <Card>
          <CardBody>
            <EmptyState title="No results yet" description="The plant hasn't been synced for this feature yet. It syncs every 15 s while the twin is open." />
          </CardBody>
        </Card>
      ) : (
        <>
          <p className="mb-3 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
            <Badge tone="agent">Intelligence backend</Badge>
            {data.facilityName}
            {data.sync && <span>· synced {new Date(data.sync.synced_at).toLocaleTimeString()} at plant h{data.sync.sim_hour.toFixed(1)}</span>}
            {engine && <span>· {engine}</span>}
            {error && <span className="text-critical-ink">· refresh failed: {error}</span>}
          </p>
          {children(data as AnalyticsPayload<I> & { insights: I }, reload)}
        </>
      )}
    </div>
  );
}

/** Hours as "4.2 h" / "38 h" / "—". */
export const fmtHours = (h: number | null | undefined) => (h == null ? "—" : h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h)} h`);

export const RISK_TONE = { high: "critical", medium: "warning", low: "healthy", "n/a": "neutral" } as const;
