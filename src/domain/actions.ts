/**
 * Human-in-the-loop approval and SIMULATED execution.
 *
 * Approving a recommendation converts its proposed actions into directives that the
 * plant model executes on the live twin (maintenance windows, line re-allocation,
 * speed changes) — exactly the controls the simulator evaluated. Nothing here touches
 * real equipment: no PLC writes, no machine commands.
 */
import { appendAudit } from "./audit";
import { DomainError } from "./errors";
import { nextId } from "./ids";
import { round } from "./math";
import { describeAllocation } from "./world";
import type { Directive, ExecutionStep, FactoryState, Recommendation } from "./types";

/** Re-exported so existing `@/domain/actions` imports keep working; the class lives in ./errors. */
export { DomainError };

function getRec(state: FactoryState, id: string) {
  const rec = state.recommendations.find((r) => r.id === id);
  if (!rec) throw new DomainError(`Recommendation ${id} not found`, 404);
  return rec;
}

export function approveRecommendation(state: FactoryState, id: string, by: string, note: string, nowISO: string): Recommendation {
  const rec = getRec(state, id);
  if (rec.status !== "pending") throw new DomainError(`Recommendation ${id} is ${rec.status}; only pending recommendations can be approved.`, 409);
  const now = state.clock.hour;
  rec.status = "approved";
  rec.decision = { by, at: nowISO, hour: now, note };
  appendAudit(state, nowISO, {
    category: "approval",
    actor: by,
    title: `Approved ${rec.id}`,
    detail: `${rec.title}.${note ? ` Note: "${note}"` : ""}`,
    severity: "success",
    refs: { recommendationId: rec.id, assetIds: rec.affectedAssetIds, scenarioRunId: rec.scenarioRunId },
  });

  const steps: ExecutionStep[] = [];
  const maint = rec.actions.find((a) => a.type === "schedule-maintenance");
  const maintEnd = maint ? now + Number(maint.params.startInHours) + Number(maint.params.durationHours) : null;

  for (const action of rec.actions) {
    const step: ExecutionStep = { actionId: action.id, title: action.title, status: "pending", message: "", at: nowISO, directiveIds: [] };
    try {
      if (action.type === "schedule-maintenance") {
        const assetId = String(action.params.assetId);
        const asset = state.assets.find((a) => a.id === assetId);
        if (!asset) throw new DomainError(`Asset ${assetId} not found`);
        const start = now + Number(action.params.startInHours);
        const duration = Number(action.params.durationHours);
        const woId = nextId(state, "WO", 8800);
        state.workOrders.unshift({
          id: woId,
          assetId,
          type: "preventive",
          status: "scheduled",
          startHour: round(start, 4),
          durationHours: duration,
          reason: `${asset.condition.failureMode ?? "Condition-based"} — ${rec.id}`,
          cost: duration * state.costModel.maintenanceLaborPerHour + state.costModel.maintenancePartsCost,
          recommendationId: rec.id,
        });
        const dir: Directive = {
          id: nextId(state, "DIR", 600),
          kind: "maintenance",
          assetId,
          startHour: round(start, 4),
          durationHours: duration,
          workOrderId: woId,
          status: "scheduled",
          recommendationId: rec.id,
        };
        state.directives.push(dir);
        step.directiveIds.push(dir.id);
        step.message = `${woId} scheduled for ${assetId} at h+${(start - now).toFixed(2)} (${duration} h).`;
      } else if (action.type === "reroute-production") {
        const line = state.lines.find((l) => l.id === action.params.toLineId);
        if (!line) throw new DomainError(`Line ${action.params.toLineId} not found`);
        const productId = String(action.params.productId);
        if (!line.capabilities.some((c) => c.productId === productId)) throw new DomainError(`${line.name} cannot build ${productId}`);
        const share = Number(action.params.sharePct) / 100;
        const current = { ...line.allocation };
        const native = Object.keys(current).find((k) => k !== productId && current[k] > 0);
        const allocation: Record<string, number> = { [productId]: share };
        if (native && share < 1) allocation[native] = 1 - share;
        const start = now + Number(action.params.startInHours);
        const dir: Directive = {
          id: nextId(state, "DIR", 600),
          kind: "allocation",
          lineId: line.id,
          allocation,
          startHour: round(start, 4),
          endHour: round(start + Number(action.params.durationHours), 4),
          revertAllocation: current,
          status: "scheduled",
          recommendationId: rec.id,
        };
        state.directives.push(dir);
        step.directiveIds.push(dir.id);
        step.message = `${line.name} → ${describeAllocation(allocation)} until h+${(dir.endHour! - now).toFixed(2)}, then back to ${describeAllocation(current)}.`;
      } else if (action.type === "adjust-speed") {
        const assetId = String(action.params.assetId);
        const asset = state.assets.find((a) => a.id === assetId);
        if (!asset) throw new DomainError(`Asset ${assetId} not found`);
        const dir: Directive = {
          id: nextId(state, "DIR", 600),
          kind: "speed",
          assetId,
          speedPct: Number(action.params.speedPct),
          startHour: now,
          endHour: maintEnd,
          revertSpeedPct: 100,
          status: "scheduled",
          recommendationId: rec.id,
        };
        state.directives.push(dir);
        step.directiveIds.push(dir.id);
        step.message = `${assetId} commanded speed → ${action.params.speedPct}% (simulated setpoint).`;
      } else if (action.type === "expedite-inbound") {
        const item = state.inventory.find((i) => i.id === action.params.itemId);
        if (!item) throw new DomainError(`Item ${action.params.itemId} not found`);
        const eta = now + Number(action.params.etaInHours);
        if (item.inbound.length) {
          item.inbound[0] = { ...item.inbound[0], etaHour: Math.min(item.inbound[0].etaHour, eta), expedited: true };
        } else {
          item.inbound.push({ poId: nextId(state, "PO", 7800), qty: item.reorderPoint, etaHour: eta, expedited: true });
        }
        step.message = `${item.inbound[0].poId} expedited to h+${Number(action.params.etaInHours)} ($${Number(action.params.cost).toLocaleString("en-US")}, simulated).`;
      }
      step.status = "applied";
    } catch (e) {
      step.status = "failed";
      step.message = e instanceof Error ? e.message : String(e);
    }
    steps.push(step);
    appendAudit(state, nowISO, {
      category: "action",
      actor: "Execution engine",
      title: `${step.status === "applied" ? "Applied" : "Failed"}: ${action.title}`,
      detail: step.message,
      severity: step.status === "applied" ? "info" : "critical",
      refs: { recommendationId: rec.id, assetIds: action.assetIds, directiveId: step.directiveIds[0] },
    });
  }
  rec.execution = { status: steps.every((s) => s.status === "applied") ? "applied" : "partially-applied", steps };

  // Supersede other pending recommendations for the same target and mark the incident as mitigating.
  const scenarioTarget = rec.affectedAssetIds[0];
  for (const other of state.recommendations) {
    if (other.id !== rec.id && other.status === "pending" && other.affectedAssetIds[0] === scenarioTarget) other.status = "superseded";
  }
  for (const inc of state.incidents) {
    if (inc.status !== "resolved" && rec.affectedAssetIds.includes(inc.assetId)) inc.status = "mitigating";
  }
  return rec;
}

