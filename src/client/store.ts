"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { serverStorage } from "./server-storage";
import type { PipelineEvent } from "@/domain/agents/pipeline";
import type { FaultInput } from "@/domain/commands";
import type {
  AgentId,
  AgentReport,
  CameraStreamKind,
  FactoryState,
  Narrative,
  Recommendation,
  ScenarioDefinition,
  ScenarioKind,
  ScenarioResult,
  ScenarioRun,
  StageState,
  VisionReview,
} from "@/domain/types";
import type { Anomaly } from "@/domain/anomaly";
import type { InspectionResult } from "@/domain/vision";
import { api, apiForm, ApiError, streamNdjson } from "./api";

/* ───────────────────────────── Factory store ───────────────────────────── */

export type ToastTone = "success" | "error" | "info";
export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

export interface LiveAnalysis {
  id: string | null;
  running: boolean;
  startedAt: number;
  stages: StageState[];
  observation: { focusAssetId: string; anomalies: Anomaly[]; assetsScanned: number; readings: number } | null;
  agents: Partial<Record<AgentId, { status: "running" | "complete"; report?: AgentReport }>>;
  forecast: ScenarioResult | null;
  run: ScenarioRun | null;
  narrative: Narrative | null;
  recommendation: Recommendation | null;
  log: { at: number; text: string; kind: "stage" | "agent" | "result" | "error" }[];
  error: string | null;
  committed: boolean;
}

interface FactoryStore {
  state: FactoryState | null;
  loadError: string | null;
  busy: Record<string, boolean>;
  toasts: Toast[];
  analysis: LiveAnalysis | null;
  ticking: boolean;
  load: () => Promise<void>;
  apply: (s: FactoryState) => void;
  run: <T>(key: string, fn: () => Promise<T>, success?: string | ((r: T) => string)) => Promise<T | undefined>;
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  tick: () => Promise<void>;
  setLive: (enabled: boolean) => Promise<void>;
  reset: () => Promise<void>;
  switchFacility: (id: string) => Promise<boolean>;
  crisis: () => Promise<boolean>;
  advance: (hours: number) => Promise<void>;
  injectFault: (input: FaultInput) => Promise<void>;
  addAsset: (input: { lineId: string; kind: string; name?: string; position?: number }) => Promise<string | undefined>;
  updateAsset: (id: string, patch: Record<string, unknown>) => Promise<boolean>;
  connect: (source: string, target: string) => Promise<void>;
  runScenarios: (targetAssetId: string, definitions?: ScenarioDefinition[]) => Promise<ScenarioRun | undefined>;
  createRecommendation: (scenarioRunId: string, scenarioId: string) => Promise<Recommendation | undefined>;
  approve: (id: string, by: string, note: string) => Promise<boolean>;
  reject: (id: string, by: string, note: string) => Promise<boolean>;
  rollback: (id: string, by: string) => Promise<boolean>;
  createFactory: (bp: Record<string, unknown>) => Promise<boolean>;
  analyze: () => Promise<boolean>;
  logCameraView: (id: string) => Promise<void>;
  setCameraStream: (id: string, kind: CameraStreamKind, url: string | null, clipId?: string | null) => Promise<boolean>;
  setCameraStreams: (streams: { id: string; kind: CameraStreamKind; url?: string | null; clipId?: string | null }[], success: string) => Promise<boolean>;
  analyzeCameraFeed: (cameraId: string, engine: "ai" | "opencv", sheet?: { blob: Blob; times: number[] }) => Promise<VisionReview | undefined>;
  reviewInspectionLog: (cameraId: string) => Promise<VisionReview | undefined>;
  /** `frames` marks `file` as a contact sheet of a clip (times in seconds). */
  analyzeMedia: (file: File | Blob, cameraId: string | null, frames?: number[], fileName?: string) => Promise<VisionReview | undefined>;
  inspectWithService: (file: File, reference: File | null, cameraId: string | null) => Promise<{ review: VisionReview; result: InspectionResult } | undefined>;
  dispositionReview: (id: string, disposition: "confirmed" | "dismissed", note: string) => Promise<boolean>;
}

let toastSeq = 1;

