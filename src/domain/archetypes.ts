/**
 * Machine archetype library.
 *
 * Every twin, for any industry, is built from these archetypes. Each one carries the physics
 * template the plant model needs (rates, power, vibration/temperature baselines and limits,
 * sensors, failure mode), the defect classes its degradation produces, and a typical rate range
 * used to sanity-check specs. Values are representative defaults for simulation, not OEM data;
 * replace them with nameplate figures when connecting a real plant.
 */
import type { AssetKind, SensorSpec, Thresholds } from "./types";

export interface MachineTemplate {
  code: string;
  label: string;
  manufacturer: string;
  model: string;
  criticality: "A" | "B" | "C";
  nominalRate: number;
  ratedPowerKw: number;
  idlePowerKw: number;
  baseline: { vibration: number; temperature: number };
  thresholds: Thresholds;
  maintenanceIntervalHours: number;
  sensors: Omit<SensorSpec, "id">[];
  failureMode: string;
}

export interface DefectClass {
  type: string;
  share: number;
  criterion: string;
}

export interface Archetype {
  kind: AssetKind;
  /** Short generic name, e.g. "CNC machining center". */
  name: string;
  /** What it covers, used to map real equipment (and by the builder agent). */
  covers: string;
  /** Typical sustainable rate range in units/hour (for validation warnings). */
  rateRange: [number, number];
  template: MachineTemplate;
  defects: DefectClass[];
}

const VIB = (model = "VB-200 accelerometer", hz = 1000) => ({ kind: "vibration" as const, model, sampleRateHz: hz });
const TEMP = (model: string, hz = 2) => ({ kind: "temperature" as const, model, sampleRateHz: hz });
const POWER = { kind: "power" as const, model: "PM-3 power meter", sampleRateHz: 1 };
const COUNTER = (model = "Cycle counter (PLC tag)") => ({ kind: "counter" as const, model, sampleRateHz: 1 });

