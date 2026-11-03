"use client";

import { Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, ClipboardCheck, CopyPlus, FlaskConical, Network, Play, RotateCcw, Trash2 } from "lucide-react";
import { consumptionPerHour } from "@/domain/kpis";
import { applyShared, pickFocusAsset, presetScenarios, type SharedAssumptions } from "@/domain/scenarios";
import { primaryProductOf, rankScenarios, simulateScenarios } from "@/domain/simulation";
import type { FactoryState, ScenarioDefinition, ScenarioResult } from "@/domain/types";
import { highlightFor, useFactory, useUi, useWorkbench } from "@/client/store";
import { KeyValue, PageHeader, SectionLabel } from "@/components/page";
import { AssumptionsPanel, PlanLevers } from "@/components/simulator/levers";
import { ComparisonTable, ConditionChart, OutputChart, ScenarioCards, Timeline, scenarioColor } from "@/components/simulator/compare";
import { TwinCanvas } from "@/components/twin/twin-canvas";
import { IsoMini } from "@/components/iso/iso-card";
import { Badge, Button, Card, CardBody, CardHeader, Select, Tabs, TabsContent, TabsList, TabsTrigger, Tip } from "@/components/ui/primitives";
import { fmtInt, fmtSimTime } from "@/lib/format";

export default function SimulatorPage() {
  return (
    <Suspense>
      <Simulator />
    </Suspense>
  );
}


function sharedOf(defs: ScenarioDefinition[], state: FactoryState): SharedAssumptions {
  const p = defs[0]?.params;
  return {
    horizonHours: p?.horizonHours ?? 48,
    unplannedRepairHours: p?.unplannedRepairHours ?? state.costModel.unplannedRepairHours,
    energyPricePerKwh: p?.energyPricePerKwh ?? state.costModel.energyPricePerKwh,
    idlePowerFactor: p?.idlePowerFactor ?? state.costModel.idlePowerFactor,
    inventoryAvailabilityPct: p?.inventoryAvailabilityPct ?? {},
    expediteItemIds: p?.expediteItemIds ?? [],
    orderOverrides: p?.orderOverrides ?? {},
  };
}