export const useFactory = create<FactoryStore>((set, get) => ({
  state: null,
  loadError: null,
  busy: {},
  toasts: [],
  analysis: null,
  ticking: false,

  load: async () => {
    try {
      const s = await api<FactoryState>("/api/factory");
      set({ state: s, loadError: null });
    } catch (e) {
      set({ loadError: e instanceof Error ? e.message : String(e) });
    }
  },

  apply: (s) => set({ state: s }),

  run: async (key, fn, success) => {
    set((st) => ({ busy: { ...st.busy, [key]: true } }));
    try {
      const r = await fn();
      if (success) get().toast({ tone: "success", title: typeof success === "function" ? success(r) : success });
      return r;
    } catch (e) {
      const err = e as { message?: string; issues?: string[] };
      get().toast({ tone: "error", title: err.message ?? "Request failed", detail: err.issues?.join("; ") });
      return undefined;
    } finally {
      set((st) => ({ busy: { ...st.busy, [key]: false } }));
    }
  },

  toast: (t) => {
    const id = toastSeq++;
    set((st) => ({ toasts: [...st.toasts.slice(-3), { ...t, id }] }));
    setTimeout(() => get().dismiss(id), t.tone === "error" ? 7000 : 4200);
  },
  dismiss: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),

  tick: async () => {
    if (get().ticking) return;
    set({ ticking: true });
    try {
      const r = await api<{ advanced: boolean; state: FactoryState }>("/api/telemetry/tick", { method: "POST" });
      if (r.advanced || r.state.clock.tick !== get().state?.clock.tick) set({ state: r.state });
    } catch {
      /* transient — next tick retries */
    } finally {
      set({ ticking: false });
    }
  },

  setLive: async (enabled) => {
    await get().run("live", async () => get().apply(await api<FactoryState>("/api/telemetry/live", { body: { enabled } })));
  },

  reset: async () => {
    await get().run(
      "reset",
      async () => {
        get().apply(await api<FactoryState>("/api/factory/reset", { method: "POST" }));
        set({ analysis: null });
        useUi.getState().clearHighlight();
        useWorkbench.getState().clear();
      },
      "Demo factory restored to its initial state",
    );
  },

  switchFacility: async (id: string) => {
    const ok = await get().run("switchFacility", async () => {
      const next = await api<FactoryState>("/api/facilities/switch", { body: { id } });
      get().apply(next);
      set({ analysis: null });
      useUi.getState().clearHighlight();
      useWorkbench.getState().clear();
      return true;
    }, "Switched active factory twin");
    return !!ok;
  },

  crisis: async () => {
    const ok = await get().run("crisis", async () => {
      get().apply(await api<FactoryState>("/api/demo/crisis", { method: "POST" }));
      set({ analysis: null });
      useUi.getState().clearHighlight();
      useWorkbench.getState().clear();
      return true;
    });
    return !!ok;
  },

  advance: async (hours) => {
    await get().run(
      "advance",
      async () => get().apply(await api<FactoryState>("/api/sim/advance", { body: { hours } })),
      `Plant advanced ${hours} h`,
    );
  },

  injectFault: async (input) => {
    await get().run(
      "fault",
      async () => get().apply(await api<FactoryState>("/api/faults", { body: input })),
      `Fault injected on ${input.assetId}: ${input.mode}`,
    );
  },

  addAsset: async (input) => {
    const r = await get().run(
      "addAsset",
      async () => {
        const res = await api<{ asset: { id: string }; state: FactoryState }>("/api/assets", { body: input });
        get().apply(res.state);
        return res.asset.id;
      },
      (id) => `Asset ${id} added`,
    );
    return r;
  },

  updateAsset: async (id, patch) => {
    const r = await get().run(
      "updateAsset",
      async () => {
        const res = await api<{ state: FactoryState }>(`/api/assets/${id}`, { method: "PATCH", body: patch });
        get().apply(res.state);
        return true;
      },
      `Asset ${id} updated`,
    );
    return !!r;
  },

  connect: async (source, target) => {
    await get().run(
      "connect",
      async () => get().apply((await api<{ state: FactoryState }>("/api/connections", { body: { source, target } })).state),
      "Dependency added",
    );
  },

  runScenarios: async (targetAssetId, definitions) => {
    return get().run(
      "scenarios",
      async () => {
        const res = await api<{ run: ScenarioRun; state: FactoryState }>("/api/scenarios", { body: { targetAssetId, definitions, persist: true } });
        get().apply(res.state);
        return res.run;
      },
      (r) => `Scenario run ${r.id} recorded`,
    );
  },

  createRecommendation: async (scenarioRunId, scenarioId) => {
    return get().run(
      "recommend",
      async () => {
        const res = await api<{ recommendation: Recommendation; state: FactoryState }>("/api/recommendations", { body: { scenarioRunId, scenarioId } });
        get().apply(res.state);
        return res.recommendation;
      },
      (r) => `${r.id} sent for approval`,
    );
  },

  approve: async (id, by, note) => {
    const r = await get().run(
      "decide",
      async () => {
        const res = await api<{ state: FactoryState }>(`/api/recommendations/${id}/approve`, { body: { by, note } });
        get().apply(res.state);
        return true;
      },
      `${id} approved — actions applied to the twin`,
    );
    return !!r;
  },

  reject: async (id, by, note) => {
    const r = await get().run(
      "decide",
      async () => {
        const res = await api<{ state: FactoryState }>(`/api/recommendations/${id}/reject`, { body: { by, note } });
        get().apply(res.state);
        return true;
      },
      `${id} rejected`,
    );
    return !!r;
  },

  rollback: async (id, by) => {
    const r = await get().run(
      "rollback",
      async () => {
        const res = await api<{ state: FactoryState }>(`/api/recommendations/${id}/rollback`, { body: { by } });
        get().apply(res.state);
        return true;
      },
      `${id} rolled back`,
    );
    return !!r;
  },

  createFactory: async (bp) => {
    const r = await get().run(
      "create",
      async () => {
        get().apply(await api<FactoryState>("/api/factory", { body: bp }));
        set({ analysis: null });
        useUi.getState().clearHighlight();
        useWorkbench.getState().clear();
        return true;
      },
      "Digital twin created",
    );
    return !!r;
  },

  analyze: async () => {
    if (get().analysis?.running) return false;
    const fresh: LiveAnalysis = {
      id: null,
      running: true,
      startedAt: Date.now(),
      stages: [],
      observation: null,
      agents: {},
      forecast: null,
      run: null,
      narrative: null,
      recommendation: null,
      log: [],
      error: null,
      committed: false,
    };
    set({ analysis: fresh });
    const update = (fn: (a: LiveAnalysis) => LiveAnalysis) => set((st) => ({ analysis: st.analysis ? fn(st.analysis) : st.analysis }));
    const log = (text: string, kind: LiveAnalysis["log"][number]["kind"]) => update((a) => ({ ...a, log: [...a.log, { at: Date.now(), text, kind }] }));
    try {
      await streamNdjson<PipelineEvent | { type: "committed"; state: FactoryState } | { type: "discarded"; reason: string }>("/api/agents/analyze", (e) => {
        switch (e.type) {
          case "start":
            update((a) => ({ ...a, id: e.analysis.id, stages: e.analysis.stages }));
            log(`Analysis ${e.analysis.id} started`, "stage");
            break;
          case "stage":
            update((a) => ({
              ...a,
              stages: a.stages.map((s) => (s.stage === e.stage ? { ...s, status: e.status, summary: e.summary ?? s.summary } : s)),
            }));
            if (e.summary) log(`${e.stage.toUpperCase()} · ${e.summary}`, "stage");
            break;
          case "observation":
            update((a) => ({ ...a, observation: { focusAssetId: e.focusAssetId, anomalies: e.anomalies, assetsScanned: e.assetsScanned, readings: e.readings } }));
            break;
          case "agent":
            update((a) => ({ ...a, agents: { ...a.agents, [e.agentId]: { status: e.status, report: e.report } } }));
            if (e.report) log(`${e.agentId} agent · ${e.report.summary}`, "agent");
            break;
          case "forecast":
            update((a) => ({ ...a, forecast: e.forecast }));
            break;
          case "scenarios":
            update((a) => ({ ...a, run: e.run }));
            break;
          case "narrative":
            update((a) => ({ ...a, narrative: e.narrative }));
            break;
          case "recommendation":
            update((a) => ({ ...a, recommendation: e.recommendation }));
            log(`${e.recommendation.id} proposed: ${e.recommendation.title}`, "result");
            break;
          case "complete":
            break;
          case "committed":
            set({ state: e.state });
            update((a) => ({ ...a, committed: true }));
            break;
          case "discarded":
            update((a) => ({ ...a, error: e.reason }));
            log(e.reason, "error");
            break;
          case "error":
            update((a) => ({ ...a, error: e.message }));
            log(e.message, "error");
            break;
        }
      });
      update((a) => ({ ...a, running: false }));
      const a = get().analysis;
      if (a?.run) useWorkbench.getState().loadRun(a.run);
      return !a?.error;
    } catch (e) {
      update((a) => ({ ...a, running: false, error: e instanceof Error ? e.message : String(e) }));
      get().toast({ tone: "error", title: e instanceof Error ? e.message : "Analysis failed" });
      return false;
    }
  },

  logCameraView: async (id) => {
    try {
      const r = await api<{ state: FactoryState }>(`/api/cameras/${id}/view`, { body: { by: useUi.getState().operator } });
      get().apply(r.state);
    } catch {
      /* the view itself still works; the access log is best-effort from the client's side */
    }
  },

  setCameraStream: async (id, kind, url, clipId = null) => {
    const r = await get().run(
      "cameraStream",
      async () => {
        const res = await api<{ state: FactoryState }>(`/api/cameras/${id}`, { method: "PATCH", body: { kind, url, clipId, by: useUi.getState().operator } });
        get().apply(res.state);
        return true;
      },
      kind === "simulated" ? `${id} switched to the twin feed` : kind === "footage" ? `${id} now loops reference footage` : `${id} now plays the ${kind.toUpperCase()} gateway stream`,
    );
    return !!r;
  },

  setCameraStreams: async (streams, success) => {
    const r = await get().run(
      "cameraStream",
      async () => {
        const res = await api<{ state: FactoryState }>("/api/cameras/streams", { body: { streams, by: useUi.getState().operator } });
        get().apply(res.state);
        return true;
      },
      success,
    );
    return !!r;
  },

  analyzeCameraFeed: async (cameraId, engine, sheet) => {
    return get().run(
      engine === "ai" ? "feedAi" : "feedOpencv",
      async () => {
        let res: { review: VisionReview; state: FactoryState };
        if (sheet) {
          const form = new FormData();
          form.append("engine", engine);
          form.append("sheet", sheet.blob, "frames.jpg");
          form.append("frames", sheet.times.join(","));
          res = await apiForm<{ review: VisionReview; state: FactoryState }>(`/api/cameras/${cameraId}/analyze`, form);
        } else res = await api<{ review: VisionReview; state: FactoryState }>(`/api/cameras/${cameraId}/analyze`, { body: { engine } });
        get().apply(res.state);
        return res.review;
      },
      (r) => `${r.id}: ${engine === "ai" ? "AI review" : "OpenCV"} returned ${r.findings.length} finding(s) — pending your review`,
    );
  },

  reviewInspectionLog: async (cameraId) => {
    return get().run(
      "visionReview",
      async () => {
        const res = await api<{ review: VisionReview; state: FactoryState }>("/api/vision/review-log", { body: { cameraId } });
        get().apply(res.state);
        return res.review;
      },
      (r) => `${r.id}: ${r.findings.length} reject(s) logged for human review`,
    );
  },

  analyzeMedia: async (file, cameraId, frames, fileName) => {
    return get().run(
      "visionAnalyze",
      async () => {
        const form = new FormData();
        form.append("file", file, fileName ?? (file instanceof File ? file.name : "frames.jpg"));
        if (cameraId) form.append("cameraId", cameraId);
        if (frames?.length) form.append("frames", frames.join(","));
        const data = await apiForm<{ review: VisionReview; state: FactoryState }>("/api/vision/analyze", form);
        get().apply(data.state);
        return data.review;
      },
      (r) => `${r.id}: AI review returned ${r.findings.length} finding(s) — pending your review`,
    );
  },

  inspectWithService: async (file, reference, cameraId) => {
    return get().run(
      "visionInspect",
      async () => {
        const form = new FormData();
        form.append("file", file);
        if (reference) form.append("reference", reference);
        if (cameraId) form.append("cameraId", cameraId);
        const data = await apiForm<{ review: VisionReview; result: InspectionResult; state: FactoryState }>("/api/vision/inspect", form);
        get().apply(data.state);
        return { review: data.review, result: data.result };
      },
      (r) => `${r.review.id}: ${r.review.findings.length} finding(s) measured — pending your review`,
    );
  },

  dispositionReview: async (id, disposition, note) => {
    const r = await get().run(
      "visionDisposition",
      async () => {
        const res = await api<{ state: FactoryState }>(`/api/vision/reviews/${id}`, { method: "PATCH", body: { disposition, note, by: useUi.getState().operator } });
        get().apply(res.state);
        return true;
      },
      `${id} ${disposition}`,
    );
    return !!r;
  },
}));

