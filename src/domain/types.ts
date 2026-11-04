/**
 * Twin AI — core domain model.
 *
 * Every page, agent and simulation reads from a single `FactoryState`.
 * Time is expressed in simulated hours (`hour`) relative to the demo anchor (t0).
 */

export type AssetKind =
  | "conveyor"
  | "press"
  | "robot"
  | "camera"
  | "packager"
  | "labeler"
  | "cnc"
  | "mixer"
  | "oven"
  | "filler"
  | "molder"
  | "welder"
  | "palletizer"
  | "pump"
  | "workstation"
  | "extruder";

export type AssetStatus = "healthy" | "warning" | "critical" | "offline" | "maintenance";
export type MachineMode = "running" | "down" | "maintenance";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Severity = "info" | "warning" | "critical" | "success";
export type OrderPriority = "critical" | "high" | "standard";
export type DataSourceKind = "demo" | "mqtt" | "cloud";

export interface Thresholds {
  vibrationAlarm: number; // mm/s RMS
  vibrationTrip: number; // mm/s RMS — protective trip / functional failure
  temperatureAlarm: number; // °C
  temperatureTrip: number; // °C
}

/** Hidden physical condition used by the plant model to generate telemetry. Agents never read this directly. */
export interface MachineCondition {
  vibrationExcess: number; // mm/s above baseline caused by wear
  vibrationSlope: number; // mm/s per operating hour at 100% speed
  temperatureExcess: number; // °C above baseline caused by friction
  temperatureSlope: number; // °C per operating hour at 100% speed
  failureMode: string | null;
}

export interface SensorSpec {
  id: string;
  kind: "vibration" | "temperature" | "power" | "counter" | "vision";
  model: string;
  sampleRateHz: number;
}

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  lineId: string;
  manufacturer: string;
  model: string;
  criticality: "A" | "B" | "C";
  mode: MachineMode;
  speedPct: number;
  nominalRate: number; // units/hour at 100% speed
  ratedPowerKw: number;
  idlePowerKw: number;
  baseline: { vibration: number; temperature: number };
  thresholds: Thresholds;
  condition: MachineCondition;
  sensors: SensorSpec[];
  installedYear: number;
  lastMaintenanceHour: number; // sim hour (negative = before t0)
  maintenanceIntervalHours: number;
  downUntil: number | null;
  maintenanceUntil: number | null;
  /** Derived each tick from telemetry (EMA-smoothed measured signal). */
  signal: { vibration: number; temperature: number; powerKw: number; throughput: number };
  status: AssetStatus;
  healthScore: number;
  utilization: number;
  documentIds: string[];
  custom?: boolean;
}

export interface LineCapability {
  productId: string;
  /** Planned sustainable rate (units/h) used for scheduling. */
  ratePerHour: number;
  /** Nameplate design rate (units/h) — the OEE performance reference. */
  designRatePerHour: number;
  changeoverHours: number;
  bom: { itemId: string; qty: number }[];
}

export interface ProductionLine {
  id: string;
  code: string;
  name: string;
  kind: "assembly" | "packaging";
  assetIds: string[]; // flow order
  capabilities: LineCapability[];
  allocation: Record<string, number>; // productId -> share of line time
  baseScrapRate: number;
  downstreamLineId: string | null;
  changeoverUntil: number | null;
  buffer: Record<string, number>; // packaging WIP by product
  state: LineState;
}

export type LineState = "running" | "down" | "maintenance" | "changeover" | "starved" | "idle";

export interface Product {
  id: string;
  name: string;
  sku: string;
  unitMaterialCost: number;
  unitPrice: number;
  /** Defect opportunities per unit (placements + joints + features inspected) — DPMO denominator. */
  inspectionOpportunities: number;
}

export interface InboundShipment {
  poId: string;
  qty: number;
  etaHour: number;
  expedited?: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: "component" | "packaging" | "raw";
  unit: string;
  onHand: number;
  reserved: number;
  reorderPoint: number;
  unitCost: number;
  supplier: string;
  leadTimeHours: number;
  inbound: InboundShipment[];
  expediteCost: number;
  expediteEtaHours: number;
}

export interface CustomerOrder {
  id: string;
  customer: string;
  productId: string;
  quantity: number;
  fulfilled: number;
  dueHour: number;
  priority: OrderPriority;
  penaltyPerLateUnit: number;
  completedHour: number | null;
}