export function rejectRecommendation(state: FactoryState, id: string, by: string, note: string, nowISO: string): Recommendation {
  const rec = getRec(state, id);
  if (rec.status !== "pending") throw new DomainError(`Recommendation ${id} is ${rec.status}; only pending recommendations can be rejected.`, 409);
  rec.status = "rejected";
  rec.decision = { by, at: nowISO, hour: state.clock.hour, note };
  appendAudit(state, nowISO, {
    category: "rejection",
    actor: by,
    title: `Rejected ${rec.id}`,
    detail: `${rec.title}.${note ? ` Reason: "${note}"` : ""} No changes were applied to the factory.`,
    severity: "warning",
    refs: { recommendationId: rec.id, assetIds: rec.affectedAssetIds },
  });
  return rec;
}

/** Roll back an approved recommendation: cancel scheduled directives, revert active allocation/speed changes. */
export function rollbackRecommendation(state: FactoryState, id: string, by: string, nowISO: string): Recommendation {
  const rec = getRec(state, id);
  if (rec.status !== "approved" || !rec.execution) throw new DomainError(`Recommendation ${id} has not been applied.`, 409);
  const now = state.clock.hour;
  const notes: string[] = [];
  for (const step of rec.execution.steps) {
    for (const dirId of step.directiveIds) {
      const d = state.directives.find((x) => x.id === dirId);
      if (!d) continue;
      if (d.status === "scheduled") {
        d.status = "cancelled";
        if (d.kind === "maintenance") {
          const wo = state.workOrders.find((w) => w.id === d.workOrderId);
          if (wo) wo.status = "cancelled";
        }
        notes.push(`${d.id} cancelled`);
        step.status = "rolled-back";
      } else if (d.status === "active") {
        if (d.kind === "allocation") {
          const line = state.lines.find((l) => l.id === d.lineId);
          if (line) {
            const co = Math.max(...Object.keys(d.allocation).map((pid) => line.capabilities.find((c) => c.productId === pid)?.changeoverHours ?? 0), 0);
            line.allocation = { ...d.revertAllocation };
            line.changeoverUntil = now + co;
          }
          d.status = "cancelled";
          notes.push(`${d.id} reverted (changeover started)`);
          step.status = "rolled-back";
        } else if (d.kind === "speed") {
          const asset = state.assets.find((a) => a.id === d.assetId);
          if (asset) asset.speedPct = d.revertSpeedPct;
          d.status = "cancelled";
          notes.push(`${d.id} reverted`);
          step.status = "rolled-back";
        } else {
          notes.push(`${d.id} maintenance in progress — will run to completion`);
        }
      } else {
        notes.push(`${d.id} already ${d.status}`);
      }
    }
  }
  rec.status = "rolled-back";
  rec.execution.status = "rolled-back";
  appendAudit(state, nowISO, {
    category: "action",
    actor: by,
    title: `Rolled back ${rec.id}`,
    detail: notes.join("; ") || "Nothing to roll back.",
    severity: "warning",
    refs: { recommendationId: rec.id, assetIds: rec.affectedAssetIds },
  });
  for (const inc of state.incidents) {
    if (inc.status === "mitigating" && rec.affectedAssetIds.includes(inc.assetId)) inc.status = "open";
  }
  return rec;
}
