/**
 * Reference templates: typical line configurations per industry, expressed as TwinSpecs.
 * They are starting points to edit, not descriptions of a real plant, and are labelled that way.
 * Used directly ("start from a template") and as the fallback when the AI agent is unavailable.
 */
import type { AssetKind } from "../types";
import type { Prov, SpecLine, SpecMaterial, SpecProduct, TwinSpec } from "./spec";

const T: Prov = { source: "template", note: "Twin reference template: a typical configuration, not a specific plant. Replace rates with nameplate data." };

type M = [name: string, archetype: AssetKind, rate?: number];

function line(id: string, name: string, role: SpecLine["role"], machines: M[], productIds: string[] = []): SpecLine {
  return {
    id,
    name,
    role,
    productIds,
    machines: machines.map(([n, a, r], i) => ({ id: `${id}-m${i + 1}`, name: n, archetype: a, ratePerHour: r ?? null, notes: null, box: null, prov: T })),
    box: null,
    prov: T,
  };
}
const product = (id: string, name: string, unit: string, ratePerHour: number, unitPrice: number, unitMaterialCost: number, materials: [string, number][]): SpecProduct => ({
  id,
  name,
  unit,
  ratePerHour,
  unitPrice,
  unitMaterialCost,
  materials: materials.map(([materialId, qtyPerUnit]) => ({ materialId, qtyPerUnit })),
  prov: T,
});
const material = (id: string, name: string, unit: string, unitCost: number, leadTimeHours: number): SpecMaterial => ({ id, name, unit, onHand: null, unitCost, leadTimeHours, supplier: null, prov: T });

export interface TwinTemplate {
  id: string;
  name: string;
  industry: string;
  description: string;
  keywords: string[];
  spec: TwinSpec;
}

function spec(name: string, industry: string, productionType: string, lines: SpecLine[], products: SpecProduct[], materials: SpecMaterial[], assumptions: string[]): TwinSpec {
  return {
    version: 1,
    site: { name, industry, location: "", productionType, prov: T },
    lines,
    products,
    materials,
    integrations: [],
    references: [],
    assumptions: ["Started from a Twin reference template; all rates, prices and stock levels are typical values to replace with your own.", ...assumptions],
    questions: [],
    blueprint: null,
    mobileRobots: [],
    rules: [],
    options: { rehearsalIncident: false, linesInterchangeable: true },
  };
}