/* ───────────────────────────── UI preferences ───────────────────────────── */

export interface Highlight {
  runId: string;
  scenarioId: string;
  scenarioName: string;
  kind: ScenarioKind;
  assetIds: string[];
  lineIds: string[];
  itemIds: string[];
  orderIds: string[];
  rerouteLineId: string | null;
  targetAssetId: string;
}

/** The twin highlight for one simulated plan: what it touches, and where work is rerouted. */
export function highlightFor(runId: string, r: ScenarioResult): Highlight {
  return {
    runId,
    scenarioId: r.definition.id,
    scenarioName: r.definition.name,
    kind: r.definition.kind,
    assetIds: r.affectedAssetIds,
    lineIds: r.affectedLineIds,
    itemIds: r.affectedItemIds,
    orderIds: r.affectedOrderIds,
    rerouteLineId: r.definition.params.reroute.enabled ? r.definition.params.reroute.toLineId : null,
    targetAssetId: r.definition.params.targetAssetId,
  };
}

interface UiStore {
  selectedAssetId: string | null;
  highlight: Highlight | null;
  layers: { sensors: boolean; inventory: boolean; orders: boolean; cameras: boolean };
  twinView: "topology" | "iso" | "floor" | "3d";
  nodePositions: Record<string, { x: number; y: number }>;
  guide: { active: boolean; step: number };
  operator: string;
  selectAsset: (id: string | null) => void;
  setHighlight: (h: Highlight | null) => void;
  clearHighlight: () => void;
  toggleLayer: (k: keyof UiStore["layers"]) => void;
  setTwinView: (v: UiStore["twinView"]) => void;
  setNodePosition: (id: string, p: { x: number; y: number }) => void;
  resetLayout: () => void;
  setGuide: (g: Partial<UiStore["guide"]>) => void;
  setOperator: (n: string) => void;
}