export interface TelemetryReading {
  t: number; // sim hour
  vibration: number;
  temperature: number;
  powerKw: number;
  speedPct: number;
  throughput: number; // units/hour processed
  running: boolean;
}

export interface LineHourRecord {
  hour: number; // integer hour bucket start
  lineId: string;
  plannedHours: number;
  runHours: number;
  plannedDownHours: number;
  unplannedDownHours: number;
  changeoverHours: number;
  starvedHours: number;
  idealUnits: number;
  goodUnits: number;
  scrapUnits: number;
  targetUnits: number;
  energyKwh: number;
  idleEnergyKwh: number;
  /** Scrap attributed to its cause: "process" (baseline) or the contributing machine id. */
  scrapByCause: Record<string, number>;
}

export interface MaintenanceRecord {
  id: string;
  assetId: string;
  type: "preventive" | "corrective" | "inspection" | "predictive";
  hour: number;
  durationHours: number;
  technician: string;
  notes: string;
  cost: number;
}

export interface WorkOrder {
  id: string;
  assetId: string;
  type: "preventive" | "corrective";
  status: "scheduled" | "in-progress" | "completed" | "cancelled";
  startHour: number;
  durationHours: number;
  reason: string;
  cost: number;
  recommendationId?: string;
}

export type Directive =
  | {
      id: string;
      kind: "maintenance";
      assetId: string;
      startHour: number;
      durationHours: number;
      workOrderId: string;
      status: DirectiveStatus;
      recommendationId?: string;
      ruleId?: string;
    }
  | {
      id: string;
      kind: "allocation";
      lineId: string;
      allocation: Record<string, number>;
      startHour: number;
      endHour: number | null;
      revertAllocation: Record<string, number>;
      status: DirectiveStatus;
      recommendationId?: string;
      ruleId?: string;
    }
  | {
      id: string;
      kind: "speed";
      assetId: string;
      speedPct: number;
      startHour: number;
      endHour: number | null;
      revertSpeedPct: number;
      status: DirectiveStatus;
      recommendationId?: string;
      ruleId?: string;
    };

export type DirectiveStatus = "scheduled" | "active" | "completed" | "cancelled";

export interface Incident {
  id: string;
  assetId: string;
  title: string;
  severity: "warning" | "critical";
  status: "open" | "investigating" | "mitigating" | "resolved";
  openedHour: number;
  resolvedHour: number | null;
  source: "telemetry" | "fault-injection" | "operator";
  summary: string;
}

export type AuditCategory =
  | "telemetry-alert"
  | "agent"
  | "recommendation"
  | "scenario"
  | "approval"
  | "rejection"
  | "action"
  | "state-change"
  | "asset"
  | "system";

export interface AuditEntry {
  id: string;
  hour: number;
  at: string; // wall-clock ISO
  category: AuditCategory;
  actor: string;
  title: string;
  detail: string;
  severity: Severity;
  refs: {
    assetIds?: string[];
    incidentId?: string;
    recommendationId?: string;
    scenarioRunId?: string;
    analysisId?: string;
    directiveId?: string;
  };
}

/* ───────────────────────────── Agents ───────────────────────────── */

export type AgentId = "maintenance" | "production" | "supply" | "energy" | "quality" | "orchestrator";
export type WorkflowStage = "observe" | "investigate" | "predict" | "simulate" | "recommend" | "approval";

export interface Evidence {
  label: string;
  value: string;
  source: string;
}

export interface AgentFinding {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  evidence: Evidence[];
  assetIds: string[];
}

export interface AgentProposal {
  title: string;
  detail: string;
  priority: "now" | "soon" | "watch";
}

export interface AgentReport {
  agentId: AgentId;
  status: "idle" | "running" | "complete" | "error";
  summary: string;
  inputs: string[];
  method: string;
  findings: AgentFinding[];
  proposals: AgentProposal[];
  metrics: { label: string; value: string; tone?: Severity }[];
  confidence: { level: "high" | "medium" | "low"; score: number; rationale: string };
  affectedAssetIds: string[];
  durationMs: number;
}

export interface StageState {
  stage: WorkflowStage;
  status: "pending" | "running" | "complete" | "waiting";
  startedAt?: string;
  completedAt?: string;
  summary?: string;
}

