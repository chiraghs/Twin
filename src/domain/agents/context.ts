import type { Anomaly, AssetDiagnostics } from "../anomaly";
import type { Asset, AgentId, FactoryState, ScenarioResult, ScenarioRun } from "../types";

export interface AnalysisContext {
  state: FactoryState;
  focus: Asset;
  anomalies: Anomaly[];
  diagnostics: Record<string, AssetDiagnostics>;
  /** "No intervention" projection computed in the PREDICT stage. */
  forecast?: ScenarioResult;
  scenarioRun?: ScenarioRun;
}

export const AGENT_META: Record<AgentId, { name: string; role: string; short: string }> = {
  maintenance: {
    name: "Predictive Maintenance Agent",
    short: "Maintenance",
    role: "Detects abnormal telemetry, estimates failure risk and recommends inspections or maintenance.",
  },
  production: {
    name: "Production Optimization Agent",
    short: "Production",
    role: "Evaluates line capacity, bottlenecks, throughput and production re-routing options.",
  },
  supply: {
    name: "Supply Chain Agent",
    short: "Supply chain",
    role: "Identifies component shortages and order-fulfilment risk across BOMs, stock and inbound POs.",
  },
  quality: {
    name: "Quality Inspection Agent",
    short: "Visual quality",
    role: "Reads the AOI and pack-out inspection cameras: yield, DPMO and defect classes against IPC-A-610, and correlates rejects with machine condition.",
  },
  energy: {
    name: "Energy & Sustainability Agent",
    short: "Energy",
    role: "Finds excessive energy use, idle-asset waste and avoidable scrap.",
  },
  orchestrator: {
    name: "Operations Orchestrator",
    short: "Orchestrator",
    role: "Coordinates findings, simulates operating plans, resolves conflicts and proposes one action plan.",
  },
};

export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtHours = (h: number) => (Number.isFinite(h) ? (h < 10 ? h.toFixed(1) : h.toFixed(0)) + " h" : "not trending");

export function confidenceFrom(r2: number, n: number, tStat: number) {
  const score = Math.max(0, Math.min(1, 0.55 * r2 + 0.25 * Math.min(1, n / 30) + 0.2 * Math.min(1, Math.abs(tStat) / 10)));
  const level: "high" | "medium" | "low" = score >= 0.75 ? "high" : score >= 0.5 ? "medium" : "low";
  return { level, score: Math.round(score * 100) / 100 };
}
