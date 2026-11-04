"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, Cpu, Loader2, LockKeyhole, MinusCircle, PlugZap, Upload, Wand2, XCircle } from "lucide-react";
import { api } from "@/client/api";
import { useJson } from "@/client/intelligence";
import { useFactory, useUi } from "@/client/store";
import { ProvBadge } from "@/components/builder/prov";
import { PageHeader } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Label, Textarea } from "@/components/ui/primitives";
import type { BlueprintReading } from "@/domain/builder/draft";
import type { BuilderEvent, BuilderStage } from "@/domain/builder/pipeline";
import type { TwinSpec } from "@/domain/builder/spec";
import type { ValidationResult } from "@/domain/builder/validate";
import type { FactoryState } from "@/domain/types";

interface Status {
  configured: boolean;
  provider: string;
  model: string;
  endpoint: string;
  label: string;
}

type StageState = { status: "pending" | "running" | "done" | "skipped" | "error"; summary?: string };
const STAGES: { id: BuilderStage; label: string }[] = [
  { id: "read", label: "Read the blueprint" },
  { id: "research", label: "Web research" },
  { id: "draft", label: "Draft the twin" },
  { id: "validate", label: "Validate (deterministic)" },
];

export default function PlantPrivateAiPage() {
  const { data: status } = useJson<Status>("/api/private-ai");
  const toast = useFactory((s) => s.toast);
  const apply = useFactory((s) => s.apply);
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", industry: "", location: "", requirements: "" });
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Record<BuilderStage, StageState>>(initialStages());
  const [reading, setReading] = useState<BlueprintReading | null>(null);
  const [spec, setSpec] = useState<TwinSpec | null>(null);
  const [mode, setMode] = useState<{ mode: "ai" | "template"; note: string | null } | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [testing, setTesting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const test = async () => {
    setTesting(true);
    try {
      const r = await api<{ ok: boolean; model?: string; latencyMs?: number; error?: string }>("/api/private-ai", { method: "POST" });
      toast(r.ok ? { tone: "success", title: "Muse Spark Open responded", detail: `${r.model} · ${r.latencyMs} ms` } : { tone: "error", title: "Connection failed", detail: r.error });
    } catch (e) {
      toast({ tone: "error", title: "Connection failed", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const run = async () => {
    if (!file) return;
    setRunning(true);
    setStages(initialStages());
    setReading(null);
    setSpec(null);
    setMode(null);
    setValidation(null);
    setError(null);
    setElapsed(0);
    const t0 = Date.now();
    timer.current = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      const body = new FormData();
      body.append("blueprint", file, file.name);
      for (const [k, v] of Object.entries(form)) body.append(k, v);
      const res = await fetch("/api/private-ai/blueprint", { method: "POST", body, cache: "no-store" });
      if (!res.ok || !res.body) {
        const d = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(d?.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) onEvent(JSON.parse(line) as BuilderEvent);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (timer.current) clearInterval(timer.current);
      setRunning(false);
    }
  };

  const onEvent = (e: BuilderEvent) => {
    if (e.type === "stage") setStages((s) => ({ ...s, [e.stage]: { status: e.status, summary: e.summary } }));
    else if (e.type === "reading") setReading(e.reading);
    else if (e.type === "draft") {
      setSpec(e.spec);
      setMode({ mode: e.mode, note: e.note });
    } else if (e.type === "validation") setValidation(e.result);
    else if (e.type === "error") setError(e.message);
    else if (e.type === "complete" && e.spec) setSpec(e.spec);
  };

  const build = async () => {
    if (!spec) return;
    setBuilding(true);
    try {
      const state = await api<FactoryState>("/api/builder/build", { body: { spec, by: useUi.getState().operator } });
      apply(state);
      toast({ tone: "success", title: `${state.profile.name} built`, detail: "Drafted on open weights, compiled by the deterministic engine." });
      router.push("/twin");
    } catch (e) {
      toast({ tone: "error", title: "Build failed", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setBuilding(false);
    }
  };

  const errors = validation?.issues.filter((i) => i.level === "error") ?? [];
  return (
    <div className="animate-fade-in space-y-3">
      <PageHeader
        title="Blueprint to Twin · Plant-Private AI"
        description="Turn a plant drawing into a digital twin using only Meta's open-weight Muse Spark Open. No hosted model is called: no web research, no SAM. The drawing and requirements go only to the open-weight model, and the twin is compiled by the same deterministic engine as the Twin Builder."
      />

      <Card>
        <CardBody className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-[12.5px]">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <LockKeyhole className="h-4 w-4 text-accent" /> Open-weight model
          </span>
          {status ? (
            <>
              <span className="font-mono text-[11.5px] text-ink-2">{status.model}</span>
              <span className="text-muted">via {status.provider} ({status.endpoint})</span>
              {status.configured ? <Badge tone="healthy">key set</Badge> : <Badge tone="warning">not configured: set BASETEN_API_KEY in .env</Badge>}
            </>
          ) : (
            <span className="text-muted">checking…</span>
          )}
          <Button size="sm" variant="secondary" className="ml-auto" disabled={!status?.configured} loading={testing} onClick={test}>
            <PlugZap className="h-3.5 w-3.5" /> Test connection
          </Button>
        </CardBody>
      </Card>

      <div className="grid gap-3 xl:grid-cols-[2fr_3fr]">
        <Card>
          <CardHeader title="1 · Your plant" description="A floor plan, layout or process flow drawing (PNG, JPEG or WebP, up to 15 MB) and what you need." icon={<Upload className="h-4 w-4" />} />
          <CardBody className="space-y-2.5">
            <div className="space-y-1">
              <Label htmlFor="pp-file">Blueprint</Label>
              <input id="pp-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[12px] text-ink-2 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-ink" />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["name", "industry", "location"] as const).map((k) => (
                <div key={k} className="space-y-1">
                  <Label htmlFor={`pp-${k}`}>{k === "name" ? "Plant name" : k[0].toUpperCase() + k.slice(1)}</Label>
                  <Input id={`pp-${k}`} value={form[k]} maxLength={80} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="pp-req">Requirements (optional)</Label>
              <Textarea id="pp-req" rows={4} maxLength={6000} value={form.requirements} placeholder="e.g. Two bottling lines feeding one packing area; monitor fillers over OPC UA." onChange={(e) => setForm((f) => ({ ...f, requirements: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11.5px] text-muted">The drawing is sent to the open-weight model and not stored.</span>
              <Button variant="primary" size="sm" disabled={!file || !status?.configured} loading={running} onClick={run}>
                <Cpu className="h-3.5 w-3.5" /> Read and draft on open weights
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="2 · Agent progress" description={running ? `Working on Muse Spark Open… ${elapsed}s` : "Each stage reports what it actually did."} />
          <CardBody className="space-y-2">
            {STAGES.map((s) => (
              <StageRow key={s.id} label={s.label} state={stages[s.id]} />
            ))}
            {error && <p className="rounded-lg border border-critical/40 bg-critical/8 p-2 text-[12px] text-critical-ink">{error}</p>}
            {mode && (
              <p className="text-[12px] text-muted">
                {mode.mode === "ai" ? (
                  <>
                    <Badge tone="agent">Drafted by {status?.label ?? "Muse Spark Open"}</Badge> open weights
                  </>
                ) : (
                  <>
                    <Badge tone="warning">Template fallback</Badge> {mode.note}
                  </>
                )}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {(preview || reading) && <BlueprintView preview={preview} reading={reading} spec={spec} />}

      {spec && (
        <Card>
          <CardHeader
            title={`3 · Review: ${spec.site.name}`}
            description={`${spec.site.industry}${spec.site.location ? ` · ${spec.site.location}` : ""}. Every element shows where it came from. Building compiles this spec deterministically into a new twin.`}
            icon={<Wand2 className="h-4 w-4" />}
            actions={
              <Button variant="primary" size="sm" disabled={errors.length > 0 || running} loading={building} onClick={build}>
                Build my digital twin
              </Button>
            }
          />
          <CardBody className="space-y-3">
            {validation && validation.issues.length > 0 && (
              <ul className="space-y-1 text-[12px]">
                {validation.issues.slice(0, 8).map((i, k) => (
                  <li key={k} className={i.level === "error" ? "text-critical-ink" : i.level === "warning" ? "text-warning-ink" : "text-muted"}>
                    {i.level}: {i.message}
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-3 lg:grid-cols-2">
              {spec.lines.map((l) => {
                const summary = validation?.lines.find((x) => x.id === l.id);
                return (
                  <div key={l.id} className="rounded-lg border border-line p-2.5">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-ink">
                        {l.name} <span className="text-muted">({l.role})</span>
                      </span>
                      <ProvBadge prov={l.prov} spec={spec} compact />
                    </div>
                    {summary && <p className="mb-1.5 text-[11.5px] text-muted">≈{Math.round(summary.targetRate).toLocaleString("en-US")} units/h{summary.bottleneck ? ` · bottleneck ${summary.bottleneck.name}` : ""}</p>}
                    <ol className="space-y-1">
                      {l.machines.map((m, i) => (
                        <li key={m.id} className="flex items-center justify-between gap-2 text-[12px]">
                          <span className="text-ink-2">
                            {i + 1}. {m.name} <span className="text-muted">· {m.archetype}{m.ratePerHour ? ` · ${m.ratePerHour}/h` : ""}</span>
                          </span>
                          <ProvBadge prov={m.prov} spec={spec} compact />
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
            <div className="grid gap-3 md:grid-cols-3 text-[12px]">
              <ListBox title="Products" items={spec.products.map((p) => `${p.name} (${p.unit})`)} />
              <ListBox title="Materials" items={spec.materials.map((m) => m.name)} />
              <ListBox title="Connections" items={spec.integrations.map((i) => `${i.kind} · ${i.target}`)} />
            </div>
            <div className="grid gap-3 md:grid-cols-2 text-[12px]">
              <ListBox title="Assumptions" items={spec.assumptions} />
              <ListBox title="Questions for you" items={spec.questions.map((q) => q.text)} />
            </div>
          </CardBody>
        </Card>
      )}

      {!spec && !running && !reading && (
        <Card>
          <CardBody>
            <EmptyState icon={<LockKeyhole className="h-5 w-5" />} title="Why plant-private?" description="Many plants can't send layouts or production data to closed hosted models. Meta's open weights can run on a host the plant chooses, or later on its own servers. Here the whole blueprint-to-twin flow runs on Muse Spark Open." />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function initialStages(): Record<BuilderStage, StageState> {
  return { read: { status: "pending" }, research: { status: "pending" }, draft: { status: "pending" }, validate: { status: "pending" } };
}

function StageRow({ label, state }: { label: string; state: StageState }) {
  const icon =
    state.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-accent" /> :
    state.status === "done" ? <CheckCircle2 className="h-4 w-4 text-healthy" /> :
    state.status === "error" ? <XCircle className="h-4 w-4 text-critical" /> :
    state.status === "skipped" ? <MinusCircle className="h-4 w-4 text-muted" /> :
    <CircleDashed className="h-4 w-4 text-muted" />;
  return (
    <div className="flex items-start gap-2 text-[12.5px]">
      <span className="mt-0.5">{icon}</span>
      <div>
        <p className="text-ink">
          {label} <span className="text-[11px] text-muted">{state.status}</span>
        </p>
        {state.summary && <p className="text-[11.5px] text-muted">{state.summary}</p>}
      </div>
    </div>
  );
}

function BlueprintView({ preview, reading, spec }: { preview: string | null; reading: BlueprintReading | null; spec: TwinSpec | null }) {
  const boxes = useMemo(() => (spec ? spec.lines.flatMap((l) => l.machines.filter((m) => m.box).map((m) => ({ label: m.name, box: m.box! }))) : []), [spec]);
  return (
    <Card>
      <CardHeader title="Blueprint reading" description={reading ? reading.summary : "Waiting for the model to read the drawing…"} />
      <CardBody className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        {preview && (
          <div className="relative overflow-hidden rounded-lg border border-line bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Uploaded blueprint" className="block h-auto w-full" />
            {boxes.map((b, i) => (
              <div
                key={i}
                title={b.label}
                className="absolute rounded-[3px] border-2 border-accent/90 bg-accent/10"
                style={{ left: `${b.box.x * 100}%`, top: `${b.box.y * 100}%`, width: `${b.box.w * 100}%`, height: `${b.box.h * 100}%` }}
              >
                <span className="absolute -top-4 left-0 max-w-[160px] truncate rounded bg-shell/90 px-1 text-[10px] text-ink">{b.label}</span>
              </div>
            ))}
          </div>
        )}
        {reading && (
          <div className="space-y-2 text-[12px]">
            <p className="text-ink-2">
              <Badge tone="neutral">{reading.drawingKind}</Badge> {reading.elements.length} element(s), {reading.flows.length} flow link(s){reading.legible ? "" : " · hard to read"}
            </p>
            <ul className="max-h-72 space-y-0.5 overflow-auto">
              {reading.elements.map((e) => (
                <li key={e.id} className="flex justify-between gap-2">
                  <span className="text-ink-2">
                    <span className="font-mono text-[11px] text-muted">{e.id}</span> {e.label}
                  </span>
                  <span className="text-muted">{e.archetype ?? e.role}</span>
                </li>
              ))}
            </ul>
            {reading.notes.map((n, i) => (
              <p key={i} className="text-[11px] text-muted">{n}</p>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ListBox({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-line p-2.5">
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{title}</p>
      {items.length ? (
        <ul className="space-y-0.5 text-ink-2">
          {items.slice(0, 12).map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">None</p>
      )}
    </div>
  );
}
