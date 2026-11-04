"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Boxes, LineChart, Lock, RefreshCw, ScanEye, Settings2, Wrench } from "lucide-react";
import { useAdmin } from "@/client/admin";
import { saveFeatureConfig, toggleFeature, useJson, type FeatureRow, type FeaturesPayload } from "@/client/intelligence";
import { useFactory } from "@/client/store";
import { AdminAccess } from "@/components/admin/admin-access";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Label, Select, Switch } from "@/components/ui/primitives";
import type { FeatureId } from "@/domain/intelligence";

const ICON: Record<FeatureId, React.ReactNode> = {
  maintenance: <Wrench className="h-4 w-4" />,
  supply: <Boxes className="h-4 w-4" />,
  demand: <LineChart className="h-4 w-4" />,
  vision: <ScanEye className="h-4 w-4" />,
};

const WHAT: Record<FeatureId, { does: string; reaches: string }> = {
  maintenance: {
    does: "Runs the backend's ISO 10816-3 classification, health score and remaining-useful-life estimate on every running machine, using its own alarm and trip limits.",
    reaches: "Maintenance agent evidence · Maintenance analytics · “Propose preventive maintenance” → Approvals → work order",
  },
  supply: {
    does: "Days of supply and stock-out countdown per material and line from on-hand stock, the plan's consumption rate and inbound deliveries; sizes purchase orders.",
    reaches: "Supply agent evidence · Supply analytics · “Propose purchase order” → Approvals → inbound delivery",
  },
  demand: {
    does: "P10/P50/P90 forecasts per product against a seasonal-naive baseline, with capacity headroom and order coverage. History is generated from the plant's capacity and product mix (labelled simulated).",
    reaches: "Production agent evidence · Demand analytics",
  },
  vision: {
    does: "AOI inspection of product images from the plant's inspection cameras: Muse Spark + SAM 3.1 defects, OpenCV golden comparison, IPC-A-610 verdict rules. Without MODEL_API_KEY the reference detector runs.",
    reaches: "Visual Quality reviews (human decision) · Quality agent evidence · Quality analytics",
  },
};

