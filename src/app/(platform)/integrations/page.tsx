"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleSlash,
  Cloud,
  Copy,
  Cpu,
  Database,
  FileText,
  HardDrive,
  KeyRound,
  Loader2,
  Network,
  PlugZap,
  Power,
  Radio,
  RotateCcw,
  ScanEye,
  Server,
  Settings2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useAdmin } from "@/client/admin";
import type { ApiError } from "@/client/api";
import { INTEGRATION_STATE, saveIntegrationSettings, testIntegration, useIntegrations, type Integration, type IntegrationsPayload, type SettingsStorage, type SettingView } from "@/client/integrations";
import { useFactory } from "@/client/store";
import { AdminAccess } from "@/components/admin/admin-access";
import { CONNECTION_META } from "@/components/builder/panels";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Select, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const STATE_ICON: Record<Integration["state"], typeof CheckCircle2> = {
  connected: CheckCircle2,
  active: Power,
  "active-simulated": Cpu,
  "configured-untested": KeyRound,
  "not-configured": CircleSlash,
  error: XCircle,
};
const STATE = (s: Integration["state"]) => ({ ...INTEGRATION_STATE[s], Icon: STATE_ICON[s] });

const ICON: Record<string, typeof Cloud> = {
  telemetry: Radio,
  "meta-ai": Sparkles,
  bigquery: Database,
  pubsub: Radio,
  gcs: FileText,
  mqtt: Server,
  persistence: HardDrive,
  "cloud-run": Cloud,
  "vision-service": ScanEye,
  mcp: Network,
};

/** Settings that apply to the selected AI provider (the others are hidden, not cleared). */
function relevant(settings: SettingView[], provider?: string | null) {
  const p = provider ?? (() => {
    const s = settings.find((x) => x.key === "AI_PROVIDER");
    return s ? s.value || s.defaultValue : null;
  })();
  return settings.filter((s) => !s.providers || !p || s.providers.includes(p));
}

const SOURCE_LABEL: Record<SettingView["source"], string> = { ui: "set here", environment: "from deployment", unset: "not set" };

/** Settings whose value switches an integration on; clearing them turns it off. */
const SWITCHES = new Set(["VISION_SERVICE_URL", "BIGQUERY_DATASET", "PUBSUB_TELEMETRY_SUBSCRIPTION", "GCS_BUCKET", "MQTT_BROKER_URL"]);

/** Pending edits: a string sets a value ("" turns it off), null returns it to the deployment value. */
type Edits = Record<string, string | null>;