export const useUi = create<UiStore>()(
  persist(
    (set) => ({
      selectedAssetId: null,
      highlight: null,
      layers: { sensors: false, inventory: true, orders: true, cameras: true },
      twinView: "topology",
      nodePositions: {},
      guide: { active: false, step: 0 },
      operator: "Shift Lead · Line Ops",
      selectAsset: (id) => set({ selectedAssetId: id }),
      setHighlight: (h) => set({ highlight: h }),
      clearHighlight: () => set({ highlight: null }),
      toggleLayer: (k) => set((s) => ({ layers: { ...s.layers, [k]: !s.layers[k] } })),
      setTwinView: (v) => set({ twinView: v }),
      setNodePosition: (id, p) => set((s) => ({ nodePositions: { ...s.nodePositions, [id]: p } })),
      resetLayout: () => set({ nodePositions: {} }),
      setGuide: (g) => set((s) => ({ guide: { ...s.guide, ...g } })),
      setOperator: (n) => set({ operator: n }),
    }),
    {
      name: "twin-ui",
      storage: createJSONStorage(() => serverStorage),
      version: 1,
      // Layers added in later releases default on for people with older saved preferences.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiStore>;
        return { ...current, ...p, layers: { ...current.layers, ...(p.layers ?? {}) } };
      },
    },
  ),
);

