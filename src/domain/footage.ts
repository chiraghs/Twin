/**
 * Reference footage library: short, openly licensed clips of real factories, looped in the CCTV
 * control room so the demo can show real video (and run visual QA on it). Every clip is real
 * footage from another facility — never presented as this plant — and carries its source,
 * author and license. Files live in public/footage (re-encoded: trimmed, scaled, audio removed).
 */
import type { Camera, CameraKind } from "./types";

export interface FootageClip {
  id: string;
  title: string;
  /** What the clip shows, in plain words. */
  shows: string;
  /** Camera kinds the clip suits. */
  kinds: CameraKind[];
  /** For inspection cameras: board-level (AOI) or pack-out (cartons, labels). */
  station?: "aoi" | "pack-out";
  src: string;
  poster: string;
  durationSec: number;
  width: number;
  height: number;
  source: { site: string; pageUrl: string; author: string; license: string; licenseUrl: string; attributionRequired: boolean };
  edits: string;
}

const PEXELS = { site: "Pexels", license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", attributionRequired: false };
const COMMONS_BY3 = { site: "Wikimedia Commons", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0/", attributionRequired: true };
const RE_ENCODED = "Trimmed, scaled to 1280 px wide at 25 fps and re-encoded as H.264 without audio.";

export const FOOTAGE: FootageClip[] = [
  {
    id: "smt-assembly-floor",
    title: "Electronics assembly hall",
    shows: "Wide view down an electronics assembly floor: board conveyors, test and inspection machines, operators in cleanroom suits.",
    kinds: ["area"],
    src: "/footage/smt-assembly-floor.mp4",
    poster: "/footage/smt-assembly-floor.jpg",
    durationSec: 14,
    width: 1280,
    height: 720,
    source: { ...PEXELS, pageUrl: "https://www.pexels.com/video/modern-high-tech-manufacturing-factory-floor-32386623/", author: "Usman AbdulrasheedGambo" },
    edits: RE_ENCODED,
  },
  {
    id: "robot-cell",
    title: "Robot cell beside a conveyor",
    shows: "A six-axis industrial robot working in a cell next to a conveyor and lift, fixed camera.",
    kinds: ["area"],
    src: "/footage/robot-cell.mp4",
    poster: "/footage/robot-cell.jpg",
    durationSec: 10,
    width: 1280,
    height: 720,
    source: { ...PEXELS, pageUrl: "https://www.pexels.com/video/industrial-robot-arm-in-high-tech-factory-32386532/", author: "Usman AbdulrasheedGambo" },
    edits: RE_ENCODED,
  },
  {
    id: "cobot-test-cell",
    title: "Cobot test cell (Gigaset smartphone production)",
    shows: "Three collaborative robots testing devices on a fixture table, fixed camera.",
    kinds: ["area", "inspection"],
    station: "aoi",
    src: "/footage/cobot-test-cell.mp4",
    poster: "/footage/cobot-test-cell.jpg",
    durationSec: 27,
    width: 1280,
    height: 720,
    source: { ...COMMONS_BY3, pageUrl: "https://commons.wikimedia.org/wiki/File:Gigaset_Smartphone_Production_IV_Quality_Inspection.webm", author: "Inke Pickhardt (Work With Sounds)" },
    edits: `${RE_ENCODED} Original sound by Kathinka Engels removed.`,
  },
  {
    id: "smt-pick-and-place",
    title: "SMT pick-and-place machine (ASM Siplace, Gigaset)",
    shows: "Close view through the window of an SMT pick-and-place machine: placement head moving over the board, feeder reels below.",
    kinds: ["inspection"],
    station: "aoi",
    src: "/footage/smt-pick-and-place.mp4",
    poster: "/footage/smt-pick-and-place.jpg",
    durationSec: 16,
    width: 1280,
    height: 720,
    source: { ...COMMONS_BY3, pageUrl: "https://commons.wikimedia.org/wiki/File:Gigaset_Cordless_Telephone_Production_V_ASM_Siplace_SMD_Production_Line.webm", author: "Inke Pickhardt (Work With Sounds)" },
    edits: `${RE_ENCODED} Original sound by Kathinka Engels removed.`,
  },
  {
    id: "pcb-closeup",
    title: "Populated circuit board close-up",
    shows: "Slow pass across a populated PCB: BGA package, SMD passives and silkscreen designators.",
    kinds: ["inspection"],
    station: "aoi",
    src: "/footage/pcb-closeup.mp4",
    poster: "/footage/pcb-closeup.jpg",
    durationSec: 15,
    width: 1280,
    height: 720,
    source: { ...PEXELS, pageUrl: "https://www.pexels.com/video/close-up-footage-of-an-electronic-circuit-board-3866849/", author: "Steve B" },
    edits: RE_ENCODED,
  },
  {
    id: "carton-conveyor",
    title: "Pack-out with carton conveyors",
    shows: "Cartons on roller conveyors with a curved merge in the pack-out area of an electronics plant.",
    kinds: ["area"],
    src: "/footage/carton-conveyor.mp4",
    poster: "/footage/carton-conveyor.jpg",
    durationSec: 8,
    width: 1280,
    height: 720,
    source: { ...PEXELS, pageUrl: "https://www.pexels.com/video/efficient-assembly-line-in-modern-factory-32386620/", author: "Usman AbdulrasheedGambo" },
    edits: RE_ENCODED,
  },
  {
    id: "case-taper",
    title: "Cartons through a case taper",
    shows: "Fixed close shot of cartons passing through a case-taping head on a conveyor, with gaps between cartons.",
    kinds: ["inspection"],
    station: "pack-out",
    src: "/footage/case-taper.mp4",
    poster: "/footage/case-taper.jpg",
    durationSec: 8,
    width: 1280,
    height: 720,
    source: { site: "Pixabay", license: "Pixabay Content License", licenseUrl: "https://pixabay.com/service/license-summary/", attributionRequired: false, pageUrl: "https://pixabay.com/videos/box-taper-industrial-production-8686/", author: "matlevesque" },
    edits: RE_ENCODED,
  },
  {
    id: "thermal-component",
    title: "Thermal camera on an electrical component",
    shows: "Real thermal-camera footage of a Peltier element switching on and off (hot and cold sides, with a temperature scale). Not a robot or motor.",
    kinds: ["thermal"],
    src: "/footage/thermal-component.mp4",
    poster: "/footage/thermal-component.jpg",
    durationSec: 20,
    width: 1280,
    height: 720,
    source: {
      site: "Wikimedia Commons",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      attributionRequired: true,
      pageUrl: "https://commons.wikimedia.org/wiki/File:Peltier_element_thermal_video.webm",
      author: "Laserlicht",
    },
    edits: `${RE_ENCODED} This adaptation is shared under CC BY-SA 4.0.`,
  },
  {
    id: "forklift-dock",
    title: "Forklift at a loading dock",
    shows: "A forklift backing out of a trailer through an open dock door, with racking and wrapped pallets.",
    kinds: ["dock"],
    src: "/footage/forklift-dock.mp4",
    poster: "/footage/forklift-dock.jpg",
    durationSec: 20,
    width: 1280,
    height: 720,
    source: { ...PEXELS, pageUrl: "https://www.pexels.com/video/a-person-operating-a-fork-lifter-6079419/", author: "K (@kelly)" },
    edits: RE_ENCODED,
  },
  {
    id: "warehouse-stores",
    title: "Stores with racking and cable reels",
    shows: "Fixed wide shot of a warehouse: pallet racking, cartons, cable reels and a forklift.",
    kinds: ["area", "dock"],
    src: "/footage/warehouse-stores.mp4",
    poster: "/footage/warehouse-stores.jpg",
    durationSec: 21,
    width: 1280,
    height: 720,
    source: { ...PEXELS, pageUrl: "https://www.pexels.com/video/person-driving-forklift-6079421/", author: "K (@kelly)" },
    edits: RE_ENCODED,
  },
];

/** Suggested clip for each camera of the demo plant (other factories fall back to the camera kind). */
const SUGGESTED: Record<string, string> = {
  "CCTV-A1": "smt-assembly-floor",
  "CCTV-B1": "robot-cell",
  "CCTV-C1": "carton-conveyor",
  "VIS-A-CAM-04": "smt-pick-and-place",
  "VIS-B-CAM-04": "pcb-closeup",
  "VIS-C-CAM-04": "case-taper",
  "THM-A1": "thermal-component",
  "CCTV-DOCK": "forklift-dock",
  "CCTV-STORES": "warehouse-stores",
};

export const getClip = (id: string) => FOOTAGE.find((c) => c.id === id) ?? null;

const stationOf = (camera: Camera): FootageClip["station"] => (camera.analytics.includes("ocr-barcode") ? "pack-out" : "aoi");

/** Clips that suit a camera, best match first. */
export function clipsFor(camera: Camera): FootageClip[] {
  const score = (c: FootageClip) =>
    (SUGGESTED[camera.id] === c.id ? 100 : 0) +
    (c.kinds.includes(camera.kind) ? 10 : 0) +
    (camera.kind === "inspection" && c.station === stationOf(camera) ? 5 : 0) +
    (camera.id === "CCTV-STORES" && /stor|warehouse|shel/i.test(c.shows) ? 5 : 0);
  return [...FOOTAGE].filter((c) => score(c) > 0).sort((a, b) => score(b) - score(a));
}

export const suggestedClip = (camera: Camera): FootageClip | null => clipsFor(camera)[0] ?? null;