export default function IntegrationsPage() {
  const toast = useFactory((s) => s.toast);
  const admin = useAdmin((s) => s.admin);
  const { data, error, reload: load, setData } = useIntegrations();
  const [testing, setTesting] = useState<string | null>(null);

  const test = async (id: string) => {
    setTesting(id);
    try {
      const d = await testIntegration(id);
      setData((cur: IntegrationsPayload | null) => (cur ? { ...cur, integrations: d.integrations } : cur));
      toast({ tone: d.result.ok ? "success" : "error", title: d.result.ok ? "Connection verified" : "Connection test failed", detail: d.result.detail });
    } catch (e) {
      toast({ tone: "error", title: "Test request failed", detail: String(e) });
    } finally {
      setTesting(null);
    }
  };

  /** Save edits; returns true on success. */
  const save = async (values: Edits) => {
    let d: Awaited<ReturnType<typeof saveIntegrationSettings>>;
    try {
      d = await saveIntegrationSettings(values);
    } catch (e) {
      const err = e as ApiError;
      toast({ tone: "error", title: err.message || "Save failed", detail: err.issues?.join("; ") });
      return false;
    }
    await load();
    toast({ tone: "success", title: d.changed?.length ? `Saved ${d.changed.length} setting${d.changed.length > 1 ? "s" : ""}` : "No changes", detail: d.changed?.length ? "Connection checks for the affected integrations were reset. Test them again to verify." : undefined });
    return true;
  };

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Integrations & Data Sources"
        description="Turn integrations on, point them at your services and test them, all from here. Secrets are stored on the server and never shown again; an integration shows Connected only after a real call succeeds."
        actions={
          <>
            <AdminAccess />
            <Button size="sm" variant="secondary" onClick={() => load()}>
              <PlugZap className="h-3.5 w-3.5" /> Refresh status
            </Button>
          </>
        }
      />
      {error && <p className="mb-3 text-[12px] text-critical-ink">{error}</p>}
      {data && <PlatformStrip project={data.project} storage={data.storage} admin={admin} onSave={save} />}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {!data && Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-surface" />)}
        {data?.integrations.map((i) => <IntegrationCard key={i.id} item={i} admin={admin} testing={testing} onTest={test} onSave={save} />)}
      </div>

      <PlannedConnections />

      <Card className="mt-4">
        <CardHeader title="Google Cloud architecture" description="How each service maps onto the platform" icon={<Cloud className="h-4 w-4" />} />
        <CardBody>
          <div className="grid gap-3 text-[12.5px] md:grid-cols-2 xl:grid-cols-3">
            {[
              ["Cloud Run", "Hosts the Next.js app (UI + API) through Firebase App Hosting, and the Python vision service."],
              ["Meta Model API · Muse", "Muse Wonder writes decision briefings; Muse Spark runs the multi-agent copilot, Twin Builder research and footage review; SAM 3.1 segments drawings and defects; Muse Image and Muse Voice power generation and speech-to-twin. Every answer is schema-checked and its figures are checked against the twin."],
              ["BigQuery", "Telemetry, production events, health history, scenario outcomes and decisions."],
              ["Pub/Sub", "Live telemetry ingestion: published machine readings drive the twin."],
              ["Cloud Storage", "Asset manuals and inspection reports, and the settings saved on this page."],
              ["Secret Manager", "Holds the admin passcode for this deployment."],
              ["Plant model", "The engine behind every number in the twin; always available."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-xl border border-line bg-shell/60 p-3">
                <p className="font-semibold text-ink">{t}</p>
                <p className="mt-1 text-ink-2">{d}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function PlatformStrip({ project, storage, admin, onSave }: { project: SettingView; storage: SettingsStorage; admin: boolean; onSave: (v: Edits) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.value ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(project.value ?? ""), [project.value]);
  return (
    <Card className="mb-3">
      <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-3 pb-3 text-[12.5px]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted">Google Cloud project</span>
          {editing ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                if (await onSave({ GOOGLE_CLOUD_PROJECT: value.trim() })) setEditing(false);
                setBusy(false);
              }}
            >
              <Input aria-label="Google Cloud project" className="h-7 w-48 font-mono text-[12px]" value={value} placeholder={project.placeholder ?? ""} onChange={(e) => setValue(e.target.value)} />
              <Button size="xs" variant="primary" loading={busy} type="submit">
                Save
              </Button>
              {project.source === "ui" && (
                <Button
                  size="xs"
                  variant="ghost"
                  type="button"
                  onClick={async () => {
                    setBusy(true);
                    if (await onSave({ GOOGLE_CLOUD_PROJECT: null })) setEditing(false);
                    setBusy(false);
                  }}
                >
                  Use deployment value
                </Button>
              )}
              <Button size="xs" variant="ghost" type="button" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </form>
          ) : (
            <>
              <span className="font-mono text-ink">{project.value || "—"}</span>
              <SourceChip source={project.source} />
              {admin && (
                <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
                  Change
                </Button>
              )}
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-muted">Settings</span>
          <Badge tone={!storage.ok ? "critical" : storage.kind === "cloud-storage" ? "healthy" : "neutral"}>{!storage.ok ? "not saved" : storage.kind === "cloud-storage" ? "saved to Cloud Storage" : "saved on this server"}</Badge>
          {storage.updatedAt && (
            <span className="text-[11.5px] text-muted">
              last change {new Date(storage.updatedAt).toLocaleString()}
              {storage.updatedBy ? ` by ${storage.updatedBy}` : ""}
            </span>
          )}
          {storage.detail && !storage.ok && <span className="text-[11.5px] text-critical-ink">{storage.detail}</span>}
        </div>
      </CardBody>
    </Card>
  );
}

function SourceChip({ source }: { source: SettingView["source"] }) {
  return (
    <span className={cn("rounded border px-1.5 py-px text-[10.5px]", source === "ui" ? "border-accent/40 text-accent-ink" : source === "environment" ? "border-healthy/40 text-healthy-ink" : "border-line text-muted")}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

function IntegrationCard({ item: i, admin, testing, onTest, onSave }: { item: Integration; admin: boolean; testing: string | null; onTest: (id: string) => void; onSave: (v: Edits) => Promise<boolean> }) {
  const S = STATE(i.state);
  const Icon = ICON[i.id] ?? PlugZap;
  const [open, setOpen] = useState(false);
  return (
    <Card data-testid={`integration-${i.id}`}>
      <CardBody className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-lg border border-line bg-shell p-2 text-ink-2">
              <Icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[14px] font-semibold text-ink">{i.name}</p>
              <p className="text-[11.5px] text-muted">
                {i.service} · {i.purpose}
              </p>
            </div>
          </div>
          <Badge tone={S.tone}>
            <S.Icon className="h-3 w-3" /> {S.label}
          </Badge>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-2">{i.detail}</p>
        {i.settings.length > 0 && !open && (
          <dl className="mt-3 grid grid-cols-[minmax(0,auto)_1fr] gap-x-3 gap-y-1 text-[11.5px]">
            {relevant(i.settings).map((s) => (
              <div key={s.key} className="contents">
                <dt className="text-muted">{s.label}</dt>
                <dd className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-mono text-ink">{display(s)}</span>
                  <SourceChip source={s.source} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        {open && <SettingsForm item={i} onSave={onSave} onDone={() => setOpen(false)} />}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-[11px] text-muted">
            Fallback: {i.fallback}
            {i.lastCheckedAt && ` · last checked ${new Date(i.lastCheckedAt).toLocaleTimeString()}`}
          </p>
          <div className="flex gap-1.5">
            {i.settings.length > 0 && admin && !open && (
              <Button size="xs" variant="secondary" onClick={() => setOpen(true)} data-testid={`configure-${i.id}`}>
                <Settings2 className="h-3 w-3" /> Configure
              </Button>
            )}
            {i.testable && (
              <Button size="xs" variant="secondary" onClick={() => onTest(i.id)} disabled={testing !== null}>
                {testing === i.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlugZap className="h-3 w-3" />} Test connection
              </Button>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function display(s: SettingView) {
  if (s.secret) return s.isSet ? "••••••••" : "—";
  const v = s.value || s.defaultValue || "";
  if (s.options) return `${s.options.find((o) => o.value === v)?.label ?? (v || "—")}${!s.value && s.defaultValue ? " (default)" : ""}`;
  return v || "—";
}

function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function SettingsForm({ item, onSave, onDone }: { item: Integration; onSave: (v: Edits) => Promise<boolean>; onDone: () => void }) {
  const [edits, setEdits] = useState<Edits>({});
  const [busy, setBusy] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const set = (key: string, v: string | null) => setEdits((e) => ({ ...e, [key]: v }));
  const unset = (key: string) =>
    setEdits((e) => {
      const n = { ...e };
      delete n[key];
      return n;
    });
  const dirty = Object.keys(edits).length > 0;
  const providerEdit = edits.AI_PROVIDER;
  const shown = relevant(item.settings, typeof providerEdit === "string" ? providerEdit : null);

  return (
    <form
      className="mt-3 space-y-3 rounded-xl border border-line bg-shell p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!dirty) return onDone();
        setBusy(true);
        const ok = await onSave(edits);
        setBusy(false);
        if (ok) onDone();
      }}
      data-testid={`settings-form-${item.id}`}
    >
      {shown.map((s) => {
        const id = `set-${item.id}-${s.key}`;
        const edited = s.key in edits;
        const current = edited ? edits[s.key] : undefined;
        return (
          <div key={s.key} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={id}>{s.label}</Label>
              <span className="flex items-center gap-1.5">
                {edited ? (
                  <span className="text-[10.5px] text-warning-ink">{current === null ? "will use deployment value" : current === "" ? "will be turned off" : "changed"}</span>
                ) : (
                  <SourceChip source={s.source} />
                )}
                {s.source === "ui" && !edited && (
                  <button type="button" className="text-muted hover:text-ink" title="Use the deployment's value instead" aria-label={`Reset ${s.label} to the deployment value`} onClick={() => set(s.key, null)}>
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
              </span>
            </div>
            {s.options ? (
              <Select
                id={id}
                className="w-full"
                value={current ?? (s.value || s.defaultValue || "")}
                onChange={(e) => (e.target.value === (s.value || s.defaultValue || "") ? unset(s.key) : set(s.key, e.target.value))}
              >
                {!s.options.some((o) => o.value === (current ?? (s.value || s.defaultValue || ""))) && (
                  <option value={current ?? s.value ?? ""}>{(current ?? s.value) || "Default"}</option>
                )}
                {s.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : s.secret ? (
              <div className="flex gap-1.5">
                <Input
                  id={id}
                  type="password"
                  autoComplete="off"
                  className="font-mono"
                  placeholder={s.isSet ? "Set — type to replace" : "Not set"}
                  value={typeof current === "string" ? current : ""}
                  onChange={(e) => (e.target.value ? set(s.key, e.target.value) : unset(s.key))}
                />
                {item.id === "mcp" && (
                  <Button
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      const t = newToken();
                      setGenerated(t);
                      set(s.key, t);
                    }}
                  >
                    Generate
                  </Button>
                )}
                {s.isSet && (
                  <Button size="sm" type="button" variant="ghost" onClick={() => set(s.key, "")}>
                    Clear
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex gap-1.5">
                <Input
                  id={id}
                  className="font-mono"
                  placeholder={s.placeholder ?? ""}
                  value={typeof current === "string" ? current : (s.value ?? "")}
                  onChange={(e) => (e.target.value === (s.value ?? "") ? unset(s.key) : set(s.key, e.target.value))}
                />
                {s.isSet && SWITCHES.has(s.key) && (
                  <Button size="sm" type="button" variant="ghost" onClick={() => set(s.key, "")} title="Turn this integration off">
                    Turn off
                  </Button>
                )}
              </div>
            )}
            <p className="text-[11px] leading-snug text-muted">{s.help}</p>
            {generated && s.key === "TWIN_MCP_TOKEN" && edits[s.key] === generated && (
              <div className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/5 p-2 text-[11.5px]">
                <code className="min-w-0 flex-1 truncate font-mono text-ink">{generated}</code>
                <Button size="xs" type="button" variant="ghost" onClick={() => void navigator.clipboard?.writeText(generated)}>
                  <Copy className="h-3 w-3" /> Copy
                </Button>
                <span className="text-muted">Copy it now; it won&apos;t be shown again.</span>
              </div>
            )}
          </div>
        );
      })}
      <div className="flex justify-end gap-2">
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" type="submit" variant="primary" loading={busy} disabled={!dirty} data-testid={`save-${item.id}`}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** Data connections planned in the Twin Builder; shown as planned until a connector is configured and verified. */
function PlannedConnections() {
  const plan = useFactory((st) => st.state?.dataPlan);
  if (!plan?.length) return null;
  return (
    <Card className="mt-4">
      <CardHeader title="Planned data connections" description="Connections planned in the Twin Builder. Each becomes live once its connector is set up and verified." icon={<PlugZap className="h-4 w-4" />} />
      <CardBody>
        <ul className="divide-y divide-line">
          {plan.map((c) => {
            const M = CONNECTION_META[c.kind as keyof typeof CONNECTION_META];
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-[12.5px]">
                <Badge tone={M?.status === "active" ? "healthy" : M?.status === "ready" ? "accent" : "neutral"}>{M?.label ?? c.kind}</Badge>
                <span className="text-ink">{c.targetName}</span>
                <span className="font-mono text-[11px] text-muted">{c.target}</span>
                {c.address && <span className="font-mono text-[11px] text-ink-2">{c.address}</span>}
                <span className="ml-auto text-[11.5px] text-muted">{M ? `${M.status === "planned" ? "Planned" : "Ready to configure"} · not connected` : "Planned · not connected"}</span>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