export const TEMPLATES: TwinTemplate[] = [
  {
    id: "electronics-smt",
    name: "Electronics: SMT board assembly",
    industry: "Electronics manufacturing",
    description: "Two SMT lines (paste print, pick-and-place, reflow, AOI) feeding test and pack.",
    keywords: ["electronic", "pcb", "smt", "board", "reflow", "pick and place", "pick-and-place", "aoi", "solder"],
    spec: spec(
      "New electronics plant",
      "Electronics manufacturing",
      "SMT printed-circuit-board assembly",
      [
        line("smt-1", "SMT Line 1", "process", [["Board loader", "conveyor"], ["Solder paste printer", "press"], ["Pick-and-place", "robot"], ["Reflow oven", "oven"], ["AOI", "camera"]], ["ctrl-board"]),
        line("smt-2", "SMT Line 2", "process", [["Board loader", "conveyor"], ["Solder paste printer", "press"], ["Pick-and-place", "robot"], ["Reflow oven", "oven"], ["AOI", "camera"]], ["sensor-board"]),
        line("test-pack", "Test & Pack", "packing", [["Functional test", "workstation"], ["Carton packer", "packager"], ["Label printer", "labeler"]]),
      ],
      [
        product("ctrl-board", "Controller board", "boards", 120, 129, 42, [["pcb-blank", 1], ["component-kit", 1]]),
        product("sensor-board", "Sensor board", "boards", 110, 84, 27, [["pcb-blank", 1], ["component-kit", 1]]),
      ],
      [material("pcb-blank", "PCB blank", "pcs", 5, 96), material("component-kit", "Component kit", "kits", 30, 72), material("carton", "Anti-static carton", "pcs", 0.65, 24)],
      ["The stencil printer is modelled with the press archetype (stroke-based machine)."],
    ),
  },
  {
    id: "beverage-bottling",
    name: "Beverage: PET bottling",
    industry: "Food & beverage",
    description: "Blow-fill line (stretch blow molder, filler-capper, labeler, inspection) feeding case packing and palletizing.",
    keywords: ["beverage", "bottl", "drink", "water", "juice", "soda", "filler", "pet", "brewery", "dairy"],
    spec: spec(
      "New bottling plant",
      "Food & beverage",
      "PET bottle filling",
      [
        line("filling-1", "Filling Line 1", "process", [["Stretch blow molder", "molder", 14000], ["Filler-capper monobloc", "filler", 12000], ["Wrap-around labeler", "labeler", 14000], ["Fill-level inspection", "camera", 15000]], ["water-500"]),
        line("packing", "Packing & Palletizing", "packing", [["Shrink-wrap case packer", "packager", 14000], ["Robotic palletizer", "palletizer", 15000]]),
      ],
      [product("water-500", "Still water 500 ml", "bottles", 10000, 0.35, 0.09, [["preform", 1], ["cap", 1], ["label", 1]])],
      [material("preform", "PET preform 12 g", "pcs", 0.04, 72), material("cap", "28 mm cap", "pcs", 0.01, 72), material("label", "Wrap label", "pcs", 0.005, 96), material("shrink-film", "Shrink film", "packs", 0.08, 48)],
      ["Rates are bottles per hour; the case packer is modelled per bottle."],
    ),
  },
  {
    id: "automotive-machining",
    name: "Automotive: CNC machining cells",
    industry: "Automotive components",
    description: "Two robot-tended CNC cells with in-process gauging, feeding pack-out.",
    keywords: ["automotive", "machining", "cnc", "lathe", "mill", "caliper", "shaft", "gear", "metal parts", "component"],
    spec: spec(
      "New machining plant",
      "Automotive components",
      "Precision CNC machining",
      [
        line("cell-1", "Machining Cell 1", "process", [["Loading robot", "robot"], ["CNC lathe", "cnc", 45], ["5-axis machining center", "cnc", 40], ["Gauging station", "camera"]], ["bracket"]),
        line("cell-2", "Machining Cell 2", "process", [["Loading robot", "robot"], ["CNC lathe", "cnc", 55], ["Gear hobbing machine", "cnc", 50], ["Gauging station", "camera"]], ["shaft"]),
        line("pack-out", "Wash & Pack-out", "packing", [["Parts washer", "pump"], ["Pack-out station", "workstation", 160], ["Palletizer", "palletizer"]]),
      ],
      [product("bracket", "Brake caliper bracket", "parts", 34, 38, 11, [["forging", 1]]), product("shaft", "Gear shaft", "parts", 42, 26, 7, [["bar-stock", 1]])],
      [material("forging", "Bracket forging", "pcs", 9, 120), material("bar-stock", "Alloy bar stock (cut length)", "pcs", 5, 96), material("box", "Returnable box liner", "pcs", 0.3, 24)],
      ["The parts washer is modelled with the pump archetype (wash-water circulation)."],
    ),
  },
  {
    id: "plastics-injection",
    name: "Plastics: injection molding",
    industry: "Plastics",
    description: "Two molding cells (resin dryer, molding machine, sprue picker, vision check) feeding bagging.",
    keywords: ["plastic", "injection", "molding", "moulding", "resin", "polymer", "housing"],
    spec: spec(
      "New molding plant",
      "Plastics",
      "Injection-molded parts",
      [
        line("cell-1", "Molding Cell 1", "process", [["Resin dryer", "oven", 600], ["Injection molding machine 250 t", "molder", 240], ["Sprue picker", "robot", 400], ["Vision check", "camera", 600]], ["cover"]),
        line("cell-2", "Molding Cell 2", "process", [["Resin dryer", "oven", 900], ["Injection molding machine 120 t", "molder", 600], ["Sprue picker", "robot", 900], ["Vision check", "camera", 900]], ["clip"]),
        line("packing", "Bagging & Labeling", "packing", [["Count-and-bag machine", "packager"], ["Label printer", "labeler"]]),
      ],
      [product("cover", "Housing cover", "parts", 220, 1.8, 0.35, [["pp-resin", 0.06]]), product("clip", "Connector clip", "parts", 540, 0.4, 0.05, [["pa-resin", 0.008]])],
      [material("pp-resin", "PP resin", "kg", 1.6, 72), material("pa-resin", "PA6 resin", "kg", 3.2, 96), material("bags", "Poly bags", "pcs", 0.03, 24)],
      ["Resin dryers are modelled with the oven/dryer archetype; cycle rates assume single-cavity tools."],
    ),
  },
  {
    id: "food-bakery",
    name: "Food: industrial bakery",
    industry: "Food & beverage",
    description: "Bread line (mixer, divider, proofer, tunnel oven, checkweigher) feeding slicing, bagging and palletizing.",
    keywords: ["bakery", "bread", "bake", "dough", "oven", "biscuit", "snack", "food"],
    spec: spec(
      "New bakery",
      "Food & beverage",
      "Industrial bread baking",
      [
        line("bread", "Bread Line", "process", [["Spiral dough mixer", "mixer"], ["Divider-rounder", "extruder"], ["Proofer conveyor", "conveyor"], ["Tunnel oven", "oven"], ["Checkweigher", "camera"]], ["loaf"]),
        line("packing", "Slicing & Packing", "packing", [["Slicer-bagger", "packager"], ["Date coder", "labeler"], ["Palletizer", "palletizer"]]),
      ],
      [product("loaf", "Sandwich loaf 800 g", "loaves", 2400, 1.9, 0.55, [["flour", 0.45], ["yeast", 0.01]])],
      [material("flour", "Wheat flour", "kg", 0.7, 48), material("yeast", "Yeast", "kg", 4, 48), material("bread-bags", "Bread bags", "pcs", 0.02, 24)],
      ["Mixer and divider rates are expressed in loaves per hour."],
    ),
  },
  {
    id: "metal-welding",
    name: "Metal fabrication: stamping & welding",
    industry: "Metal fabrication",
    description: "Stamping, two robotic welding cells and inspection, feeding rack loading.",
    keywords: ["weld", "stamping", "fabrication", "sheet metal", "frame", "body", "chassis", "steel"],
    spec: spec(
      "New fabrication plant",
      "Metal fabrication",
      "Stamped and welded assemblies",
      [
        line("weld", "Weld Line", "process", [["Stamping press", "press", 120], ["Handling robot", "robot", 120], ["Welding cell 1", "welder"], ["Welding cell 2", "welder"], ["Weld inspection", "camera"]], ["seat-frame"]),
        line("pack-out", "Rack Loading", "packing", [["Rack loading station", "workstation"], ["Palletizer", "palletizer"]]),
      ],
      [product("seat-frame", "Seat frame assembly", "frames", 55, 48, 16, [["steel-blank", 3], ["wire", 0.2]])],
      [material("steel-blank", "Steel blank", "pcs", 3.5, 96), material("wire", "Welding wire", "kg", 2.8, 72), material("rack", "Returnable rack", "pcs", 0.5, 24)],
      ["Weld quality classes follow ISO 5817 terminology."],
    ),
  },
  {
    id: "pharma-osd",
    name: "Pharma: oral solid dose",
    industry: "Pharmaceuticals",
    description: "Granulation, drying, compression and tablet inspection feeding blistering, cartoning and serialization.",
    keywords: ["pharma", "tablet", "capsule", "blister", "granulat", "drug", "medicine", "gmp"],
    spec: spec(
      "New pharma plant",
      "Pharmaceuticals",
      "Oral solid dose (tablets)",
      [
        line("compression", "Granulation & Compression", "process", [["High-shear granulator", "mixer"], ["Fluid-bed dryer", "oven"], ["Rotary tablet press", "press"], ["Tablet inspection", "camera"]], ["tab-500"]),
        line("packing", "Blister & Serialization", "packing", [["Blister packer", "packager"], ["Cartoner", "packager"], ["Serialization labeler", "labeler"]]),
      ],
      [product("tab-500", "500 mg tablet, blister of 10", "blisters", 1500, 2.2, 0.6, [["api", 0.005], ["excipients", 0.002]])],
      [material("api", "Active ingredient", "kg", 90, 168), material("excipients", "Excipient blend", "kg", 6, 96), material("foil", "Blister foil", "pcs", 0.04, 48)],
      ["Rates are in blisters per hour. Batch steps (granulation, drying) are approximated as continuous flow."],
    ),
  },
  {
    id: "electric-motors-fans",
    name: "Electric motors & fans",
    industry: "Electrical appliances",
    description: "Induction and BLDC motor lines (stamping, winding, varnish, rotor, shaft, test) feeding fan assembly, AOI and packing.",
    keywords: ["fan", "ceiling fan", "electric motor", "bldc", "winding", "stator", "rotor", "lamination"],
    spec: fansSpec(),
  },
];

