"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Database, Factory, Loader2, ScanEye, Send, Settings2, Sparkles, Truck, Upload, Wrench, XCircle } from "lucide-react";
import { bk, useBackend } from "@/client/backend";
import { Markdown } from "@/components/copilot/copilot-panel";
import { KeyValue, StatTile } from "@/components/page";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";

type Json = Record<string, unknown>;
const LANGS = [
  ["en", "English"],
  ["hi", "हिन्दी"],
  ["kn", "ಕನ್ನಡ"],
  ["ta", "தமிழ்"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["ja", "日本語"],
] as const;

function Err({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="rounded-lg border border-critical/40 bg-critical/8 p-2.5 text-[12px] text-critical-ink">{error}</p>;
}

function Source({ by, note }: { by?: string; note?: string | null }) {
  if (!by) return null;
  const ai = by !== "deterministic-template" && by !== "deterministic";
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
      <Badge tone={ai ? "agent" : "neutral"}>{ai ? `Written by ${by}` : "Deterministic"}</Badge>
      {note}
    </p>
  );
}

function persistedNote(text: string) {
  return <span className="text-[11px] text-muted">Saved to SQLite · {text}</span>;
}

/* ───────────────────────────── Overview ───────────────────────────── */

export function OverviewPanel() {
  const ready = useBackend<Json>("ready");
  const ai = useBackend<{ enabled: boolean; reason: string | null; models: Record<string, string> }>("ai/status");
  const model = useBackend<{ database: string; tables: { table: string; feature: string; description: string; rows: number; kind: string; columns: string[] }[]; platform_tables: { table: string; description: string; rows: number }[] }>("api/v1/data/model");
  const activity = useBackend<{ calls: Json[]; answers: Json[] }>("api/v1/data/ai-activity?limit=12");
  const byFeature = useMemo(() => {
    const g: Record<string, { table: string; description: string; rows: number; kind: string; columns: string[] }[]> = {};
    for (const t of model.data?.tables ?? []) (g[t.feature] ??= []).push(t);
    return g;
  }, [model.data]);
  if (ready.error) return <Err error={ready.error} />;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Backend" icon={<Factory className="h-4 w-4" />} value={String(ready.data?.status ?? "…")} sub={String(ready.data?.app ?? "")} />
        <StatTile label="Meta Model API" icon={<Sparkles className="h-4 w-4" />} value={ai.data ? (ai.data.enabled ? "On" : "Off") : "…"} sub={ai.data?.enabled ? Object.values(ai.data.models).join(" · ") : (ai.data?.reason ?? "")} />
        <StatTile label="Backend tables" icon={<Database className="h-4 w-4" />} value={fmtInt(model.data?.tables.length ?? 0)} sub={model.data?.database ?? ""} />
        <StatTile label="Rows stored" icon={<Database className="h-4 w-4" />} value={fmtInt((model.data?.tables ?? []).reduce((n, t) => n + t.rows, 0))} sub="across all backend tables" />
      </div>
      <Card>
        <CardHeader title="Data model (SQLite)" description="Every table the intelligence backend owns, with live row counts. Typed columns are indexed for queries; each row also keeps the full entity as JSON." icon={<Database className="h-4 w-4" />} />
        <CardBody className="grid gap-3 lg:grid-cols-2">
          {Object.entries(byFeature).map(([feature, tables]) => (
            <div key={feature} className="rounded-xl border border-line bg-shell p-3">
              <p className="mb-2 text-[12px] font-semibold tracking-wide text-ink uppercase">{feature.replace(/_/g, " ")}</p>
              <table className="w-full text-[12px]">
                <tbody>
                  {tables.map((t) => (
                    <tr key={t.table} className="border-t border-line/60 align-top" title={t.columns.join(", ")}>
                      <td className="py-1 pr-2 font-mono text-[11.5px] text-ink">{t.table}</td>
                      <td className="py-1 pr-2 text-ink-2">{t.description}</td>
                      <td className="tabular py-1 text-right text-muted">{fmtInt(t.rows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {model.data && (
            <div className="rounded-xl border border-line bg-shell p-3">
              <p className="mb-2 text-[12px] font-semibold tracking-wide text-ink uppercase">platform</p>
              <table className="w-full text-[12px]">
                <tbody>
                  {model.data.platform_tables.map((t) => (
                    <tr key={t.table} className="border-t border-line/60">
                      <td className="py-1 pr-2 font-mono text-[11.5px] text-ink">{t.table}</td>
                      <td className="py-1 pr-2 text-ink-2">{t.description}</td>
                      <td className="tabular py-1 text-right text-muted">{fmtInt(t.rows)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent AI activity" description="Every Meta Model API call and every AI-written answer is logged in SQLite (ai_calls, ai_interactions)." icon={<Sparkles className="h-4 w-4" />} />
        <CardBody>
          {activity.data?.calls.length ? (
            <ul className="space-y-1 text-[12px]">
              {activity.data.calls.map((c, i) => (
                <li key={i} className="flex gap-2">
                  {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-healthy-ink" /> : <XCircle className="h-3.5 w-3.5 text-critical-ink" />}
                  <span className="font-mono text-[11px] text-muted">{String(c.created_at).slice(11, 19)}</span>
                  <span className="text-ink">{String(c.model)}</span>
                  <span className="text-ink-2">{String(c.purpose)}</span>
                  <span className="ml-auto text-muted">{String(c.component)} · {String(c.latency_ms)} ms</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-muted">No AI calls yet. With MODEL_API_KEY set, copilots, briefs and inspections call Muse models.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* ───────────────────────────── Maintenance ───────────────────────────── */

type Machine = { machine_id: string; machine_type: string; plant_id: string; risk_category: string; failure_probability: number; latest_vibration: number; latest_temperature: number };
type Rec = { recommendation_id: string; asset_id: string; urgency: string; recommended_action: string; rationale: string; approval_status: string; approved_by?: string | null };

export function MaintenancePanel({ operator }: { operator: string }) {
  const machines = useBackend<Machine[]>("api/v1/maintenance/machines");
  const recs = useBackend<Rec[]>("api/v1/maintenance/recommendations");
  const [asset, setAsset] = useState("");
  const [lang, setLang] = useState("en");
  const [q, setQ] = useState("Why is this machine at risk and what should we do first?");
  const [answer, setAnswer] = useState<Json | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const risky = (machines.data ?? []).slice().sort((a, b) => b.failure_probability - a.failure_probability);
  useEffect(() => {
    if (!asset && risky[0]) setAsset(risky[0].machine_id);
  }, [asset, risky]);

  const ask = async () => {
    setBusy("ask");
    setErr(null);
    try {
      setAnswer(await bk<Json>("api/v1/maintenance/copilot/chat", { json: { query: q, asset_id: asset || null, language: lang, user_id: operator } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const decide = async (id: string, ok: boolean) => {
    setBusy(id);
    try {
      await bk(`api/v1/maintenance/recommendations/${encodeURIComponent(id)}/${ok ? "approve" : "reject"}?approver_name=${encodeURIComponent(operator)}`, { method: "POST" });
      await recs.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_1.1fr]">
      <div className="space-y-3">
        <Card>
          <CardHeader title="Fleet risk" description="24 h failure probability from the backend's model (pm_predictions)." icon={<Wrench className="h-4 w-4" />} />
          <CardBody className="max-h-80 overflow-auto">
            <Err error={machines.error} />
            <table className="w-full text-[12px]">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">Machine</th>
                  <th>Plant</th>
                  <th className="text-right">Vib mm/s</th>
                  <th className="text-right">Risk</th>
                </tr>
              </thead>
              <tbody>
                {risky.map((m) => (
                  <tr key={m.machine_id} className={`cursor-pointer border-t border-line/60 ${asset === m.machine_id ? "bg-accent/8" : "hover:bg-surface-2"}`} onClick={() => setAsset(m.machine_id)}>
                    <td className="py-1 font-mono text-ink">{m.machine_id}</td>
                    <td className="text-ink-2">{m.plant_id.replace("PLANT_", "")}</td>
                    <td className="tabular text-right">{m.latest_vibration?.toFixed?.(2)}</td>
                    <td className="text-right">
                      <Badge tone={m.risk_category === "HIGH" ? "critical" : m.risk_category === "MEDIUM" ? "warning" : "healthy"}>{fmtPct(m.failure_probability, 0)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recommendations awaiting approval" description="Approve or reject: the decision is stored in pm_recommendations with your name." />
          <CardBody className="max-h-96 space-y-2 overflow-auto">
            <Err error={recs.error} />
            {(recs.data ?? []).slice(0, 12).map((r) => (
              <div key={r.recommendation_id} className="rounded-lg border border-line bg-shell p-2.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-ink">{r.asset_id}</span>
                  <Badge tone={r.urgency === "IMMEDIATE" ? "critical" : r.urgency === "SCHEDULED" ? "warning" : "neutral"}>{r.urgency}</Badge>
                  <Badge tone={r.approval_status === "APPROVED" ? "healthy" : r.approval_status === "REJECTED" ? "critical" : "neutral"}>{r.approval_status}</Badge>
                  {r.approval_status === "PENDING" && (
                    <span className="ml-auto flex gap-1">
                      <Button size="xs" variant="success" loading={busy === r.recommendation_id} onClick={() => decide(r.recommendation_id, true)}>
                        Approve
                      </Button>
                      <Button size="xs" variant="outline" disabled={busy === r.recommendation_id} onClick={() => decide(r.recommendation_id, false)}>
                        Reject
                      </Button>
                    </span>
                  )}
                </div>
                <p className="mt-1 text-ink">{r.recommended_action}</p>
                {r.approved_by && <p className="mt-0.5 text-muted">Decided by {r.approved_by}</p>}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Maintenance copilot" description="Muse Spark answers from sensors, the ML risk model, similar incidents and approved SOPs, in your language. Every figure is checked against the evidence." icon={<Sparkles className="h-4 w-4" />} />
        <CardBody className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="pm-asset">Asset</Label>
              <Select id="pm-asset" value={asset} onChange={(e) => setAsset(e.target.value)} className="w-full">
                {risky.map((m) => (
                  <option key={m.machine_id} value={m.machine_id}>
                    {m.machine_id} · {m.machine_type}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="pm-lang">Language</Label>
              <Select id="pm-lang" value={lang} onChange={(e) => setLang(e.target.value)} className="w-full">
                {LANGS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question" />
          <Button variant="agent" loading={busy === "ask"} onClick={ask} disabled={!q.trim()}>
            <Send className="h-3.5 w-3.5" /> Ask
          </Button>
          <Err error={err} />
          {answer && (
            <div className="rounded-xl border border-line bg-shell p-3">
              <Markdown text={String(answer.answer_markdown ?? "")} />
              <Source by={answer.generated_by as string} note={answer.ai_note as string} />
              <p className="mt-1 text-[11.5px] text-muted">
                Action: <span className="text-ink">{String(answer.prescriptive_action)}</span> · Urgency: <span className="text-ink">{String(answer.urgency)}</span>
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* ───────────────────────────── Visual inspection ───────────────────────────── */

type Defect = { finding_id: string; defect_class: string; confidence: number; bounding_box: [number, number, number, number]; severity: string; ipc_clause?: string; source: string };
type Inspection = { inspection_id: string; verdict: string; detector: string; defects: Defect[]; similarity_score_to_golden: number; barcode_decoded?: string; barcode_grade?: string; advisory?: { summary: string; probable_root_cause: string; recommended_containment: string; generated_by: string }; latency_metrics?: { total_latency_ms: number } };

export function InspectionPanel({ operator }: { operator: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [partId, setPartId] = useState("PART-ECU-REV-B-101");
  const [res, setRes] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const summary = useBackend<Json>("api/v1/quality/summary/LINE-1");
  const feedback = useBackend<Json>("api/v1/quality/mlops/detector-feedback");
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const inspect = async () => {
    setBusy("inspect");
    setErr(null);
    try {
      const form = new FormData();
      if (file) form.append("image", file, file.name);
      setRes(await bk<Inspection>(`api/v1/quality/inspect?camera_id=CAM_AOI_L1&part_id=${encodeURIComponent(partId)}`, { method: "POST", body: form }));
      await summary.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const dispose = async (action: string) => {
    if (!res) return;
    setBusy(action);
    setErr(null);
    try {
      await bk("api/v1/quality/disposition", { json: { inspection_id: res.inspection_id, auditor_id: operator, action, rationale: rationale || `${action} by ${operator}` } });
      setRes({ ...res, verdict: action === "CONFIRM_DEFECT" ? "OVERRIDDEN_FAIL" : "OVERRIDDEN_PASS" });
      await Promise.all([feedback.reload(), summary.reload()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader title="Inspect a part" description="Muse Spark classifies IPC-A-610 defects and SAM 3.1 boxes each one; a deterministic rule engine decides the verdict. Without an image or key, the reference detector runs." icon={<ScanEye className="h-4 w-4" />} />
        <CardBody className="space-y-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setRes(null);
              setUrl(f ? URL.createObjectURL(f) : null);
            }}
          />
          <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> {file ? "Change image" : "Part image"}
            </Button>
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="vq-part">Part / serial</Label>
              <Input id="vq-part" value={partId} onChange={(e) => setPartId(e.target.value)} />
            </div>
            <Button size="sm" variant="agent" loading={busy === "inspect"} onClick={inspect}>
              Inspect
            </Button>
          </div>
          <Err error={err} />
          {url && (
            <div className="relative w-fit max-w-full overflow-hidden rounded-lg border border-line bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Part" className="block max-h-80 max-w-full" onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
              {dims &&
                res?.defects
                  .filter((d) => d.bounding_box[2] > 0)
                  .map((d) => (
                    <span key={d.finding_id} className="absolute border-2 border-violet-400" style={{ left: `${(d.bounding_box[0] / dims.w) * 100}%`, top: `${(d.bounding_box[1] / dims.h) * 100}%`, width: `${(d.bounding_box[2] / dims.w) * 100}%`, height: `${(d.bounding_box[3] / dims.h) * 100}%` }}>
                      <span className="absolute -top-4 left-0 rounded-sm bg-violet-500 px-1 text-[9.5px] leading-4 whitespace-nowrap text-white">{d.defect_class}</span>
                    </span>
                  ))}
            </div>
          )}
          {res && (
            <div className="space-y-2 rounded-xl border border-line bg-shell p-3 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-ink">{res.inspection_id}</span>
                <Badge tone={res.verdict.includes("PASS") ? "healthy" : res.verdict === "REVIEW_REQUIRED" ? "warning" : "critical"}>{res.verdict}</Badge>
                <Badge tone="agent">{res.detector}</Badge>
                <span className="text-muted">similarity {fmtPct(res.similarity_score_to_golden, 1)} · {Math.round(res.latency_metrics?.total_latency_ms ?? 0)} ms</span>
              </div>
              {res.defects.map((d) => (
                <p key={d.finding_id} className="text-ink-2">
                  <span className="text-ink">{d.defect_class}</span> · {d.severity} · {fmtPct(d.confidence, 0)} · {d.ipc_clause}
                </p>
              ))}
              {res.barcode_decoded && <KeyValue k="Serial read" v={`${res.barcode_decoded} · ${res.barcode_grade ?? ""}`} />}
              {res.advisory && (
                <div className="rounded-lg border border-line bg-surface p-2.5">
                  <p className="text-ink">{res.advisory.summary}</p>
                  <p className="mt-1 text-ink-2">Root cause: {res.advisory.probable_root_cause}</p>
                  <p className="text-ink-2">Containment: {res.advisory.recommended_containment}</p>
                  <Source by={res.advisory.generated_by} note="Advisory only; never the pass/fail decision." />
                </div>
              )}
              {!res.verdict.startsWith("OVERRIDDEN") && res.verdict !== "PASS" && (
                <div className="space-y-1.5">
                  <Input placeholder="Rationale (required for the audit trail)" value={rationale} onChange={(e) => setRationale(e.target.value)} />
                  <div className="flex gap-1.5">
                    <Button size="xs" variant="danger" loading={busy === "CONFIRM_DEFECT"} onClick={() => dispose("CONFIRM_DEFECT")}>
                      Confirm defect
                    </Button>
                    <Button size="xs" variant="outline" loading={busy === "DISMISS_DEFECT"} onClick={() => dispose("DISMISS_DEFECT")}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
              {persistedNote("vq_inspections, vq_defects, vq_dispositions")}
            </div>
          )}
        </CardBody>
      </Card>
      <div className="space-y-3">
        <Card>
          <CardHeader title="Line quality (LINE-1)" description="From every stored inspection." />
          <CardBody className="grid grid-cols-3 gap-2 text-[12px]">
            <KeyValue k="First-pass yield" v={summary.data ? `${summary.data.first_pass_yield_pct}%` : "…"} />
            <KeyValue k="DPMO" v={summary.data ? fmtInt(Number(summary.data.dpmo)) : "…"} />
            <KeyValue k="Inspected" v={summary.data ? fmtInt(Number(summary.data.total_inspected)) : "…"} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Detector feedback" description="Precision measured from your confirm / dismiss decisions." />
          <CardBody className="space-y-1.5 text-[12px]">
            <KeyValue k="Detector" v={String(feedback.data?.detector ?? "…")} />
            <KeyValue k="Decisions" v={`${feedback.data?.confirmed_defects ?? 0} confirmed · ${feedback.data?.dismissed_defects ?? 0} dismissed`} />
            <KeyValue k="Precision" v={feedback.data?.precision == null ? "—" : fmtPct(Number(feedback.data.precision), 0)} />
            <p className="text-ink-2">{String(feedback.data?.recommendation ?? "")}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────────── Supply chain ───────────────────────────── */

type Supplier = { supplier_id: string; supplier_name: string; country: string; composite_risk_level?: string; on_time_delivery_rate: number };
type Mitigation = { recommendation_id: string; action_type: string; description: string; status: string; approved_by?: string | null; estimated_cost_usd?: number };

export function SupplyPanel({ operator }: { operator: string }) {
  const kpis = useBackend<Json>("api/v1/supply-chain/kpis/summary");
  const suppliers = useBackend<Supplier[]>("api/v1/supply-chain/suppliers");
  const mitigations = useBackend<Mitigation[]>("api/v1/supply-chain/mitigations");
  const [target, setTarget] = useState("SUP-MICRO-01");
  const [days, setDays] = useState(14);
  const [whatIf, setWhatIf] = useState<Json | null>(null);
  const [q, setQ] = useState("Which parts are closest to a stock-out and what should procurement do?");
  const [lang, setLang] = useState("en");
  const [answer, setAnswer] = useState<Json | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="On-time delivery" icon={<Truck className="h-4 w-4" />} value={kpis.data ? `${kpis.data.on_time_delivery_rate}%` : "…"} sub="suppliers, last period" />
        <StatTile label="Stock-out risk" value={kpis.data ? `${kpis.data.stockout_risk_percentage}%` : "…"} sub="of monitored SKUs" />
        <StatTile label="Orders at risk" value={kpis.data ? fmtInt(Number(kpis.data.customer_orders_at_risk_count)) : "…"} sub="customer orders" />
        <StatTile label="Revenue at risk" value={kpis.data ? fmtMoney(Number(kpis.data.total_revenue_at_risk_usd)) : "…"} sub="from threatened orders" />
      </div>
      <Err error={err} />
      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader title="What-if disruption" description="Simulated deterministically, briefed by Muse Wonder. Every run is kept (sc_what_if_runs)." />
          <CardBody className="space-y-2">
            <div className="grid grid-cols-[1fr_120px_auto] items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="sc-sup">Supplier</Label>
                <Select id="sc-sup" className="w-full" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.supplier_id} value={s.supplier_id}>
                      {s.supplier_name} ({s.country})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sc-days">Days</Label>
                <Input id="sc-days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} />
              </div>
              <Button variant="agent" loading={busy === "whatif"} onClick={() => run("whatif", async () => setWhatIf(await bk<Json>("api/v1/supply-chain/assistant/what-if", { json: { target_entity_id: target, duration_days: days } })))}>
                Simulate
              </Button>
            </div>
            {whatIf && (
              <div className="space-y-1.5 rounded-xl border border-line bg-shell p-3 text-[12px]">
                <p className="font-medium text-ink">{String(whatIf.scenario_title)}</p>
                <p className="text-ink-2">
                  Downtime {String(whatIf.projected_downtime_hours)} h · exposure {fmtMoney(Number(whatIf.projected_financial_loss_usd))} · orders delayed: {(whatIf.customer_orders_delayed as string[]).join(", ") || "none"}
                </p>
                {whatIf.narrative_markdown ? <Markdown text={String(whatIf.narrative_markdown)} /> : <p className="text-ink-2">{String(whatIf.recommended_contingency_plan)}</p>}
                <Source by={whatIf.generated_by as string} />
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Supply chain assistant" description="Muse Spark, grounded in suppliers, inventory, orders and the risk engine." icon={<Sparkles className="h-4 w-4" />} />
          <CardBody className="space-y-2">
            <div className="grid grid-cols-[1fr_140px] gap-2">
              <Textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question" />
              <Select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)}>
                {LANGS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <Button variant="agent" loading={busy === "ask"} onClick={() => run("ask", async () => setAnswer(await bk<Json>("api/v1/supply-chain/assistant/chat", { json: { query: q, language: lang } })))}>
              <Send className="h-3.5 w-3.5" /> Ask
            </Button>
            {answer && (
              <div className="rounded-xl border border-line bg-shell p-3">
                <Markdown text={String(answer.answer_markdown ?? "")} />
                <Source by={answer.generated_by as string} note={answer.ai_note as string} />
              </div>
            )}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Mitigations" description="Approving records your name and resolves the disruption (sc_mitigations, sc_disruptions)." />
        <CardBody className="space-y-2">
          {(mitigations.data ?? []).map((m) => (
            <div key={m.recommendation_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-shell p-2.5 text-[12px]">
              <span className="font-mono text-ink">{m.recommendation_id}</span>
              <Badge tone="neutral">{m.action_type}</Badge>
              <Badge tone={m.status === "APPROVED" ? "healthy" : "warning"}>{m.status}</Badge>
              <span className="min-w-0 flex-1 text-ink-2">{m.description}</span>
              {m.status !== "APPROVED" ? (
                <Button size="xs" variant="success" loading={busy === m.recommendation_id} onClick={() => run(m.recommendation_id, async () => {
                  await bk(`api/v1/supply-chain/mitigations/${encodeURIComponent(m.recommendation_id)}/approve?approver=${encodeURIComponent(operator)}`, { method: "POST" });
                  await mitigations.reload();
                })}>
                  Approve
                </Button>
              ) : (
                <span className="text-muted">by {m.approved_by}</span>
              )}
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

/* ───────────────────────────── Planning & operations ───────────────────────────── */

export function PlanningPanel() {
  const [brief, setBrief] = useState<Json | null>(null);
  const [handover, setHandover] = useState<Json | null>(null);
  const [alarm, setAlarm] = useState<Json | null>(null);
  const [line, setLine] = useState("LINE-1");
  const [assetId, setAssetId] = useState("ROB-002");
  const [code, setCode] = useState("VIB-HIGH-221");
  const history = useBackend<Json[]>("api/v1/data/runs/df_planning_briefs?limit=5");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-3">
      <Err error={err} />
      <Card>
        <CardHeader
          title="S&OP planning brief"
          description="The forecasting, planning and inventory engines compute every figure; Muse Wonder writes the brief. Each brief is stored (df_planning_briefs)."
          actions={
            <Button size="sm" variant="agent" loading={busy === "brief"} onClick={() => run("brief", async () => {
              setBrief(await bk<Json>("api/v1/production/brief?plant_id=PLANT_BANGALORE&horizon_days=30"));
              await history.reload();
            })}>
              Generate brief
            </Button>
          }
        />
        <CardBody>
          {brief ? (
            <>
              <Markdown text={String(brief.brief_markdown)} />
              <Source by={brief.generated_by as string} note={brief.ai_note as string} />
            </>
          ) : (
            <p className="text-[12px] text-muted">{history.data?.length ? `${history.data.length} earlier brief(s) stored; the latest was generated ${String(history.data[0].created_at).slice(0, 16).replace("T", " ")}.` : "No brief yet."}</p>
          )}
        </CardBody>
      </Card>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader title="Shift handover" description="Muse Spark briefing for the incoming shift lead (oc_shift_handovers)." />
          <CardBody className="space-y-2">
            <div className="flex gap-2">
              <Input aria-label="Line" value={line} onChange={(e) => setLine(e.target.value)} />
              <Button size="sm" loading={busy === "handover"} onClick={() => run("handover", async () => setHandover(await bk<Json>(`api/v1/copilot/shift-handover/${encodeURIComponent(line)}`)))}>
                Generate
              </Button>
            </div>
            {handover && (
              <div className="rounded-xl border border-line bg-shell p-3 text-[12px]">
                {handover.summary_markdown ? <Markdown text={String(handover.summary_markdown)} /> : (
                  <p className="text-ink-2">
                    {fmtInt(Number(handover.units_produced))} units · scrap {String(handover.scrap_rate_pct)}% · {(handover.major_incidents as string[]).join("; ")}
                  </p>
                )}
                <Source by={handover.generated_by as string} />
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Alarm triage" description="Grounded in the matching passage of the maintenance manuals (oc_alarm_triages)." />
          <CardBody className="space-y-2">
            <div className="flex gap-2">
              <Input aria-label="Asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} />
              <Input aria-label="Alarm code" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button size="sm" loading={busy === "alarm"} onClick={() => run("alarm", async () => setAlarm(await bk<Json>(`api/v1/copilot/alarm-triage/${encodeURIComponent(assetId)}/${encodeURIComponent(code)}`)))}>
                Triage
              </Button>
            </div>
            {alarm && (
              <div className="space-y-1.5 rounded-xl border border-line bg-shell p-3 text-[12px]">
                {alarm.explanation_markdown ? <Markdown text={String(alarm.explanation_markdown)} /> : (
                  <ul className="ml-4 list-disc text-ink-2">
                    {(alarm.recommended_troubleshooting_steps as string[]).map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
                {alarm.manual_excerpt ? <p className="text-muted">Manual: {String(alarm.manual_excerpt).slice(0, 220)}…</p> : null}
                <Source by={alarm.generated_by as string} />
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ───────────────────────────── Configuration ───────────────────────────── */

const CONFIGS = [
  { id: "predictive_maintenance", path: "api/v1/maintenance/config", label: "Predictive maintenance" },
  { id: "visual_quality_inspection", path: "api/v1/quality/config", label: "Visual quality" },
  { id: "supply_chain_intelligence", path: "api/v1/supply-chain/config", label: "Supply chain" },
  { id: "demand_forecasting", path: "api/v1/demand/config", label: "Demand forecasting" },
  { id: "production_optimization", path: "api/v1/production/config", label: "Production optimisation" },
  { id: "waste_reduction", path: "api/v1/waste/config", label: "Waste reduction" },
  { id: "operational_copilots", path: "api/v1/copilot/config", label: "Operational copilots" },
] as const;

export function ConfigPanel() {
  const [sel, setSel] = useState<(typeof CONFIGS)[number]["id"]>(CONFIGS[0].id);
  const cfg = CONFIGS.find((c) => c.id === sel)!;
  const current = useBackend<Json>(cfg.path, [sel]);
  const history = useBackend<{ changed_at: string; changed_by: string | null }[]>(`api/v1/data/config-history/${sel}?limit=8`, [sel]);
  const [draft, setDraft] = useState<Json>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (current.data) setDraft(current.data);
  }, [current.data]);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      current.setData(await bk<Json>(cfg.path, { method: "PUT", json: draft }));
      await history.reload();
      setMsg("Saved to SQLite (app_config) and recorded in app_config_history.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: string, raw: string, kind: string) => setDraft((d) => ({ ...d, [k]: kind === "number" ? Number(raw) : kind === "boolean" ? raw === "true" : kind === "object" ? safeJson(raw, d[k]) : raw }));
  return (
    <div className="grid gap-3 xl:grid-cols-[220px_1fr_260px]">
      <Card>
        <CardBody className="space-y-1">
          {CONFIGS.map((c) => (
            <button key={c.id} onClick={() => setSel(c.id)} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${sel === c.id ? "bg-accent/12 text-ink" : "text-ink-2 hover:bg-surface-2"}`}>
              {c.label}
            </button>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={cfg.label} description={`Live configuration of the backend (${cfg.path}).`} icon={<Settings2 className="h-4 w-4" />} actions={<Button size="sm" variant="primary" loading={busy} onClick={save}>Save</Button>} />
        <CardBody className="grid gap-2 sm:grid-cols-2">
          <Err error={current.error} />
          {Object.entries(draft).map(([k, v]) => {
            const kind = typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : v && typeof v === "object" ? "object" : "string";
            return (
              <div key={k} className="space-y-1">
                <Label htmlFor={`cfg-${k}`}>{k.replace(/_/g, " ")}</Label>
                {kind === "boolean" ? (
                  <Select id={`cfg-${k}`} className="w-full" value={String(v)} onChange={(e) => set(k, e.target.value, kind)}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </Select>
                ) : kind === "object" ? (
                  <Textarea id={`cfg-${k}`} rows={3} defaultValue={JSON.stringify(v, null, 1)} onBlur={(e) => set(k, e.target.value, kind)} className="font-mono text-[11px]" />
                ) : (
                  <Input id={`cfg-${k}`} type={kind === "number" ? "number" : "text"} step="any" value={String(v ?? "")} onChange={(e) => set(k, e.target.value, kind)} />
                )}
              </div>
            );
          })}
          {msg && <p className="text-[12px] text-ink-2 sm:col-span-2">{msg}</p>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Change history" description="app_config_history" />
        <CardBody>
          {history.data?.length ? (
            <ul className="space-y-1 text-[12px]">
              {history.data.map((h, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="font-mono text-[11px] text-muted">{h.changed_at.slice(0, 19).replace("T", " ")}</span>
                  <span className="text-ink-2">{h.changed_by ?? "—"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No changes yet" description="Defaults are recorded on first read." />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

/* ───────────────────────────── Analytics (DuckDB) ───────────────────────────── */

type Report = { id: string; title: string; columns: string[]; rows: Json[]; engine: string; elapsed_ms?: number; note?: string };

export function AnalyticsPanel() {
  const list = useBackend<{ id: string; title: string }[]>("api/v1/data/analytics");
  const [sel, setSel] = useState("demand-monthly");
  const report = useBackend<Report>(`api/v1/data/analytics/${sel}`, [sel]);
  const r = report.data;
  return (
    <div className="grid gap-3 xl:grid-cols-[220px_1fr]">
      <Card>
        <CardBody className="space-y-1">
          {(list.data ?? []).map((c) => (
            <button key={c.id} onClick={() => setSel(c.id)} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${sel === c.id ? "bg-accent/12 text-ink" : "text-ink-2 hover:bg-surface-2"}`}>
              {c.title}
            </button>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={r?.title ?? "Report"}
          description={r ? `${r.engine} over a snapshot of the SQLite tables${r.elapsed_ms != null ? ` · ${r.elapsed_ms} ms` : ""}` : "DuckDB over the shared SQLite database"}
          icon={<Database className="h-4 w-4" />}
          actions={<Button size="sm" onClick={() => void report.reload()} loading={report.loading}>Refresh</Button>}
        />
        <CardBody>
          <Err error={report.error ?? list.error} />
          {r && r.rows.length ? (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-surface text-left text-muted">
                  <tr>{r.columns.map((c) => <th key={c} className="px-2 py-1.5 font-medium">{c.replace(/_/g, " ")}</th>)}</tr>
                </thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    <tr key={i} className="border-t border-line">
                      {r.columns.map((c) => <td key={c} className="px-2 py-1 font-mono text-[11.5px] text-ink-2">{row[c] == null ? "—" : String(row[c])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : r ? (
            <EmptyState title="No rows yet" description={r.note ?? "This report fills in as the backend records data."} />
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

function safeJson(raw: string, fallback: unknown) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function BackendDown({ error }: { error: string }) {
  return (
    <Card>
      <CardBody className="space-y-2 text-[13px]">
        <p className="flex items-center gap-2 font-medium text-ink">
          <Loader2 className="h-4 w-4" /> The intelligence backend isn&apos;t reachable
        </p>
        <p className="text-ink-2">{error}</p>
        <pre className="rounded-lg bg-shell p-2.5 font-mono text-[12px] text-ink">PYTHONPATH=. uvicorn backend.main:app --port 8000</pre>
        <p className="text-muted">It shares the SQLite database (.data/twin.db) with this app. Set its URL in Integrations → Intelligence backend if it runs elsewhere.</p>
      </CardBody>
    </Card>
  );
}
