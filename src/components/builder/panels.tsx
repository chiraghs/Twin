"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Plus, Send, Trash2, XCircle } from "lucide-react";
import { useBuilder } from "@/client/builder";
import { boxFrom } from "@/domain/builder/draft";
import type { IntegrationKind } from "@/domain/builder/spec";
import { cn } from "@/lib/cn";
import { SectionLabel } from "../page";
import { Badge, Button, EmptyState, Input, Select, Textarea } from "../ui/primitives";
import { ProvBadge } from "./prov";

/* ───────────────────────────── agent chat + questions ───────────────────────────── */

export function AgentPanel() {
  const spec = useBuilder((s) => s.spec)!;
  const chat = useBuilder((s) => s.chat);
  const refine = useBuilder((s) => s.refine);
  const edit = useBuilder((s) => s.edit);
  const busy = useBuilder((s) => s.busy.refine);
  const ai = useBuilder((s) => s.meta?.ai.available ?? false);
  const [text, setText] = useState("");
  const send = async (t: string) => {
    if (!t.trim()) return;
    setText("");
    await refine(t.trim());
  };
  const answered = spec.questions.filter((q) => q.answer);
  return (
    <div className="space-y-4">
      <div>
        <SectionLabel className="mb-2">Ask the agent to change the twin</SectionLabel>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {chat.length === 0 && (
            <p className="text-[12px] leading-relaxed text-muted">
              {ai ? "For example: “Add a second filler on Filling Line 1 at 6,000 bottles/h”, “Connect all fillers over OPC UA”, or “Remove the palletizer”." : "AI edits are turned off. Edit lines, products, robots and connections directly."}
            </p>
          )}
          {chat.map((c, i) => (
            <div key={i} className={cn("rounded-lg px-3 py-2 text-[12.5px]", c.role === "user" ? "ml-6 bg-accent/12 text-ink" : "mr-6 border border-line bg-shell text-ink-2")}>
              {c.text}
              {!!c.applied?.length && (
                <ul className="mt-1 space-y-0.5 text-[11.5px] text-healthy-ink">
                  {c.applied.map((a) => (
                    <li key={a} className="flex items-start gap-1">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> {a}
                    </li>
                  ))}
                </ul>
              )}
              {!!c.rejected?.length && (
                <ul className="mt-1 space-y-0.5 text-[11.5px] text-critical-ink">
                  {c.rejected.map((a) => (
                    <li key={a} className="flex items-start gap-1">
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> Not applied: {a}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Textarea
            rows={2}
            className="min-h-0 text-[12.5px]"
            value={text}
            disabled={!ai}
            placeholder={ai ? "Tell the agent what to change…" : "AI edits are turned off"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            aria-label="Message to the agent"
          />
          <Button variant="agent" size="icon" className="h-auto self-stretch px-3" loading={busy} disabled={!ai || !text.trim()} onClick={() => void send(text)} aria-label="Send to agent">
            {!busy && <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {spec.questions.length > 0 && (
        <div>
          <SectionLabel className="mb-2">The agent&apos;s questions</SectionLabel>
          <ul className="space-y-2">
            {spec.questions.map((q) => (
              <li key={q.id} className="rounded-lg border border-line bg-shell p-2.5">
                <p className="text-[12.5px] text-ink">{q.text}</p>
                <Input
                  className="mt-1.5 h-8 text-[12.5px]"
                  defaultValue={q.answer ?? ""}
                  key={`${q.id}-${q.answer}`}
                  placeholder="Your answer"
                  aria-label={`Answer: ${q.text}`}
                  onBlur={(e) => e.target.value !== (q.answer ?? "") && edit([{ op: "answer_question", questionId: q.id, text: e.target.value }])}
                />
              </li>
            ))}
          </ul>
          {ai && answered.length > 0 && (
            <Button className="mt-2" size="sm" variant="agent" loading={busy} onClick={() => void send(`Update the twin using my answers: ${answered.map((q) => `${q.text} → ${q.answer}`).join("; ")}`)}>
              Apply my answers
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── blueprint overlay ───────────────────────────── */

export function BlueprintPanel({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const spec = useBuilder((s) => s.spec)!;
  const reading = useBuilder((s) => s.reading)!;
  const blueprint = useBuilder((s) => s.blueprint);
  const placed = spec.lines.flatMap((l) => l.machines.filter((m) => m.box).map((m) => ({ ...m, line: l.name })));
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-ink-2">
        <span className="font-medium text-ink">{reading.drawingKind}.</span> {reading.summary}
      </p>
      {blueprint?.url ? (
        <div className="relative w-full overflow-hidden rounded-lg border border-line bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={blueprint.url} alt="Your blueprint with recognised machines" className="block w-full" />
          {reading.segmentation?.footprints
            .filter((f) => !f.matched)
            .map((f, i) => (
              <span
                key={`sam-${i}`}
                className="pointer-events-none absolute border border-dashed border-violet-500/80"
                style={{ left: `${f.box[1] / 10}%`, top: `${f.box[0] / 10}%`, width: `${(f.box[3] - f.box[1]) / 10}%`, height: `${(f.box[2] - f.box[0]) / 10}%` }}
                title={`${reading.segmentation!.model}: unlabelled ${f.concept}`}
              />
            ))}
          {placed.map((m) => (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={cn("absolute border-2", selected === m.id ? "border-accent bg-accent/15" : "border-sky-500/80 hover:bg-sky-500/10")}
              style={{ left: `${m.box!.x * 100}%`, top: `${m.box!.y * 100}%`, width: `${m.box!.w * 100}%`, height: `${m.box!.h * 100}%` }}
              aria-label={`${m.name} on the blueprint`}
            >
              <span className="absolute -top-4 left-0 rounded-sm bg-sky-600 px-1 text-[9.5px] leading-4 whitespace-nowrap text-white">{m.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-line bg-shell p-2.5 text-[12px] text-muted">
          {blueprint?.mimeType === "application/pdf" ? "PDF drawings aren't previewed here; the machines found are listed below." : "Choose the drawing again to see the overlay (files are not stored)."}
        </p>
      )}
      <ul className="space-y-1 text-[12px]">
        {reading.elements
          .filter((e) => e.role === "machine" || e.role === "conveyor")
          .map((e) => {
            const eb = boxFrom(e.box);
            const used = !!eb && placed.some((m) => m.box && m.box.x === eb.x && m.box.y === eb.y && m.box.w === eb.w && m.box.h === eb.h);
            return (
              <li key={e.id} className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-muted">{e.id}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{e.label}</span>
                <span className="text-muted">{e.archetype ?? "?"}</span>
                <span className="tabular w-10 text-right text-muted">{Math.round(e.confidence * 100)}%</span>
                {e.segmented && <Badge tone="agent">SAM 3.1</Badge>}
                {used ? <Badge tone="accent">in twin</Badge> : <Badge tone="neutral">not used</Badge>}
              </li>
            );
          })}
      </ul>
      {reading.notes.length > 0 && <p className="text-[11.5px] text-muted">{reading.notes.join(" ")}</p>}
    </div>
  );
}

/* ───────────────────────────── sources & assumptions ───────────────────────────── */

export function SourcesPanel() {
  const spec = useBuilder((s) => s.spec)!;
  const research = useBuilder((s) => s.research);
  return (
    <div className="space-y-4">
      <div>
        <SectionLabel className="mb-2">Cited sources</SectionLabel>
        {spec.references.length ? (
          <ol className="space-y-1.5">
            {spec.references.map((r) => (
              <li key={r.id} className="flex items-start gap-2 text-[12.5px]">
                <span className="font-mono text-[11px] text-muted">{r.id}</span>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 text-accent-ink hover:underline">
                  {r.title} <ExternalLink className="inline h-3 w-3" />
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12px] text-muted">No web sources were used{research === null ? " (research was off or unavailable)" : ""}.</p>
        )}
      </div>
      {research?.notes && (
        <details className="rounded-lg border border-line bg-shell p-2.5">
          <summary className="cursor-pointer text-[12.5px] font-medium text-ink">Research notes</summary>
          <p className="mt-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">{research.notes}</p>
        </details>
      )}
      <div>
        <SectionLabel className="mb-2">Assumptions</SectionLabel>
        <ul className="space-y-1.5">
          {spec.assumptions.map((a, i) => (
            <li key={i} className="flex items-start gap-2 text-[12.5px] text-ink-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> {a}
            </li>
          ))}
          <li className="flex items-start gap-2 text-[12.5px] text-ink-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> Rates left empty are sized from the line; prices, stock and orders left empty get stated sample values at build time (listed in the audit trail).
          </li>
        </ul>
      </div>
      {spec.blueprint && <p className="text-[11.5px] text-muted">Drawing: {spec.blueprint.fileName} (not stored).</p>}
    </div>
  );
}

/* ───────────────────────────── products & materials ───────────────────────────── */

export function ProductsPanel() {
  const spec = useBuilder((s) => s.spec)!;
  const edit = useBuilder((s) => s.edit);
  const num = (v: string) => (v.trim() && Number(v) > 0 ? Number(v) : null);
  return (
    <div className="space-y-4">
      <div>
        <SectionLabel className="mb-2">Products</SectionLabel>
        <div className="space-y-2">
          {spec.products.map((p) => (
            <div key={p.id} className="rounded-lg border border-line bg-shell p-2.5">
              <div className="flex items-center gap-2">
                <Input className="h-8 text-[12.5px] font-medium" defaultValue={p.name} key={p.name} aria-label="Product name" onBlur={(e) => e.target.value.trim() && e.target.value !== p.name && edit([{ op: "update_product", productId: p.id, name: e.target.value }])} />
                <ProvBadge prov={p.prov} spec={spec} compact />
                <Button size="icon" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => edit([{ op: "remove_product", productId: p.id }])}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5 text-[11px]">
                {(
                  [
                    ["Unit", "unit", p.unit, "text"],
                    ["Rate /h", "ratePerHour", p.ratePerHour, "num"],
                    ["Price", "unitPrice", p.unitPrice, "num"],
                    ["Material cost", "unitMaterialCost", p.unitMaterialCost, "num"],
                  ] as const
                ).map(([label, key, value, kind]) => (
                  <label key={key} className="space-y-0.5 text-muted">
                    {label}
                    <Input
                      className="h-7 text-[12px]"
                      defaultValue={value ?? ""}
                      key={`${p.id}-${key}-${value}`}
                      placeholder={kind === "num" ? "auto" : ""}
                      onBlur={(e) => {
                        const v = e.target.value;
                        if (kind === "text") v.trim() && v !== value && edit([{ op: "update_product", productId: p.id, unit: v }]);
                        else if (key === "ratePerHour" && !v.trim() && p.ratePerHour !== null) edit([{ op: "update_product", productId: p.id, clearRate: true }]);
                        else if (num(v) && num(v) !== value) edit([{ op: "update_product", productId: p.id, [key]: num(v) }]);
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px] text-muted">
                Uses: {p.materials.length ? p.materials.map((b) => `${b.qtyPerUnit} × ${spec.materials.find((m) => m.id === b.materialId)?.name ?? b.materialId}`).join(", ") : "generic raw material (default)"}
              </p>
            </div>
          ))}
        </div>
        <Button className="mt-2" size="sm" variant="secondary" disabled={spec.products.length >= 6} onClick={() => edit([{ op: "add_product", name: `Product ${spec.products.length + 1}` }])}>
          <Plus className="h-3.5 w-3.5" /> Add product
        </Button>
      </div>
      <div>
        <SectionLabel className="mb-2">Materials</SectionLabel>
        <div className="space-y-1.5">
          {spec.materials.map((m) => (
            <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_64px_72px_auto] items-center gap-1.5 text-[12px]">
              <Input className="h-7 text-[12px]" defaultValue={m.name} key={m.name} aria-label="Material name" onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && edit([{ op: "update_material", materialId: m.id, name: e.target.value }])} />
              <Input className="h-7 text-[12px]" defaultValue={m.unitCost ?? ""} key={`${m.id}-c-${m.unitCost}`} placeholder="cost" aria-label="Unit cost" onBlur={(e) => num(e.target.value) && num(e.target.value) !== m.unitCost && edit([{ op: "update_material", materialId: m.id, unitCost: num(e.target.value) }])} />
              <Input className="h-7 text-[12px]" defaultValue={m.leadTimeHours ?? ""} key={`${m.id}-l-${m.leadTimeHours}`} placeholder="lead h" aria-label="Lead time hours" onBlur={(e) => num(e.target.value) && num(e.target.value) !== m.leadTimeHours && edit([{ op: "update_material", materialId: m.id, leadTimeHours: num(e.target.value) }])} />
              <ProvBadge prov={m.prov} spec={spec} compact />
            </div>
          ))}
        </div>
        <Button className="mt-2" size="sm" variant="secondary" disabled={spec.materials.length >= 12} onClick={() => edit([{ op: "add_material", name: `Material ${spec.materials.length + 1}` }])}>
          <Plus className="h-3.5 w-3.5" /> Add material
        </Button>
      </div>
    </div>
  );
}

/* ───────────────────────────── data connections ───────────────────────────── */

export const CONNECTION_META: Record<IntegrationKind, { label: string; status: "active" | "ready" | "planned"; detail: string; placeholder: string }> = {
  simulated: { label: "Built-in telemetry", status: "active", detail: "The twin generates readings. Works today.", placeholder: "" },
  "camera-rtsp": { label: "Camera (RTSP/ONVIF)", status: "ready", detail: "Ready for viewing through a camera gateway.", placeholder: "rtsp://10.0.0.21/stream1" },
  mqtt: { label: "MQTT telemetry", status: "ready", detail: "Ready: machine readings published to the broker topic drive the twin (Integrations → MQTT).", placeholder: "plant/line1/filler/telemetry" },
  opcua: { label: "OPC UA", status: "planned", detail: "Planned: read-only, through the edge gateway.", placeholder: "ns=2;s=Filler.Speed" },
  modbus: { label: "Modbus TCP", status: "planned", detail: "Planned: read-only, through the edge gateway.", placeholder: "10.0.0.40:502 HR 40001–40010" },
  historian: { label: "Historian", status: "planned", detail: "Planned: backfill telemetry history.", placeholder: "PI tag prefix or table" },
  erp: { label: "ERP orders & stock", status: "planned", detail: "Planned: replace sample orders and stock with ERP data.", placeholder: "SAP / Odoo endpoint" },
};

export function ConnectionsPanel() {
  const spec = useBuilder((s) => s.spec)!;
  const edit = useBuilder((s) => s.edit);
  const [target, setTarget] = useState("site");
  const [kind, setKind] = useState<IntegrationKind>("opcua");
  const [address, setAddress] = useState("");
  const targets = [{ id: "site", name: "Whole site" }, ...spec.lines.flatMap((l) => [{ id: l.id, name: l.name }, ...l.machines.map((m) => ({ id: m.id, name: `  ${l.name} › ${m.name}` }))])];
  const nameOf = (id: string) => targets.find((t) => t.id === id)?.name.trim() ?? id;
  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-muted">
        Plan how each line or machine gets real data. Connections are saved with the twin as <span className="text-ink-2">planned</span> until a connector is set up and verified. Never enter passwords here.
      </p>
      {spec.integrations.length ? (
        <ul className="space-y-1.5">
          {spec.integrations.map((i) => {
            const M = CONNECTION_META[i.kind];
            return (
              <li key={i.id} className="flex items-center gap-2 rounded-lg border border-line bg-shell px-2.5 py-2 text-[12px]">
                <Badge tone={M.status === "active" ? "healthy" : M.status === "ready" ? "accent" : "neutral"}>{M.label}</Badge>
                <span className="min-w-0 flex-1 truncate text-ink">{nameOf(i.target)}</span>
                {i.address && <span className="max-w-[40%] truncate font-mono text-[11px] text-muted">{i.address}</span>}
                <ProvBadge prov={i.prov} spec={spec} compact />
                <Button size="icon" variant="ghost" aria-label="Remove connection" onClick={() => edit([{ op: "remove_integration", integrationId: i.id }])}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No data connections yet" description="Plan how each line or machine will send its data." />
      )}
      <div className="space-y-2 rounded-lg border border-line p-2.5">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select className="h-8 text-[12.5px]" aria-label="Connection target" value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Select className="h-8 text-[12.5px]" aria-label="Connection type" value={kind} onChange={(e) => setKind(e.target.value as IntegrationKind)}>
            {(Object.keys(CONNECTION_META) as IntegrationKind[]).map((k) => (
              <option key={k} value={k}>
                {CONNECTION_META[k].label} ({CONNECTION_META[k].status})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <Input className="h-8 text-[12.5px]" value={address} placeholder={CONNECTION_META[kind].placeholder || "Address (optional)"} onChange={(e) => setAddress(e.target.value)} aria-label="Address" />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!edit([{ op: "add_integration", target, kind, address: address.trim() || null }]).length) setAddress("");
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Plan
          </Button>
        </div>
        <p className="text-[11.5px] leading-snug text-muted">{CONNECTION_META[kind].detail}</p>
      </div>
    </div>
  );
}

/* ───────────────────────────── checks ───────────────────────────── */

export function ChecksPanel() {
  const validation = useBuilder((s) => s.validation);
  const issues = validation?.issues ?? [];
  if (!issues.length) return <EmptyState title="All checks passed" description="The spec is consistent and ready to build." />;
  return (
    <ul className="space-y-1.5">
      {issues.map((i, k) => (
        <li key={k} className={cn("flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[12.5px]", i.level === "error" ? "border-critical/40 bg-critical/8" : i.level === "warning" ? "border-warning/40 bg-warning/8" : "border-line bg-shell")}>
          {i.level === "error" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" /> : i.level === "warning" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
          <span className="text-ink-2">{i.message}</span>
        </li>
      ))}
    </ul>
  );
}
