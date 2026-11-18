/**
 * Guided maintenance: turns a work order into an ordered procedure for the technician, with each
 * step signed off by name. Steps follow the machine type's failure mode and limits; the test-run
 * step can only be signed when the live vibration is back under the alarm limit.
 */
import { ARCHETYPES } from "./archetypes";
import { appendAudit } from "./audit";
import { DomainError } from "./errors";
import { round } from "./math";
import type { Asset, AssetKind, FactoryState, WorkOrder } from "./types";

export type StepKind = "safety" | "inspect" | "repair" | "verify" | "close";

export interface GuideStep {
  id: string;
  kind: StepKind;
  title: string;
  detail: string;
  /** Manual search terms for the step (shown as a link to the machine's documents). */
  docHint?: string;
  /** Present on the test-run step: the live check that must pass before it can be signed. */
  check?: { label: string; value: number; limit: number; unit: string; pass: boolean };
  done: { by: string; at: string; hour: number } | null;
}

export interface MaintenanceGuide {
  workOrder: WorkOrder;
  asset: Asset;
  failureMode: string;
  steps: GuideStep[];
  progress: { done: number; total: number };
  /** The next step to do, or null when every step is signed. */
  nextStepId: string | null;
}

/** What has to be isolated before work on each machine type. */
const ENERGY: Partial<Record<AssetKind, string>> = {
  robot: "Robot controller to E-stop, main disconnect off and padlocked; brake release disabled.",
  press: "Main disconnect and hydraulic / pneumatic supply locked out; ram lowered onto blocks.",
  cnc: "Spindle and axis drives off, main disconnect locked out; coolant pump isolated.",
  oven: "Heaters off and locked out; wait until the chamber is below 45 °C.",
  molder: "Heaters and hydraulics locked out; mould area cooled and secured.",
  welder: "Weld power source and robot locked out; shielding gas valve closed.",
  conveyor: "Drive motor disconnect locked out; belt tension relieved.",
  packager: "Main disconnect and compressed air locked out; guards opened only after stop.",
  palletizer: "Main disconnect locked out; gantry parked and pinned.",
};

const isVibration = (mode: string) => /bearing|vibration|preload|gearbox|imbalance|wear/i.test(mode);

/** The procedure for a work order, with the steps already signed. */
export function maintenanceGuide(state: FactoryState, workOrderId: string): MaintenanceGuide {
  const wo = state.workOrders.find((w) => w.id === workOrderId);
  if (!wo) throw new DomainError(`Work order ${workOrderId} not found`, 404);
  const asset = state.assets.find((a) => a.id === wo.assetId);
  if (!asset) throw new DomainError(`Asset ${wo.assetId} not found`, 404);
  const failureMode = asset.condition.failureMode ?? ARCHETYPES[asset.kind]?.template.failureMode ?? "Condition-based maintenance";
  const vib = isVibration(failureMode);
  const t = asset.thresholds;
  const signed = wo.steps ?? {};
  const v = round(asset.signal.vibration, 2);
  const temp = round(asset.signal.temperature, 1);
  const raw: Omit<GuideStep, "done">[] = [
    { id: "s1", kind: "safety", title: "Lock out and tag out", detail: ENERGY[asset.kind] ?? "Main disconnect off and padlocked; every energy source isolated and tagged.", docHint: "lockout" },
    { id: "s2", kind: "safety", title: "Verify zero energy", detail: `Try to start ${asset.name} from its panel; confirm nothing moves and the stored energy (air, hydraulics, springs) is released.` },
    { id: "s3", kind: "inspect", title: `Inspect: ${failureMode.toLowerCase()}`, detail: vib ? "Check the bearing for play, noise and discolouration; record the condition and take photos." : "Inspect the affected module for damage, contamination and loose connections; record the condition.", docHint: failureMode },
    { id: "s4", kind: "repair", title: vib ? "Replace the bearing and re-grease" : "Repair or replace the faulty module", detail: vib ? "Fit the new bearing with the specified tool, grease to the manual's quantity and torque the housing bolts." : "Fit the spare module, reconnect and secure per the manual.", docHint: vib ? "bearing replacement" : "replacement" },
    { id: "s5", kind: "repair", title: vib ? "Check alignment" : "Check settings", detail: vib ? "Re-check shaft / joint alignment and belt tension against the manual's tolerance." : "Restore the module's settings and calibration." },
    { id: "s6", kind: "safety", title: "Remove locks and tags", detail: "Everyone clear, guards closed, locks removed by the people who fitted them." },
    {
      id: "s7",
      kind: "verify",
      title: "Test run",
      detail: vib ? `Run ${asset.name} and confirm the vibration is below the ${t.vibrationAlarm} mm/s alarm limit.` : `Run ${asset.name} and confirm the temperature is below the ${t.temperatureAlarm} °C alarm limit.`,
      check: vib
        ? { label: "Vibration", value: v, limit: t.vibrationAlarm, unit: "mm/s", pass: asset.mode === "running" && v < t.vibrationAlarm }
        : { label: "Temperature", value: temp, limit: t.temperatureAlarm, unit: "°C", pass: asset.mode === "running" && temp < t.temperatureAlarm },
    },
    { id: "s8", kind: "close", title: "Sign off the work order", detail: "Record the parts used and the findings; the work order closes with your name." },
  ];
  const steps: GuideStep[] = raw.map((s) => ({ ...s, done: signed[s.id] ?? null }));
  const done = steps.filter((s) => s.done).length;
  return { workOrder: wo, asset, failureMode, steps, progress: { done, total: steps.length }, nextStepId: steps.find((s) => !s.done)?.id ?? null };
}

/**
 * Sign one step. Steps are signed in order; the test run needs its live check to pass.
 * Audited with the person's name.
 */
export function signMaintenanceStep(state: FactoryState, workOrderId: string, stepId: string, by: string, nowISO: string): MaintenanceGuide {
  const guide = maintenanceGuide(state, workOrderId);
  const wo = guide.workOrder;
  if (wo.status === "cancelled") throw new DomainError(`${wo.id} is cancelled`, 409);
  const step = guide.steps.find((s) => s.id === stepId);
  if (!step) throw new DomainError(`Step ${stepId} not found`, 404);
  if (step.done) throw new DomainError(`"${step.title}" is already signed by ${step.done.by}`, 409);
  if (guide.nextStepId !== stepId) throw new DomainError(`Sign "${guide.steps.find((s) => s.id === guide.nextStepId)?.title}" first: steps are signed in order.`, 409);
  if (step.check && !step.check.pass) {
    throw new DomainError(`${step.check.label} is ${step.check.value} ${step.check.unit}, not yet below the ${step.check.limit} ${step.check.unit} limit${guide.asset.mode !== "running" ? ` (${guide.asset.id} is not running)` : ""}.`, 409);
  }
  const record = { by, at: nowISO, hour: round(state.clock.hour, 4) };
  // Steps record the technician's work; the work order's status stays with the plant model's maintenance window.
  wo.steps = { ...(wo.steps ?? {}), [stepId]: record };
  appendAudit(state, nowISO, {
    category: "action",
    actor: by,
    title: `${wo.id} · ${step.title}`,
    detail: step.check ? `${step.check.label} ${step.check.value} ${step.check.unit} (limit ${step.check.limit}).` : step.detail,
    severity: stepId === "s8" ? "success" : "info",
    refs: { assetIds: [wo.assetId], ...(wo.recommendationId ? { recommendationId: wo.recommendationId } : {}) },
  });
  return maintenanceGuide(state, workOrderId);
}