function Simulator() {
  const router = useRouter();
  const params = useSearchParams();
  const live = useFactory((s) => s.state)!;
  const busy = useFactory((s) => s.busy);
  const runScenarios = useFactory((s) => s.runScenarios);
  const createRecommendation = useFactory((s) => s.createRecommendation);
  const setHighlight = useUi((s) => s.setHighlight);
  const wb = useWorkbench();

  // Freeze a snapshot so live telemetry ticks don't move numbers while comparing.
  const [snapshot, setSnapshot] = useState<FactoryState>(live);
  const [pathView, setPathView] = useState<"iso" | "topology">("iso");
  const refreshSnapshot = () => setSnapshot(live);

  // Initialise / retarget the workbench.
  useEffect(() => {
    const requested = params.get("asset");
    const valid = (id: string | null) => !!id && snapshot.assets.some((a) => a.id === id);
    if (requested && valid(requested) && requested !== wb.targetAssetId) {
      wb.setTarget(requested, presetScenarios(snapshot, requested));
      return;
    }
    if (!wb.defs.length || !valid(wb.targetAssetId)) {
      const run = snapshot.scenarioRuns.find((r) => r.results.length && r.results[0].hourly.length);
      if (run) wb.loadRun(run);
      else {
        const focus = pickFocusAsset(snapshot).id;
        wb.setTarget(focus, presetScenarios(snapshot, focus));
      }
    }
  }, [params, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const defs = useDeferredValue(wb.defs);
  const results = useMemo(() => (defs.length ? simulateScenarios(snapshot, defs) : []), [snapshot, defs]);
  const ranking = useMemo(() => rankScenarios(results), [results]);
  const recommendedId = ranking[0]?.scenarioId ?? null;
  const selected = results.find((r) => r.definition.id === wb.selectedId) ?? results.find((r) => r.definition.id === recommendedId) ?? results[0];
  const selectedDef = wb.defs.find((d) => d.id === selected?.definition.id);
  const target = snapshot.assets.find((a) => a.id === wb.targetAssetId);
  const shared = sharedOf(wb.defs, snapshot);
  const product = target ? primaryProductOf(snapshot, target.lineId) : null;
  const criticalOrder = snapshot.orders.filter((o) => o.productId === product && o.completedHour === null).sort((a, b) => a.dueHour - b.dueHour)[0] ?? null;
  const bindingItem = useMemo(() => {
    const line = snapshot.lines.find((l) => l.id === target?.lineId);
    const cap = line?.capabilities.find((c) => c.productId === product);
    return (
      cap?.bom
        .map((b) => {
          const i = snapshot.inventory.find((x) => x.id === b.itemId);
          const r = consumptionPerHour(snapshot, b.itemId);
          return { id: b.itemId, cover: i && r > 0 ? i.onHand / r : Infinity };
        })
        .sort((a, b) => a.cover - b.cover)[0]?.id ?? null
    );
  }, [snapshot, target, product]);
  const ordersOverride = criticalOrder ? shared.orderOverrides[criticalOrder.id]?.quantity : undefined;

  // Keep the twin highlight in sync with the selected scenario.
  useEffect(() => {
    if (selected) setHighlight(highlightFor(wb.sourceRunId ?? "workbench", selected));
  }, [selected?.definition.id, selected?.affectedAssetIds.join(","), wb.sourceRunId]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeTarget = (id: string) => wb.setTarget(id, applyShared(presetScenarios(snapshot, id), sharedOf(wb.defs, snapshot)));
  const addCustom = () => {
    const base = wb.defs.find((d) => d.id === wb.selectedId) ?? wb.defs.find((d) => d.kind !== "baseline");
    if (!base) return;
    const custom: ScenarioDefinition = { ...base, id: "custom", kind: "custom", name: "Custom plan", description: `Operator-defined variant of "${base.name}".`, params: { ...base.params, assumeHealthy: false } };
    wb.setDefs([...wb.defs.filter((d) => d.id !== "custom"), custom]);
    wb.select("custom");
  };
  const removeCustom = () => {
    wb.setDefs(wb.defs.filter((d) => d.id !== "custom"));
    wb.select(recommendedId ?? "reroute");
  };

  const simulate = async () => {
    if (!target) return;
    const run = await runScenarios(target.id, wb.defs);
    if (run) {
      wb.loadRun({ ...run, results: run.results });
      wb.select(selected?.definition.id ?? run.recommendedId ?? "reroute");
      setSnapshot(useFactory.getState().state!);
    }
  };
  const sendToApproval = async () => {
    if (!target || !selected) return;
    const run = await runScenarios(target.id, wb.defs);
    if (!run) return;
    const rec = await createRecommendation(run.id, selected.definition.id);
    if (rec) router.push("/approvals");
  };

  const previewHighlight = useMemo(
    () => (selected ? highlightFor(wb.sourceRunId ?? "workbench", selected) : null),
    [selected, wb.sourceRunId],
  );

  if (!results.length || !selected || !target) {
    return <div className="h-96 animate-pulse rounded-xl bg-surface" />;
  }

  const ageH = live.clock.hour - snapshot.clock.hour;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="What-If Twin Simulator"
        description="Compare operating plans on the shared plant model. Every result is calculated from the factory state plus the assumptions on the left."
        actions={
          <>
            <Button size="sm" variant="secondary" onClick={simulate} loading={busy.scenarios && !busy.recommend}>
              <Play className="h-3.5 w-3.5" /> Simulate &amp; record run
            </Button>
            <Button size="sm" variant="primary" onClick={sendToApproval} disabled={selected.definition.kind === "baseline" || !selected.feasible} loading={busy.recommend}>
              <ClipboardCheck className="h-3.5 w-3.5" /> Send “{selected.definition.name}” for approval
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[12px]">
        <span className="text-muted">Asset under study</span>
        <Select className="h-8 max-w-full min-w-0 text-[12.5px]" value={target.id} onChange={(e) => changeTarget(e.target.value)} aria-label="Target asset">
          {snapshot.assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id} · {a.name} · health {a.healthScore.toFixed(0)}
            </option>
          ))}
        </Select>
        <span className="mx-1 h-4 w-px bg-line" />
        <Camera className="h-3.5 w-3.5 text-muted" />
        <span className="text-ink-2">
          Snapshot {fmtSimTime(snapshot, snapshot.clock.hour)} (h+{snapshot.clock.hour.toFixed(2)})
        </span>
        {ageH > 0.05 && <span className="text-muted">· plant has advanced {ageH.toFixed(2)} h</span>}
        <Button size="xs" variant="ghost" onClick={refreshSnapshot}>
          <RotateCcw className="h-3 w-3" /> Refresh snapshot
        </Button>
        <span className="ml-auto text-muted">{wb.sourceRunId ? `Loaded from ${wb.sourceRunId}` : "Preset plans"}</span>
      </div>

      <ScenarioCards results={results} selectedId={selected.definition.id} recommendedId={recommendedId} onSelect={(id) => wb.select(id)} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Plan levers"
              description={selected.definition.name}
              actions={
                selected.definition.id === "custom" ? (
                  <Tip content="Remove custom plan">
                    <Button size="icon" variant="ghost" onClick={removeCustom} aria-label="Remove custom plan">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </Tip>
                ) : (
                  <Tip content="Duplicate as a custom plan">
                    <Button size="xs" variant="secondary" onClick={addCustom}>
                      <CopyPlus className="h-3 w-3" /> Custom
                    </Button>
                  </Tip>
                )
              }
            />
            <CardBody>
              {selectedDef && <PlanLevers state={snapshot} def={selectedDef} onChange={(p) => wb.updateDef(selectedDef.id, (d) => ({ ...d, params: p }))} />}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="pt-4">
              <AssumptionsPanel
                state={snapshot}
                shared={shared}
                bindingItemId={bindingItem}
                criticalOrderId={criticalOrder?.id ?? null}
                onChange={(s) => wb.setDefs(applyShared(wb.defs, s))}
              />
              <Button size="xs" variant="ghost" className="mt-4" onClick={() => wb.setTarget(target.id, presetScenarios(snapshot, target.id))}>
                <RotateCcw className="h-3 w-3" /> Reset plans &amp; assumptions
              </Button>
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Tabs defaultValue="compare">
            <TabsList>
              <TabsTrigger value="compare">Compare scenarios</TabsTrigger>
              <TabsTrigger value="detail">Selected scenario</TabsTrigger>
            </TabsList>
            <TabsContent value="compare" className="mt-3 space-y-4">
              <Card>
                <CardHeader
                  title={`Cumulative ${product ?? ""} output vs ${criticalOrder?.id ?? "demand"}`}
                  description={criticalOrder ? `${criticalOrder.customer} needs ${fmtInt(ordersOverride ?? criticalOrder.quantity)} units by h+${(criticalOrder.dueHour - snapshot.clock.hour).toFixed(1)} (${criticalOrder.priority} priority)` : undefined}
                />
                <CardBody>
                  <OutputChart
                    state={snapshot}
                    results={results}
                    productId={product ?? ""}
                    orderQty={criticalOrder ? (ordersOverride ?? criticalOrder.quantity) - criticalOrder.fulfilled : null}
                    orderDue={criticalOrder ? criticalOrder.dueHour - snapshot.clock.hour : null}
                  />
                </CardBody>
              </Card>
              <div className="grid gap-4 2xl:grid-cols-2">
                <Card>
                  <CardHeader title={`${target.id} vibration trajectory`} description="Calibrated wear trend under each plan" />
                  <CardBody>
                    <ConditionChart results={results} alarm={target.thresholds.vibrationAlarm} trip={target.thresholds.vibrationTrip} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Ranking & rationale" description="Plans that run a machine to a predicted trip rank last" />
                  <CardBody className="space-y-2">
                    {ranking.map((r, i) => {
                      const res = results.find((x) => x.definition.id === r.scenarioId)!;
                      return (
                        <button key={r.scenarioId} onClick={() => wb.select(r.scenarioId)} className="flex w-full items-start gap-3 rounded-lg border border-line bg-shell/60 p-2.5 text-left hover:border-line-strong">
                          <span className="tabular mt-0.5 text-[13px] font-semibold text-muted">#{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                              <span className="h-2 w-2 rounded-[2px]" style={{ background: scenarioColor(r.scenarioId) }} />
                              {res.definition.name}
                            </span>
                            <span className="block text-[11.5px] text-muted">{r.reason}</span>
                          </span>
                          <span className="tabular text-[14px] font-semibold text-ink">{r.score.toFixed(1)}</span>
                        </button>
                      );
                    })}
                    <p className="pt-1 text-[11px] text-muted">Score = delivery 40 + cost 30 + risk 20 + sustainability 10, each relative to the reference plan.</p>
                  </CardBody>
                </Card>
              </div>
              <Card>
                <CardHeader title="Baseline vs scenarios" description="Key KPIs and cost components across all plans" />
                <CardBody>
                  <ComparisonTable results={results} selectedId={selected.definition.id} />
                </CardBody>
              </Card>
            </TabsContent>

            <TabsContent value="detail" className="mt-3 space-y-4">
              <div className="grid gap-4 2xl:grid-cols-2">
                <Card>
                  <CardHeader
                    title={selected.definition.name}
                    description={selected.definition.description}
                    actions={<Badge tone={selected.feasible ? "accent" : "critical"}>{selected.feasible ? `Score ${selected.metrics.score.toFixed(1)}` : "Infeasible"}</Badge>}
                  />
                  <CardBody className="space-y-4">
                    <div>
                      <SectionLabel className="mb-1.5">What happens</SectionLabel>
                      <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-ink-2">
                        {selected.explanation.map((e) => (
                          <li key={e} className="flex gap-2">
                            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <SectionLabel className="mb-1.5">Order outcomes</SectionLabel>
                      {selected.orders.map((o) => (
                        <KeyValue
                          key={o.orderId}
                          k={
                            <span>
                              <span className="font-mono text-ink-2">{o.orderId}</span> {o.customer}
                            </span>
                          }
                          v={
                            !o.dueInHorizon ? (
                              <span className="text-muted">beyond horizon · {fmtInt(o.delivered)} built</span>
                            ) : o.onTime ? (
                              <span className="text-healthy-ink">on time · h+{o.completionHour?.toFixed(1)}</span>
                            ) : (
                              <span className="text-critical-ink">{fmtInt(o.lateUnits)} short at due</span>
                            )
                          }
                        />
                      ))}
                    </div>
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Timeline of events" description={`Simulated over ${selected.definition.params.horizonHours} h`} />
                  <CardBody className="max-h-[420px] overflow-y-auto">
                    <Timeline events={selected.timeline} />
                  </CardBody>
                </Card>
              </div>
              <Card>
                <CardHeader
                  title="Affected assets and production path"
                  description={`${selected.affectedAssetIds.length} assets · ${selected.affectedLineIds.length} lines · ${selected.affectedOrderIds.length} orders`}
                  icon={<Network className="h-4 w-4" />}
                  actions={
                    <Button size="xs" variant="secondary" asChild>
                      <Link href="/twin">
                        <Network className="h-3 w-3" /> Open in Twin Studio
                      </Link>
                    </Button>
                  }
                />
                <div className="relative h-[400px] overflow-hidden border-t border-line bg-deep">
                  <div className="absolute top-2 left-2 z-10 inline-flex rounded-lg border border-line bg-shell p-0.5">
                    {(["iso", "topology"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setPathView(v)}
                        aria-pressed={pathView === v}
                        className={`h-6 rounded-md px-2 text-[11.5px] ${pathView === v ? "bg-surface-3 text-ink" : "text-muted hover:text-ink"}`}
                      >
                        {v === "iso" ? "Isometric" : "Topology"}
                      </button>
                    ))}
                  </div>
                  {pathView === "iso" ? (
                    <div className="h-full w-full p-3">
                      <IsoMini state={snapshot} highlight={previewHighlight} />
                    </div>
                  ) : (
                    <TwinCanvas state={snapshot} highlight={previewHighlight} interactive={false} />
                  )}
                </div>
              </Card>
              <Card>
                <CardHeader title="Assumptions & calibration" icon={<FlaskConical className="h-4 w-4" />} />
                <CardBody>
                  <ul className="space-y-1.5 text-[12px] leading-relaxed text-ink-2">
                    {selected.assumptions.map((a) => (
                      <li key={a} className="flex gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" />
                        {a}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
