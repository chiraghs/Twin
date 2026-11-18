"use client";

import { useState } from "react";
import { Dices } from "lucide-react";
import { api } from "@/client/api";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Select } from "@/components/ui/primitives";
import type { ExperimentResult, Stat } from "@/domain/experiments";
import type { ScenarioDefinition } from "@/domain/types";
import { fmtInt } from "@/lib/format";
import { scenarioColor } from "./compare";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ci = (s: Stat, f: (v: number) => string) => `${f(s.mean)} (${f(s.ci95[0])}–${f(s.ci95[1])})`;

/** Experiment: each plan replicated with uncertain inputs varied; means, 95 % intervals and odds. */
export function ExperimentPanel({ defs, targetAssetId }: { defs: ScenarioDefinition[]; targetAssetId: string }) {
  const [replications, setReplications] = useState(20);
  const [spread, setSpread] = useState(0.2);
  const [result, setResult] = useState<ExperimentResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<ExperimentResult>("/api/experiments", { body: { targetAssetId, definitions: defs, replications, spread, seed: 7 } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Experiment under uncertainty"
        description="Runs every plan many times with repair and maintenance durations, supplier fill rates and order quantities varied. Every plan sees the same draws, so the comparison is fair."
        icon={<Dices className="h-4 w-4" />}
        actions={
          <div className="flex items-center gap-2">
            <Select aria-label="Replications" value={replications} onChange={(e) => setReplications(Number(e.target.value))}>
              {[10, 20, 40].map((n) => (
                <option key={n} value={n}>
                  {n} runs
                </option>
              ))}
            </Select>
            <Select aria-label="Uncertainty" value={spread} onChange={(e) => setSpread(Number(e.target.value))}>
              <option value={0.1}>Low uncertainty</option>
              <option value={0.2}>Medium uncertainty</option>
              <option value={0.35}>High uncertainty</option>
            </Select>
            <Button size="sm" variant="primary" loading={busy} onClick={run}>
              Run experiment
            </Button>
          </div>
        }
      />
      <CardBody className="space-y-3">
        {error && <p className="text-[12px] text-critical-ink">{error}</p>}
        {!result ? (
          <EmptyState title="No experiment yet" description="A single what-if run assumes everything goes to plan. An experiment shows how likely each plan is to hold up when it doesn't." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]" data-testid="experiment-table">
                <thead className="text-left text-muted">
                  <tr>
                    {["Plan", "Score (95% CI)", "Late units (95% CI)", "Cost $ (mean)", "P(late orders)", "P(asset failure)", "P(best plan)"].map((h) => (
                      <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.plans.map((p) => (
                    <tr key={p.scenarioId} className="border-t border-line">
                      <td className="px-2 py-1.5">
                        <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: scenarioColor(p.scenarioId) }} />
                        <span className="text-ink">{p.name}</span>
                        {result.recommendedId === p.scenarioId && <Badge tone="accent" className="ml-1.5">recommended</Badge>}
                      </td>
                      <td className="tabular px-2 py-1.5 text-ink-2">{ci(p.score, (v) => v.toFixed(1))}</td>
                      <td className="tabular px-2 py-1.5 text-ink-2">{ci(p.lateUnits, fmtInt)}</td>
                      <td className="tabular px-2 py-1.5 text-ink-2">{fmtInt(p.operatingCost.mean)}</td>
                      <td className="tabular px-2 py-1.5"><Badge tone={p.pLate > 0.5 ? "warning" : p.pLate > 0 ? "neutral" : "healthy"}>{pct(p.pLate)}</Badge></td>
                      <td className="tabular px-2 py-1.5"><Badge tone={p.pFailure > 0 ? "critical" : "healthy"}>{pct(p.pFailure)}</Badge></td>
                      <td className="tabular px-2 py-1.5 font-medium text-ink">{pct(p.pBest)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11.5px] text-muted">
              <p className="mb-1">
                {result.replications} replications per plan · seed {result.seed} (reproducible). Varied inputs:
              </p>
              <ul className="list-disc space-y-0.5 pl-5">
                {result.inputs.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