/** The AeroBreeze Fans demo plant (Bengaluru): fictional suppliers, stock sized so the imported bearings run short. */
function fansSpec(): TwinSpec {
  const mat = (id: string, name: string, unit: string, unitCost: number, leadTimeHours: number, onHand: number, supplier: string): SpecMaterial => ({ id, name, unit, onHand, unitCost, leadTimeHours, supplier, prov: T });
  const s = spec(
    "AeroBreeze Fans",
    "Electrical appliances",
    "Ceiling fans: induction and BLDC motors, assembly and packing",
    [
      line("motor-a", "Motor Line A · Induction", "process", [["Lamination press LP-01", "press", 160], ["Stator winding cell WC-02", "workstation", 160], ["Varnish curing oven VO-03", "oven", 170], ["Rotor die-casting cell RD-04", "molder", 165], ["Shaft CNC lathe SC-05", "cnc", 160], ["Rotor assembly robot RA-06", "robot", 150], ["Motor run-in test RT-07", "camera", 155]], ["ab-1200"]),
      line("motor-b", "Motor Line B · BLDC", "process", [["Lamination press LP-11", "press", 110], ["Stator winding cell WC-12", "workstation", 105], ["Varnish curing oven VO-13", "oven", 110], ["Shaft CNC lathe SC-15", "cnc", 108], ["PCB & rotor assembly robot RA-16", "robot", 100], ["BLDC run-in test RT-17", "camera", 104]], ["ab-bldc-900"]),
      line("assembly", "Fan Assembly & Packing", "packing", [["Blade balancing BB-21", "workstation", 280], ["Final assembly FA-22", "workstation", 270], ["AOI inspection AOI-23", "camera", 300], ["Carton packer CP-24", "packager", 280], ["Labeler LB-25", "labeler", 320], ["Palletizer PZ-26", "palletizer", 300]]),
    ],
    [
      product("ab-1200", "AeroBreeze 1200 ceiling fan", "fans", 150, 38, 19, [["cu-wire", 0.35], ["crno-steel", 1.6], ["al-alloy", 0.9], ["brg-6202", 2], ["cap-25", 1], ["blade-set", 1], ["carton", 1]]),
      product("ab-bldc-900", "AeroBreeze BLDC 900 fan", "fans", 100, 62, 33, [["cu-wire", 0.28], ["crno-steel", 1.3], ["brg-6202", 2], ["bldc-pcb", 1], ["blade-set", 1], ["carton", 1]]),
    ],
    [
      mat("cu-wire", "Enamelled copper winding wire", "kg", 9.5, 72, 9000, "Shakti Wires (demo)"),
      mat("crno-steel", "CRNO lamination steel", "kg", 1.4, 120, 80000, "Kaveri Steel (demo)"),
      mat("al-alloy", "Aluminium die-cast alloy LM6", "kg", 3.2, 96, 20000, "Deccan Alloys (demo)"),
      mat("brg-6202", "6202-2RS ball bearing (imported)", "pcs", 0.85, 144, 12000, "Nippon Seiki Bearings (demo)"),
      mat("cap-25", "2.5 µF run capacitor", "pcs", 0.4, 48, 30000, "Mysore Electro (demo)"),
      mat("bldc-pcb", "BLDC driver board", "pcs", 6.5, 120, 16000, "Peenya Electronics (demo)"),
      mat("blade-set", "Steel blade set (3 blades)", "sets", 2.8, 48, 30000, "Hosur Pressings (demo)"),
      mat("carton", "5-ply fan carton", "pcs", 0.45, 24, 20000, "Corrupak Bengaluru (demo)"),
    ],
    ["Suppliers are fictional demo names. Imported bearings have the longest lead time and the thinnest cover."],
  );
  s.site.location = "Peenya Industrial Area, Bengaluru";
  s.integrations = [
    { id: "int-lp01", target: "motor-a-m1", kind: "opcua", address: "opc.tcp://10.20.1.11:4840", notes: "Press PLC", prov: T },
    { id: "int-wc02", target: "motor-a-m2", kind: "mqtt", address: "mqtt://plant-broker:1883/aerobreeze/wc-02", notes: "Winding tension and temperature", prov: T },
    { id: "int-aoi23", target: "assembly-m3", kind: "camera-rtsp", address: "rtsp://10.20.3.23/stream1", notes: "AOI camera", prov: T },
  ];
  s.mobileRobots = [
    { id: "amr-kitting-a", name: "Kitting AMRs Motor Line A", robotType: "amr", mission: "kitting", lineId: "motor-a", count: 2, unitsPerTrip: null, speedMps: null, trigger: { kind: "output", everyMinutes: null }, route: [], prov: T },
    { id: "agv-fg", name: "Finished-goods forklift AGV", robotType: "forklift-agv", mission: "finished-goods", lineId: null, count: 1, unitsPerTrip: null, speedMps: null, trigger: { kind: "output", everyMinutes: null }, route: [], prov: T },
  ];
  return s;
}

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null;

/** Keyword match from free text (used when the AI agent is unavailable). Deterministic. */
export function matchTemplate(text: string): { template: TwinTemplate; matched: string[] } | null {
  const t = text.toLowerCase();
  let best: { template: TwinTemplate; matched: string[] } | null = null;
  for (const tpl of TEMPLATES) {
    const matched = tpl.keywords.filter((k) => t.includes(k));
    if (matched.length && (!best || matched.length > best.matched.length)) best = { template: tpl, matched };
  }
  return best;
}