export interface Narrative {
  source: "ai" | "deterministic";
  model?: string;
  summary: string;
  rationale: string;
  risks: string[];
  operatorBriefing: string;
  note?: string;
}

export interface AnalysisRun {
  id: string;
  startedHour: number;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "complete" | "error";
  focusAssetId: string | null;
  incidentId: string | null;
  stages: StageState[];
  reports: Partial<Record<AgentId, AgentReport>>;
  scenarioRunId: string | null;
  recommendationId: string | null;
  narrative: Narrative | null;
  error?: string;
}

/* ─────────────────────────── Simulation ─────────────────────────── */

export type ScenarioKind = "baseline" | "continue" | "preventive" | "reroute" | "custom";

export interface ScenarioParams {
  horizonHours: number;
  targetAssetId: string;
  targetSpeedPct: number;
  maintenanceStartHour: number | null; // relative to now; null = no planned maintenance
  maintenanceDurationHours: number;
  unplannedRepairHours: number;
  reroute: {
    enabled: boolean;
    toLineId: string | null;
    sharePct: number;
    startHour: number;
    durationHours: number;
  };
  inventoryAvailabilityPct: Record<string, number>;
  expediteItemIds: string[];
  orderOverrides: Record<string, { quantity?: number; priority?: OrderPriority }>;
  energyPricePerKwh: number;
  idlePowerFactor: number;
  assumeHealthy?: boolean; // baseline reference plan only
}

export interface ScenarioDefinition {
  id: string;
  kind: ScenarioKind;
  name: string;
  description: string;
  params: ScenarioParams;
}

export interface ScoreBreakdown {
  delivery: number; // 0-40
  cost: number; // 0-30
  risk: number; // 0-20
  sustainability: number; // 0-10
}