/* ───────────────────────────── Simulator workbench ───────────────────────────── */

interface WorkbenchStore {
  targetAssetId: string | null;
  defs: ScenarioDefinition[];
  selectedId: string;
  sourceRunId: string | null;
  setTarget: (id: string, defs: ScenarioDefinition[]) => void;
  setDefs: (defs: ScenarioDefinition[]) => void;
  updateDef: (id: string, fn: (d: ScenarioDefinition) => ScenarioDefinition) => void;
  select: (id: string) => void;
  loadRun: (run: ScenarioRun) => void;
  clear: () => void;
}

export const useWorkbench = create<WorkbenchStore>()(
  persist(
    (set) => ({
      targetAssetId: null,
      defs: [],
      selectedId: "reroute",
      sourceRunId: null,
      setTarget: (id, defs) => set({ targetAssetId: id, defs, sourceRunId: null }),
      setDefs: (defs) => set({ defs }),
      updateDef: (id, fn) => set((s) => ({ defs: s.defs.map((d) => (d.id === id ? fn(d) : d)) })),
      select: (id) => set({ selectedId: id }),
      loadRun: (run) =>
        set({
          targetAssetId: run.targetAssetId,
          defs: run.results.map((r) => r.definition),
          selectedId: run.recommendedId ?? "reroute",
          sourceRunId: run.id,
        }),
      clear: () => set({ targetAssetId: null, defs: [], selectedId: "reroute", sourceRunId: null }),
    }),
    { name: "twin-workbench", storage: createJSONStorage(() => serverStorage), version: 1 },
  ),
);