export default function FeaturesPage() {
  const admin = useAdmin((s) => s.admin);
  const toast = useFactory((s) => s.toast);
  const { data, error, reload } = useJson<FeaturesPayload>("/api/intelligence", 10_000);
  const [busy, setBusy] = useState<FeatureId | null>(null);

  const toggle = async (f: FeatureRow, on: boolean) => {
    setBusy(f.id);
    try {
      const r = await toggleFeature(f.id, on);
      await reload();
      toast({
        tone: r.sync && !r.sync.ok ? "error" : "success",
        title: `${f.name} ${on ? "on" : "off"}`,
        detail: on ? (r.sync?.error ?? (r.sync?.featureErrors?.[f.id] || "Synced with the intelligence backend.")) : "Its analytics and agent evidence stop.",
      });
    } catch (e) {
      toast({ tone: "error", title: "Could not change the feature", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Features"
        description="The four intelligence features run on this plant through the Python backend. All are off by default; when one is on, the plant is synced every 15 s and its results reach the agents, Approvals and its Analytics page. Nothing changes the plant without a person's approval."
        actions={
          <>
            <AdminAccess />
            <Button size="sm" variant="secondary" onClick={() => reload()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </>
        }
      />
      {error && <p className="mb-3 text-[12px] text-critical-ink">{error}</p>}
      {data && (
        <Card className="mb-3">
          <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-1.5 py-3 text-[12.5px]">
            <span className="text-muted">Plant</span>
            <span className="font-medium text-ink">{data.facilityName}</span>
            <span className="text-muted">Backend</span>
            {data.backend.configured ? <span className="font-mono text-[11.5px] text-ink-2">{data.backend.url}</span> : <Badge tone="warning">not configured</Badge>}
            <span className="text-muted">Last sync</span>
            {data.sync ? (
              <span className={data.sync.ok ? "text-ink-2" : "text-critical-ink"}>
                {new Date(data.sync.at).toLocaleTimeString()} · plant h{data.sync.simHour.toFixed(1)} · {data.sync.durationMs} ms{data.sync.error ? ` · ${data.sync.error}` : ""}
              </span>
            ) : (
              <span className="text-muted">none yet</span>
            )}
            {!admin && (
              <span className="ml-auto flex items-center gap-1.5 text-muted">
                <Lock className="h-3.5 w-3.5" /> Unlock admin to change features
              </span>
            )}
          </CardBody>
        </Card>
      )}
      <div className="grid items-start gap-3 xl:grid-cols-2">
        {!data && Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-48 animate-pulse rounded-xl bg-surface" />)}
        {data?.features.map((f) => <FeatureCard key={f.id} f={f} admin={admin} busy={busy === f.id} onToggle={(on) => toggle(f, on)} />)}
      </div>
    </div>
  );
}

function FeatureCard({ f, admin, busy, onToggle }: { f: FeatureRow; admin: boolean; busy: boolean; onToggle: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader
        title={f.name}
        icon={ICON[f.id]}
        description={WHAT[f.id].does}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={f.enabled ? (f.error ? "critical" : "healthy") : "neutral"}>{f.enabled ? (f.error ? "error" : "on") : "off"}</Badge>
            <Switch checked={f.enabled} disabled={!admin || busy} onCheckedChange={onToggle} aria-label={`${f.name} on or off`} />
          </div>
        }
      />
      <CardBody className="space-y-2.5 text-[12.5px]">
        <p className="text-muted">
          <span className="font-medium text-ink-2">Reaches: </span>
          {WHAT[f.id].reaches}
        </p>
        {f.error && <p className="rounded-lg border border-critical/40 bg-critical/8 p-2 text-[12px] text-critical-ink">{f.error}</p>}
        {f.enabled && f.counts && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(f.counts).map(([k, v]) => (
              <Badge key={k} tone="neutral">
                {k.replace(/([A-Z])/g, " $1").toLowerCase()}: {v}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {f.enabled && (
            <Link href={f.analyticsHref} className="inline-flex h-8 items-center rounded-lg border border-line bg-surface-2 px-3 text-[12.5px] font-medium text-ink hover:bg-surface-3">
              Open analytics
            </Link>
          )}
          <Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>
            <Settings2 className="h-3.5 w-3.5" /> {open ? "Hide settings" : "Settings"}
          </Button>
        </div>
        {open && <FeatureConfig feature={f.id} admin={admin} />}
      </CardBody>
    </Card>
  );
}

type Json = Record<string, unknown>;

function FeatureConfig({ feature, admin }: { feature: FeatureId; admin: boolean }) {
  const toast = useFactory((s) => s.toast);
  const { data, error, reload } = useJson<{ config: Json; history: { changed_at: string; changed_by: string | null }[] }>(`/api/intelligence/${feature}/config`);
  const [draft, setDraft] = useState<Json>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) setDraft(data.config);
  }, [data]);
  if (error) return <EmptyState title="Settings unavailable" description={error} />;
  if (!data) return <div className="h-24 animate-pulse rounded-lg bg-surface-2" />;

  const save = async () => {
    setSaving(true);
    try {
      await saveFeatureConfig(feature, draft);
      await reload();
      toast({ tone: "success", title: "Settings saved", detail: "Saved in SQLite with change history; results are recomputed." });
    } catch (e) {
      toast({ tone: "error", title: "Settings not saved", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const used = USED_HERE[feature];
  const entries = Object.entries(draft).sort(([a], [b]) => Number(used.includes(b)) - Number(used.includes(a)));
  return (
    <div className="space-y-2 rounded-lg border border-line p-2.5">
      <p className="text-[11.5px] text-muted">{NOTE[feature]}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <Field key={k} name={k} value={v} used={used.includes(k)} disabled={!admin} onChange={(nv) => setDraft((d) => ({ ...d, [k]: nv }))} />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted">
          {data.history[0] ? `Last changed ${new Date(data.history[0].changed_at).toLocaleString()}${data.history[0].changed_by ? ` by ${data.history[0].changed_by}` : ""}` : "Defaults (no changes yet)"}
        </p>
        <Button size="sm" variant="primary" disabled={!admin} loading={saving} onClick={save}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

/** Settings the twin bridge reads for this plant; the rest only affect the backend's demo plants. */
const USED_HERE: Record<FeatureId, string[]> = {
  maintenance: ["vibration_damage_weight", "temperature_damage_weight", "imminent_trip_hours_threshold"],
  supply: ["critical_days_of_supply_threshold", "min_recommended_po_qty"],
  demand: ["default_horizon_weeks", "capacity_warning_threshold_pct"],
  vision: ["golden_similarity_threshold"],
};

const NOTE: Record<FeatureId, string> = {
  maintenance: "For this plant, ISO zones, the trip limit and temperatures come from each machine's own alarm and trip limits. Settings marked “used here” change this plant's results.",
  supply: "For this plant, costs and lead times come from the material master. Settings marked “used here” change this plant's results.",
  demand: "Settings marked “used here” change this plant's forecasts (recomputed once per plant day, or right after saving).",
  vision: "Settings marked “used here” change this plant's AOI verdicts.",
};

function Field({ name, value, used, disabled, onChange }: { name: string; value: unknown; used?: boolean; disabled: boolean; onChange: (v: unknown) => void }) {
  const id = `cfg-${name}`;
  const label = (
    <>
      {name.replace(/_/g, " ")}
      {used === true && <Badge tone="accent" className="ml-1.5">used here</Badge>}
      {used === false && <span className="ml-1.5 text-[10.5px] font-normal text-muted">(demo plants only)</span>}
    </>
  );
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Json;
    return (
      <fieldset className="space-y-1.5 rounded-md border border-line/70 p-2 sm:col-span-2">
        <legend className="px-1 text-[11px] font-medium text-muted">{label}</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(obj).map(([k, v]) => (
            <Field key={k} name={k} value={v} disabled={disabled} onChange={(nv) => onChange({ ...obj, [k]: nv })} />
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {typeof value === "boolean" ? (
        <Select id={id} className="w-full" value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value === "true")}>
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
      ) : (
        <Input
          id={id}
          type={typeof value === "number" ? "number" : "text"}
          step="any"
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(typeof value === "number" ? Number(e.target.value) : e.target.value)}
        />
      )}
    </div>
  );
}