export interface ScenarioMetrics {
  totalOutput: number;
  outputByProduct: Record<string, number>;
  outputByLine: Record<string, number>;
  targetPlannedDowntimeHours: number;
  targetUnplannedDowntimeHours: number;
  lineDowntimeHours: number;
  failureOccurs: boolean;
  failureHour: number | null;
  ordersDue: number;
  ordersOnTime: number;
  ordersLate: number;
  lateUnits: number;
  onTimeRate: number;
  energyKwh: number;
  idleEnergyKwh: number;
  energyCost: number;
  energyPerUnit: number;
  scrapUnits: number;
  scrapRate: number;
  scrapCost: number;
  maintenanceCost: number;
  repairCost: number;
  changeoverCost: number;
  expediteCost: number;
  latePenaltyCost: number;
  operatingCost: number;
  peakRisk: number; // 0-1
  endHealth: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface HourlyPoint {
  hour: number; // relative to scenario start
  output: number; // good packaged units in hour
  cumulative: number;
  cumulativeByProduct: Record<string, number>;
  lineThroughput: Record<string, number>;
  targetVibration: number;
  targetTemperature: number;
  targetHealth: number;
  energyKwh: number;
  targetMode: MachineMode;
}

export interface TimelineEvent {
  hour: number;
  kind:
    | "maintenance-start"
    | "maintenance-end"
    | "failure"
    | "repair-complete"
    | "changeover"
    | "reroute-start"
    | "reroute-end"
    | "order-complete"
    | "order-late"
    | "inbound"
    | "stockout"
    | "alarm"
    | "rule";
  label: string;
  assetId?: string;
  lineId?: string;
  severity: Severity;
}

export interface OrderOutcome {
  orderId: string;
  customer: string;
  productId: string;
  priority: OrderPriority;
  quantity: number;
  delivered: number;
  dueHour: number; // relative
  completionHour: number | null; // relative
  dueInHorizon: boolean;
  onTime: boolean;
  lateUnits: number;
}

export interface ScenarioResult {
  definition: ScenarioDefinition;
  feasible: boolean;
  infeasibleReason?: string;
  metrics: ScenarioMetrics;
  hourly: HourlyPoint[];
  timeline: TimelineEvent[];
  orders: OrderOutcome[];
  affectedAssetIds: string[];
  affectedLineIds: string[];
  affectedItemIds: string[];
  affectedOrderIds: string[];
  calibration: CalibrationNote[];
  assumptions: string[];
  explanation: string[];
}

export interface CalibrationNote {
  assetId: string;
  vibration: number;
  vibrationSlope: number;
  temperature: number;
  r2: number;
  n: number;
  hoursToTrip: number | null;
}

export interface ScenarioRun {
  id: string;
  createdHour: number;
  at: string;
  source: "agent" | "operator" | "rule";
  targetAssetId: string;
  results: ScenarioResult[];
  baselineId: string;
  recommendedId: string | null;
  ranking: { scenarioId: string; score: number; reason: string }[];
}

/* ───────────────────────── Recommendations ───────────────────────── */

export type ActionType = "schedule-maintenance" | "reroute-production" | "adjust-speed" | "reserve-inventory" | "expedite-inbound" | "place-order";

export interface ProposedAction {
  id: string;
  type: ActionType;
  title: string;
  detail: string;
  assetIds: string[];
  params: Record<string, string | number | boolean>;
  reversible: boolean;
  rollback: string;
}

export interface ImpactLine {
  label: string;
  baseline: number;
  proposed: number;
  unit: string;
  better: "higher" | "lower";
}

export interface ExecutionStep {
  actionId: string;
  title: string;
  status: "pending" | "applied" | "failed" | "rolled-back";
  message: string;
  at: string | null;
  directiveIds: string[];
}

export interface Recommendation {
  id: string;
  createdHour: number;
  at: string;
  source: "orchestrator" | "operator" | "rule" | "intelligence";
  analysisId: string | null;
  scenarioRunId: string;
  scenarioId: string;
  scenarioName: string;
  comparedToScenarioId: string;
  title: string;
  summary: string;
  reason: string;
  evidence: Evidence[];
  benefits: string[];
  risks: string[];
  impact: ImpactLine[];
  affectedAssetIds: string[];
  actions: ProposedAction[];
  confidence: { level: "high" | "medium" | "low"; rationale: string };
  status: "pending" | "approved" | "rejected" | "rolled-back" | "superseded";
  decision: { by: string; at: string; hour: number; note: string } | null;
  execution: { status: "not-started" | "applied" | "partially-applied" | "completed" | "rolled-back"; steps: ExecutionStep[] } | null;
}

/* ─────────────────────────── Factory ─────────────────────────── */

export interface CostModel {
  energyPricePerKwh: number;
  idlePowerFactor: number;
  maintenanceLaborPerHour: number;
  maintenancePartsCost: number;
  unplannedRepairCost: number;
  unplannedRepairHours: number;
  changeoverCost: number;
  ambientTemperature: number;
}

export interface Connection {
  id: string;
  source: string;
  target: string;
  kind: "flow" | "supply" | "fulfils";
}

export interface FactoryProfile {
  id: string;
  name: string;
  industry: string;
  location: string;
  productionType: string;
  dataSource: DataSourceKind;
  createdAt: string;
  isDemo: boolean;
}

export interface SimClock {
  hour: number;
  tick: number;
  anchorISO: string; // wall-clock time represented by hour 0
  liveTelemetry: boolean;
  lastTickAt: number; // epoch ms (server)
  lastHistoryHour: number;
}

/* ─────────────────────────── Cameras & vision ─────────────────────────── */

export type CameraKind = "inspection" | "area" | "thermal" | "dock";
export type VisionAnalytic = "defects" | "ocr-barcode" | "counting" | "line-state" | "zone" | "thermal" | "occupancy";

export interface Camera {
  id: string;
  name: string;
  kind: CameraKind;
  purpose: string;
  standard: string | null; // governing standard for the inspection / measurement
  zone: string;
  lineId: string | null;
  assetId: string | null; // inspection cameras are also line assets
  covers: string[]; // asset ids in the field of view
  analytics: VisionAnalytic[];
  resolution: string;
  fps: number;
  onvifProfile: "S" | "T";
  stream: CameraStream;
  privacy: { faceBlur: boolean; retentionDays: number };
}

/**
 * What a camera shows: the twin-rendered feed, a looped reference clip from the footage library
 * (real video from another facility, labelled as such), or a plant gateway stream.
 */
export type CameraStreamKind = "simulated" | "footage" | "hls" | "mp4" | "mjpeg";
export interface CameraStream {
  kind: CameraStreamKind;
  url: string | null;
  /** Footage library clip id when kind is "footage". */
  clipId?: string | null;
}

export interface VisionFinding {
  timestampSec: number | null;
  category: string;
  description: string;
  severity: "info" | "minor" | "major" | "critical";
  confidence: number; // 0-1, model-reported; 1 for deterministic measurements
  /** Region in the inspected image, normalised 0–1 (machine-vision findings). */
  box?: { x: number; y: number; w: number; h: number };
}

export interface VisionReview {
  id: string;
  cameraId: string | null;
  at: string;
  hour: number;
  source: "ai" | "simulated-inspection-log" | "opencv" | "aoi";
  model?: string;
  fileName: string | null;
  summary: string;
  findings: VisionFinding[];
  disposition: "pending-human-review" | "confirmed" | "dismissed";
  note: string;
  /** AOI reviews: the intelligence backend's inspection id (the disposition is sent back to it). */
  externalId?: string;
}

/** A mobile robot built into the twin from the Twin Builder spec (simulated; no fleet manager connected). */
export interface MobileRobot {
  id: string;
  name: string;
  fleetId: string;
  fleetName: string;
  robotType: "amr" | "agv" | "forklift-agv" | "tugger";
  mission: "kitting" | "line-transfer" | "finished-goods";
  /** Engine id of the line it serves. */
  lineId: string;
  unitsPerTrip: number;
  speedMps: number;
  /** Absent: trips follow line output. */
  trigger?: { kind: "schedule"; everyMinutes: number };
  /** Waypoints on the floor plan (layout units) the robot passes on each trip. */
  route?: { x: number; y: number }[];
}

/**
 * An automation rule from the Twin Builder playground, compiled to engine ids. Rules act on the
 * simulated plant only (purchase orders, line allocation, machine speed, maintenance proposals);
 * they never send commands to real equipment.
 */
export type PlantRule =
  | { id: string; name: string; kind: "inventory"; enabled: boolean; itemId: string; below: number; orderQty: number; leadTimeHours: number }
  | { id: string; name: string; kind: "maintenance"; enabled: boolean; assetId: string | null; metric: "health" | "vibration"; threshold: number }
  | {
      id: string;
      name: string;
      kind: "connector";
      enabled: boolean;
      lineId: string;
      when: "upstream-stops" | "downstream-stops" | "buffer-full";
      action: "divert" | "slow" | "pause";
      toLineId: string | null;
      speedPct: number | null;
      bufferUnits: number | null;
    };

export interface RuleRuntime {
  /** Sequence for rule-created purchase orders and directives. */
  seq: number;
  rules: Record<string, { active: boolean; directiveIds: string[]; fired: number; lastFiredHour: number | null; assets?: string[] }>;
}

/** A planned data connection from the Twin Builder. Planned only until a connector is configured and verified. */
export interface DataConnection {
  id: string;
  /** Engine id of the line or asset, or "site". */
  target: string;
  targetName: string;
  kind: string;
  address: string | null;
  notes: string | null;
  status: "planned";
}

export interface FactoryState {
  schemaVersion: number;
  seed: number;
  profile: FactoryProfile;
  clock: SimClock;
  lines: ProductionLine[];
  assets: Asset[];
  connections: Connection[];
  products: Product[];
  inventory: InventoryItem[];
  orders: CustomerOrder[];
  telemetry: Record<string, TelemetryReading[]>;
  latest: Record<string, TelemetryReading>;
  healthHistory: Record<string, { day: number; score: number }[]>;
  production: LineHourRecord[];
  finishedGoods: Record<string, number>;
  maintenanceHistory: MaintenanceRecord[];
  workOrders: WorkOrder[];
  directives: Directive[];
  incidents: Incident[];
  analyses: AnalysisRun[];
  scenarioRuns: ScenarioRun[];
  recommendations: Recommendation[];
  cameras: Camera[];
  visionReviews: VisionReview[];
  /** The reviewed spec this twin was built from (Twin Builder), with provenance. */
  twinSpec?: import("./builder/spec").TwinSpec | null;
  dataPlan?: DataConnection[];
  /** Mobile robots from the Twin Builder spec. Absent: none, except the demo plant's derived fleet. */
  mobileRobots?: MobileRobot[];
  /** Automation rules from the playground. Absent: none. */
  rules?: PlantRule[];
  ruleRuntime?: RuleRuntime;
  /** Floor positions from the playground, by asset id (layout units, rotation in degrees). Absent: automatic layout. */
  layout?: Record<string, { x: number; y: number; rot: number }>;
  audit: AuditEntry[];
  costModel: CostModel;
  counters: Record<string, number>;
}