export const ARCHETYPES: Record<AssetKind, Archetype> = {
  conveyor: {
    kind: "conveyor",
    name: "Conveyor",
    covers: "Belt, roller, chain or accumulation conveyors; infeed, transfer and merge sections; loaders/unloaders",
    rateRange: [20, 20000],
    template: {
      code: "CNV",
      label: "Infeed Conveyor",
      manufacturer: "Movex Drives",
      model: "MX-400 belt drive",
      criticality: "C",
      nominalRate: 200,
      ratedPowerKw: 3.2,
      idlePowerKw: 1.1,
      baseline: { vibration: 1.6, temperature: 41 },
      thresholds: { vibrationAlarm: 4.5, vibrationTrip: 7.1, temperatureAlarm: 70, temperatureTrip: 85 },
      maintenanceIntervalHours: 3000,
      sensors: [VIB(), POWER],
      failureMode: "Drive roller bearing wear",
    },
    defects: [{ type: "Handling damage / scratches", share: 1, criterion: "Visual damage criteria" }],
  },
  press: {
    kind: "press",
    name: "Industrial press",
    covers: "Servo, hydraulic or mechanical presses: press-fit, stamping, forming, tablet presses, crimping",
    rateRange: [10, 6000],
    template: {
      code: "PRS",
      label: "Press-Fit Station",
      manufacturer: "Hydrotek",
      model: "PF-60 servo press",
      criticality: "B",
      nominalRate: 150,
      ratedPowerKw: 18,
      idlePowerKw: 4.5,
      baseline: { vibration: 2.2, temperature: 52 },
      thresholds: { vibrationAlarm: 5.6, vibrationTrip: 9.0, temperatureAlarm: 80, temperatureTrip: 92 },
      maintenanceIntervalHours: 2500,
      sensors: [VIB(), TEMP("TC-K thermocouple"), POWER],
      failureMode: "Ball-screw preload loss",
    },
    defects: [
      { type: "Press-fit pin damage", share: 0.55, criterion: "IPC-A-610 press-fit pin criteria" },
      { type: "Incomplete press-fit seating", share: 0.45, criterion: "IPC-A-610 press-fit pin criteria" },
    ],
  },
  robot: {
    kind: "robot",
    name: "Assembly robot",
    covers: "Articulated, SCARA or gantry robots: pick-and-place, assembly, machine tending, deburring, dispensing",
    rateRange: [10, 3000],
    template: {
      code: "ROB",
      label: "Assembly Robot",
      manufacturer: "Axion Robotics",
      model: "AX-6 six-axis cell",
      criticality: "A",
      nominalRate: 120,
      ratedPowerKw: 7.5,
      idlePowerKw: 2.1,
      baseline: { vibration: 2.6, temperature: 56 },
      thresholds: { vibrationAlarm: 7.1, vibrationTrip: 11.2, temperatureAlarm: 85, temperatureTrip: 95 },
      maintenanceIntervalHours: 2000,
      sensors: [VIB("VB-300 triaxial accelerometer", 2000), TEMP("RTD-100 joint probe"), POWER, COUNTER()],
      failureMode: "Joint-4 gearbox bearing wear",
    },
    defects: [
      { type: "Component misalignment / skew", share: 0.6, criterion: "IPC-A-610 component placement criteria" },
      { type: "Missing component", share: 0.25, criterion: "IPC-A-610 component presence" },
      { type: "Tombstoning", share: 0.15, criterion: "IPC-A-610 chip component criteria" },
    ],
  },
  camera: {
    kind: "camera",
    name: "Inspection camera",
    covers: "Automated optical inspection, vision systems, checkweighers, CMM / test stations, final inspection",
    rateRange: [10, 40000],
    template: {
      code: "CAM",
      label: "AOI Inspection Camera",
      manufacturer: "Optiq Vision",
      model: "AOI-3D inline",
      criticality: "B",
      nominalRate: 180,
      ratedPowerKw: 1.2,
      idlePowerKw: 0.7,
      baseline: { vibration: 0.6, temperature: 38 },
      thresholds: { vibrationAlarm: 2.0, vibrationTrip: 3.5, temperatureAlarm: 60, temperatureTrip: 72 },
      maintenanceIntervalHours: 4000,
      sensors: [{ kind: "vision", model: "12 MP 3D AOI head", sampleRateHz: 30 }, TEMP("Board temp sensor", 1)],
      failureMode: "Illumination module overheating",
    },
    defects: [{ type: "Handling damage / scratches", share: 1, criterion: "Visual damage criteria" }],
  },
  packager: {
    kind: "packager",
    name: "Packaging machine",
    covers: "Case packers, cartoners, flow wrappers, blister packers, bagging and sealing machines",
    rateRange: [20, 30000],
    template: {
      code: "PKG",
      label: "Carton Packer",
      manufacturer: "Paxon Systems",
      model: "CP-280 case packer",
      criticality: "A",
      nominalRate: 280,
      ratedPowerKw: 22,
      idlePowerKw: 6.5,
      baseline: { vibration: 3.0, temperature: 60 },
      thresholds: { vibrationAlarm: 7.1, vibrationTrip: 11.0, temperatureAlarm: 82, temperatureTrip: 92 },
      maintenanceIntervalHours: 2200,
      sensors: [VIB(), TEMP("Seal-heater thermocouple"), POWER],
      failureMode: "Seal-heater controller drift",
    },
    defects: [
      { type: "Carton seal open", share: 0.8, criterion: "Pack-out seal criteria" },
      { type: "Seal burn / film damage", share: 0.2, criterion: "Pack-out seal criteria" },
    ],
  },
  labeler: {
    kind: "labeler",
    name: "Labeling unit",
    covers: "Print-and-apply labelers, wrap-around labelers, inkjet / laser coders and markers",
    rateRange: [20, 40000],
    template: {
      code: "LBL",
      label: "Label & Seal Unit",
      manufacturer: "Paxon Systems",
      model: "LS-300 print-apply",
      criticality: "B",
      nominalRate: 300,
      ratedPowerKw: 5,
      idlePowerKw: 1.6,
      baseline: { vibration: 1.8, temperature: 45 },
      thresholds: { vibrationAlarm: 4.5, vibrationTrip: 7.1, temperatureAlarm: 70, temperatureTrip: 82 },
      maintenanceIntervalHours: 3000,
      sensors: [VIB(), POWER],
      failureMode: "Applicator pad wear",
    },
    defects: [{ type: "Label skew / missing", share: 1, criterion: "Label placement criteria" }],
  },
  cnc: {
    kind: "cnc",
    name: "CNC machine",
    covers: "Machining centers, lathes, mills, grinders and other CNC metal-cutting machines",
    rateRange: [2, 400],
    template: {
      code: "CNC",
      label: "CNC Machining Center",
      manufacturer: "Vektor Machine Tools",
      model: "VM-500 5-axis",
      criticality: "A",
      nominalRate: 40,
      ratedPowerKw: 22,
      idlePowerKw: 5,
      baseline: { vibration: 1.8, temperature: 38 },
      thresholds: { vibrationAlarm: 4.5, vibrationTrip: 7.1, temperatureAlarm: 65, temperatureTrip: 75 },
      maintenanceIntervalHours: 2000,
      sensors: [VIB("Spindle accelerometer", 5000), TEMP("Spindle RTD"), POWER, COUNTER()],
      failureMode: "Spindle bearing wear",
    },
    defects: [
      { type: "Dimension out of tolerance", share: 0.6, criterion: "Drawing tolerances (GD&T)" },
      { type: "Surface finish out of spec", share: 0.3, criterion: "Drawing surface-roughness spec" },
      { type: "Chatter marks", share: 0.1, criterion: "Visual standard" },
    ],
  },
  mixer: {
    kind: "mixer",
    name: "Mixer / blender",
    covers: "Mixers, blenders, granulators, agitated vessels and kneaders",
    rateRange: [20, 20000],
    template: {
      code: "MIX",
      label: "Industrial Mixer",
      manufacturer: "Blendwell",
      model: "BW-2000 planetary mixer",
      criticality: "B",
      nominalRate: 300,
      ratedPowerKw: 15,
      idlePowerKw: 3,
      baseline: { vibration: 2.4, temperature: 45 },
      thresholds: { vibrationAlarm: 6.3, vibrationTrip: 10, temperatureAlarm: 75, temperatureTrip: 88 },
      maintenanceIntervalHours: 2500,
      sensors: [VIB(), TEMP("Gearbox oil RTD"), POWER],
      failureMode: "Agitator gearbox wear",
    },
    defects: [
      { type: "Mix inconsistency", share: 0.7, criterion: "Batch specification" },
      { type: "Foreign matter", share: 0.3, criterion: "Product specification" },
    ],
  },
  oven: {
    kind: "oven",
    name: "Oven / furnace / dryer",
    covers: "Tunnel and batch ovens, reflow ovens, furnaces, kilns, dryers and curing tunnels",
    rateRange: [10, 30000],
    template: {
      code: "OVN",
      label: "Tunnel Oven",
      manufacturer: "Thermacore",
      model: "TC-80 convection tunnel",
      criticality: "A",
      nominalRate: 400,
      ratedPowerKw: 60,
      idlePowerKw: 25,
      baseline: { vibration: 1.0, temperature: 180 },
      thresholds: { vibrationAlarm: 3.5, vibrationTrip: 5.5, temperatureAlarm: 230, temperatureTrip: 250 },
      maintenanceIntervalHours: 3000,
      sensors: [TEMP("Zone thermocouples (type K)"), VIB("Circulation-fan accelerometer"), POWER],
      failureMode: "Heating element / burner degradation",
    },
    defects: [
      { type: "Thermal process out of spec", share: 0.7, criterion: "Time–temperature profile spec" },
      { type: "Surface discoloration", share: 0.3, criterion: "Visual standard" },
    ],
  },
  filler: {
    kind: "filler",
    name: "Filling machine",
    covers: "Liquid, powder and paste fillers, cappers and monoblocs (filler + capper)",
    rateRange: [50, 60000],
    template: {
      code: "FIL",
      label: "Rotary Filler",
      manufacturer: "Aqualine",
      model: "AF-24 rotary filler",
      criticality: "A",
      nominalRate: 1200,
      ratedPowerKw: 11,
      idlePowerKw: 3.5,
      baseline: { vibration: 2.0, temperature: 40 },
      thresholds: { vibrationAlarm: 5.6, vibrationTrip: 9, temperatureAlarm: 70, temperatureTrip: 82 },
      maintenanceIntervalHours: 2000,
      sensors: [VIB(), POWER, COUNTER("Fill counter (PLC tag)")],
      failureMode: "Filling-valve seal wear",
    },
    defects: [
      { type: "Fill level out of tolerance", share: 0.7, criterion: "Fill weight / volume specification" },
      { type: "Closure defect", share: 0.3, criterion: "Closure torque / seal specification" },
    ],
  },
  molder: {
    kind: "molder",
    name: "Molding machine",
    covers: "Injection, blow and compression molding machines and die-casting cells",
    rateRange: [10, 60000],
    template: {
      code: "IMM",
      label: "Injection Molding Machine",
      manufacturer: "Polyforma",
      model: "PF-250 hydraulic",
      criticality: "A",
      nominalRate: 120,
      ratedPowerKw: 45,
      idlePowerKw: 12,
      baseline: { vibration: 2.8, temperature: 48 },
      thresholds: { vibrationAlarm: 7.1, vibrationTrip: 11, temperatureAlarm: 62, temperatureTrip: 70 },
      maintenanceIntervalHours: 2500,
      sensors: [VIB(), TEMP("Hydraulic oil RTD"), POWER, COUNTER("Shot counter (PLC tag)")],
      failureMode: "Hydraulic pump wear / oil overheating",
    },
    defects: [
      { type: "Short shot", share: 0.4, criterion: "Part drawing / visual standard" },
      { type: "Flash", share: 0.35, criterion: "Part drawing / visual standard" },
      { type: "Sink marks", share: 0.25, criterion: "Visual standard" },
    ],
  },
  welder: {
    kind: "welder",
    name: "Welding cell",
    covers: "Robotic or automatic MIG/TIG/spot/laser welding cells and brazing stations",
    rateRange: [5, 600],
    template: {
      code: "WLD",
      label: "Welding Cell",
      manufacturer: "Arcwise",
      model: "AW-6 robotic MIG cell",
      criticality: "B",
      nominalRate: 60,
      ratedPowerKw: 25,
      idlePowerKw: 3,
      baseline: { vibration: 1.5, temperature: 50 },
      thresholds: { vibrationAlarm: 4.5, vibrationTrip: 7.1, temperatureAlarm: 80, temperatureTrip: 95 },
      maintenanceIntervalHours: 2000,
      sensors: [VIB(), TEMP("Torch coolant RTD"), POWER, COUNTER("Weld counter (PLC tag)")],
      failureMode: "Wire-feed drive wear",
    },
    defects: [
      { type: "Weld porosity", share: 0.4, criterion: "ISO 5817 weld quality level" },
      { type: "Incomplete fusion", share: 0.35, criterion: "ISO 5817 weld quality level" },
      { type: "Spatter / undercut", share: 0.25, criterion: "ISO 5817 weld quality level" },
    ],
  },
  palletizer: {
    kind: "palletizer",
    name: "Palletizer",
    covers: "Robotic and layer palletizers, depalletizers and stretch wrappers",
    rateRange: [20, 30000],
    template: {
      code: "PAL",
      label: "Palletizer",
      manufacturer: "Stackmaster",
      model: "SM-40 robotic palletizer",
      criticality: "B",
      nominalRate: 600,
      ratedPowerKw: 9,
      idlePowerKw: 2.5,
      baseline: { vibration: 2.2, temperature: 45 },
      thresholds: { vibrationAlarm: 5.6, vibrationTrip: 9, temperatureAlarm: 70, temperatureTrip: 85 },
      maintenanceIntervalHours: 3000,
      sensors: [VIB(), POWER, COUNTER()],
      failureMode: "Gripper / layer-head drive wear",
    },
    defects: [
      { type: "Pallet pattern error", share: 0.6, criterion: "Pallet pattern specification" },
      { type: "Case damage", share: 0.4, criterion: "Visual damage criteria" },
    ],
  },
  pump: {
    kind: "pump",
    name: "Pump / transfer unit",
    covers: "Centrifugal and positive-displacement pumps, transfer and dosing units in a process line",
    rateRange: [50, 100000],
    template: {
      code: "PMP",
      label: "Process Pump",
      manufacturer: "Hydraflow",
      model: "HF-80 centrifugal",
      criticality: "B",
      nominalRate: 2000,
      ratedPowerKw: 7.5,
      idlePowerKw: 2,
      baseline: { vibration: 2.0, temperature: 50 },
      thresholds: { vibrationAlarm: 4.5, vibrationTrip: 7.1, temperatureAlarm: 75, temperatureTrip: 90 },
      maintenanceIntervalHours: 4000,
      sensors: [VIB(), TEMP("Bearing RTD"), POWER],
      failureMode: "Bearing wear / cavitation",
    },
    defects: [{ type: "Flow or pressure out of spec", share: 1, criterion: "Process specification" }],
  },
  workstation: {
    kind: "workstation",
    name: "Manual / semi-automatic station",
    covers: "Operator assembly benches, kitting, rework, test and pack-out stations with tools",
    rateRange: [5, 600],
    template: {
      code: "WST",
      label: "Assembly Workstation",
      manufacturer: "Twin",
      model: "Ergo bench + DC torque tool",
      criticality: "C",
      nominalRate: 80,
      ratedPowerKw: 1.5,
      idlePowerKw: 0.5,
      baseline: { vibration: 0.8, temperature: 30 },
      thresholds: { vibrationAlarm: 3, vibrationTrip: 5, temperatureAlarm: 50, temperatureTrip: 60 },
      maintenanceIntervalHours: 6000,
      sensors: [COUNTER("Torque-tool controller (PLC tag)"), POWER],
      failureMode: "Torque-tool calibration drift",
    },
    defects: [
      { type: "Torque out of spec", share: 0.5, criterion: "Assembly torque specification" },
      { type: "Missing or wrong part", share: 0.5, criterion: "Bill of materials" },
    ],
  },
  extruder: {
    kind: "extruder",
    name: "Extruder",
    covers: "Plastic, rubber and food extruders, compounders and pelletizers",
    rateRange: [20, 20000],
    template: {
      code: "EXT",
      label: "Extruder",
      manufacturer: "Extrutec",
      model: "ET-90 single-screw",
      criticality: "A",
      nominalRate: 500,
      ratedPowerKw: 55,
      idlePowerKw: 15,
      baseline: { vibration: 2.5, temperature: 210 },
      thresholds: { vibrationAlarm: 6.3, vibrationTrip: 10, temperatureAlarm: 240, temperatureTrip: 260 },
      maintenanceIntervalHours: 2500,
      sensors: [VIB(), TEMP("Barrel-zone thermocouples"), POWER],
      failureMode: "Screw / barrel wear, heater-band failure",
    },
    defects: [
      { type: "Dimension out of tolerance", share: 0.6, criterion: "Profile drawing tolerances" },
      { type: "Surface defect", share: 0.4, criterion: "Visual standard" },
    ],
  },
};

export const ASSET_KINDS = Object.keys(ARCHETYPES) as AssetKind[];

export function machineTemplate(kind: AssetKind): MachineTemplate {
  return ARCHETYPES[kind].template;
}

export const ASSET_KIND_LABEL: Record<AssetKind, string> = Object.fromEntries(ASSET_KINDS.map((k) => [k, ARCHETYPES[k].name])) as Record<AssetKind, string>;
