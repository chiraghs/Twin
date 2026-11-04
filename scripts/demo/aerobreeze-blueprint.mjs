// AeroBreeze Fans (Bengaluru) demo floor plan: writes content/demo/aerobreeze/blueprint.svg and renders
// blueprint.png (2x) with Playwright. Fictional plant, used to demo Twin Builder reading a drawing.
//   node scripts/demo/aerobreeze-blueprint.mjs
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = path.resolve("content/demo/aerobreeze");
fs.mkdirSync(OUT, { recursive: true });

const W = 1600, H = 1000;
const INK = "#16324f", SOFT = "#5b7590", FILL = "#eef4fa", ZONE = "#f7fafc";

// [tag, name, x, y, w, h]
const motorA = [["LP-01", "Lamination press"], ["WC-02", "Stator winding"], ["VO-03", "Varnish oven"], ["RD-04", "Rotor die-cast"], ["SC-05", "Shaft CNC lathe"], ["RA-06", "Rotor assembly robot"], ["RT-07", "Motor run-in test"]];
const motorB = [["LP-11", "Lamination press"], ["WC-12", "Stator winding"], ["VO-13", "Varnish oven"], ["SC-15", "Shaft CNC lathe"], ["RA-16", "PCB & rotor robot"], ["RT-17", "BLDC run-in test"]];
const assembly = [["BB-21", "Blade balancing"], ["FA-22", "Final assembly"], ["AOI-23", "AOI inspection camera"], ["CP-24", "Carton packer"], ["LB-25", "Labeler"], ["PZ-26", "Palletizer"]];

const parts = [];
const add = (s) => parts.push(s);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function machine(tag, name, x, y, w = 150, h = 92) {
  add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${FILL}" stroke="${INK}" stroke-width="2.5"/>`);
  add(`<text x="${x + w / 2}" y="${y + 38}" text-anchor="middle" font-size="20" font-weight="700" fill="${INK}">${tag}</text>`);
  const words = name.split(" ");
  const l1 = words.slice(0, Math.ceil(words.length / 2)).join(" "), l2 = words.slice(Math.ceil(words.length / 2)).join(" ");
  add(`<text x="${x + w / 2}" y="${y + 62}" text-anchor="middle" font-size="14" fill="${SOFT}">${esc(l1)}</text>`);
  if (l2) add(`<text x="${x + w / 2}" y="${y + 79}" text-anchor="middle" font-size="14" fill="${SOFT}">${esc(l2)}</text>`);
}
const arrow = (x1, y1, x2, y2) => add(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="2.5" marker-end="url(#arr)"/>`);

function lineRow(label, items, y, x0 = 230, gap = 28, w = 140, labelX = x0 - 10) {
  add(`<rect x="${x0 - 22}" y="${y - 44}" width="${items.length * (w + gap) - gap + 44}" height="168" rx="10" fill="${ZONE}" stroke="${SOFT}" stroke-dasharray="8 6"/>`);
  add(`<text x="${labelX}" y="${y - 18}" font-size="17" font-weight="700" fill="${INK}" letter-spacing="1">${esc(label)}</text>`);
  items.forEach(([tag, name], i) => {
    const x = x0 + i * (w + gap);
    machine(tag, name, x, y, w);
    if (i < items.length - 1) arrow(x + w, y + 46, x + w + gap - 4, y + 46);
  });
  return { x0, xEnd: x0 + items.length * (w + gap) - gap, y };
}

add(`<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${INK}"/></marker>
<pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#e3ebf3" stroke-width="1"/></pattern></defs>`);
add(`<rect width="${W}" height="${H}" fill="white"/><rect width="${W}" height="${H}" fill="url(#grid)"/>`);
add(`<rect x="20" y="20" width="${W - 40}" height="${H - 40}" fill="none" stroke="${INK}" stroke-width="4"/>`);

// Stores (left) and docks
add(`<rect x="40" y="110" width="150" height="520" rx="8" fill="#fbf7ee" stroke="${INK}" stroke-width="2.5"/>`);
add(`<text x="115" y="150" text-anchor="middle" font-size="18" font-weight="700" fill="${INK}">RAW STORES</text>`);
["Copper wire", "CRNO steel", "Al alloy LM6", "6202 bearings", "Capacitors", "BLDC PCBs", "Blade sets", "Cartons"].forEach((m, i) => add(`<text x="115" y="${190 + i * 52}" text-anchor="middle" font-size="14" fill="${SOFT}">${m}</text>`));
add(`<rect x="40" y="660" width="150" height="90" rx="8" fill="#fbf7ee" stroke="${INK}" stroke-width="2.5"/><text x="115" y="702" text-anchor="middle" font-size="16" font-weight="700" fill="${INK}">RECEIVING</text><text x="115" y="726" text-anchor="middle" font-size="16" font-weight="700" fill="${INK}">DOCK D1</text>`);

const a = lineRow("MOTOR LINE A · INDUCTION MOTORS", motorA, 150);
const b = lineRow("MOTOR LINE B · BLDC MOTORS", motorB, 410);
const c = lineRow("FAN ASSEMBLY & PACKING", assembly, 700, 230, 40, 140, 330);

// Motor lines feed fan assembly over a transfer conveyor
const BUS = c.y - 80;
add(`<path d="M ${a.xEnd} ${a.y + 46} H ${a.xEnd + 30} V ${BUS} H ${c.x0 + 70} V ${c.y - 6}" fill="none" stroke="${INK}" stroke-width="2.5" marker-end="url(#arr)"/>`);
add(`<path d="M ${b.xEnd} ${b.y + 46} H ${b.xEnd + 30} V ${BUS}" fill="none" stroke="${INK}" stroke-width="2.5"/>`);
add(`<text x="${c.x0 + 300}" y="${BUS - 10}" font-size="14" fill="${SOFT}">finished motors → fan assembly (transfer conveyor)</text>`);

// Shipping dock
add(`<rect x="1390" y="660" width="170" height="160" rx="8" fill="#fbf7ee" stroke="${INK}" stroke-width="2.5"/><text x="1475" y="733" text-anchor="middle" font-size="16" font-weight="700" fill="${INK}">SHIPPING</text><text x="1475" y="757" text-anchor="middle" font-size="16" font-weight="700" fill="${INK}">DOCK D2</text>`);
arrow(c.xEnd + 6, c.y + 46, 1384, c.y + 46);

// AMR / AGV paths (dashed)
add(`<path d="M 190 330 H 200 V 196 H 226" fill="none" stroke="#c2410c" stroke-width="3" stroke-dasharray="9 6" marker-end="url(#arr)"/>`);
add(`<text x="${a.x0}" y="${a.y + 116}" font-size="13" fill="#c2410c">AMR-1, AMR-2: kitting from raw stores to Line A</text>`);
add(`<path d="M ${c.xEnd - 70} ${c.y + 92} V ${c.y + 140} H 1475 V 826" fill="none" stroke="#c2410c" stroke-width="3" stroke-dasharray="9 6" marker-end="url(#arr)"/>`);
add(`<text x="${c.xEnd - 300}" y="${c.y + 160}" font-size="13" fill="#c2410c">AGV-1 forklift: pallets to shipping dock</text>`);

// Utilities
for (const [i, label] of ["COMPRESSOR ROOM", "QC LAB", "OFFICE"].entries()) {
  add(`<rect x="1450" y="${110 + i * 105}" width="115" height="90" rx="8" fill="#f1f5f9" stroke="${SOFT}" stroke-width="2"/>`);
  label.split(" ").forEach((w, k, all) => add(`<text x="1507" y="${160 + i * 105 + (k - (all.length - 1) / 2) * 18}" text-anchor="middle" font-size="13" font-weight="700" fill="${INK}">${w}</text>`));
}

// Title block
add(`<rect x="${W - 520}" y="${H - 120}" width="500" height="100" fill="white" stroke="${INK}" stroke-width="2.5"/>`);
add(`<text x="${W - 505}" y="${H - 88}" font-size="20" font-weight="700" fill="${INK}">AEROBREEZE FANS · PLANT 1</text>`);
add(`<text x="${W - 505}" y="${H - 62}" font-size="14" fill="${SOFT}">Peenya Industrial Area, Bengaluru · Ceiling fans (induction + BLDC)</text>`);
add(`<text x="${W - 505}" y="${H - 38}" font-size="13" fill="${SOFT}">Equipment layout · DWG AB-P1-001 rev C · not to scale · demo drawing</text>`);
add(`<text x="40" y="${H - 40}" font-size="13" fill="${SOFT}">Arrows: material flow · dashed orange: AMR / AGV paths</text>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter, Helvetica, Arial, sans-serif">${parts.join("\n")}</svg>`;
fs.writeFileSync(path.join(OUT, "blueprint.svg"), svg);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1.25 });
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await page.locator("svg").screenshot({ path: path.join(OUT, "blueprint.png") });
await browser.close();
console.log("wrote", path.join(OUT, "blueprint.png"));
