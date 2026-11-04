// Title / end cards and speed-up badges for the demo video, rendered as 1920×1080 PNGs (badges transparent).
//   node scripts/demo/render-cards.mjs <outDir>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = path.resolve(process.argv[2] ?? "demo-out/cards");
fs.mkdirSync(OUT, { recursive: true });

const FONT = `font-family: Inter, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif;`; // single quotes: it sits inside style="…"
const card = (inner) => `<html><body style="margin:0;width:1920px;height:1080px;${FONT}background:radial-gradient(ellipse at 30% 20%,#16305a 0%,#070b14 60%);color:#fff;display:flex;align-items:center;justify-content:center">${inner}</body></html>`;

const cards = {
  title: card(`<div style="text-align:center">
    <div style="font-size:30px;letter-spacing:.3em;color:#8db6ff;font-weight:600">AEROBREEZE FANS · BENGALURU</div>
    <div style="font-size:150px;font-weight:800;margin:18px 0 6px;letter-spacing:-.02em">Twin</div>
    <div style="font-size:44px;font-weight:500;color:#dbe6ff">An agentic digital twin, built on Meta's Muse models</div>
    <div style="margin-top:36px;font-size:26px;color:#93a4c3">Muse Spark · Muse Wonder · SAM 3.1 · Muse Image · Muse Voice · Muse Spark Open</div>
  </div>`),
  end: card(`<div style="text-align:center;max-width:1500px">
    <div style="font-size:96px;font-weight:800;letter-spacing:-.02em">Twin</div>
    <div style="font-size:46px;font-weight:600;color:#dbe6ff;margin-top:10px">Numbers from the twin. Decisions by people.</div>
    <div style="font-size:30px;color:#93a4c3;margin-top:34px">Powered by Meta's Muse models · open weights for plant-private AI</div>
    <div style="font-size:28px;color:#8db6ff;margin-top:40px">github.com/chiraghs/Twin</div>
    <div style="font-size:20px;color:#6b7a96;margin-top:40px">AeroBreeze Fans and its suppliers are fictional demo data. Opening images generated with Muse Image.</div>
  </div>`),
};

// Aurora Electronics variants (electronics story)
cards["title-e"] = cards.title.replace("AEROBREEZE FANS · BENGALURU", "AURORA ELECTRONICS · PUNE");
cards["end-e"] = cards.end.replace("AeroBreeze Fans and its suppliers are fictional demo data.", "Aurora Electronics and its suppliers are fictional demo data.");

const badge = (text) => `<html><body style="margin:0;width:1920px;height:1080px;background:transparent">
  <div style="position:absolute;top:36px;right:40px;padding:14px 22px;border-radius:14px;background:rgba(76,141,255,.95);color:#fff;${FONT}font-weight:700;font-size:28px;box-shadow:0 10px 30px rgba(0,0,0,.35)">⏩ ${text}</div></body></html>`;
const badges = {
  "badge-builder": "Live AI run, sped up · about 3½ minutes of real Muse Spark work",
  "badge-agents": "Six agents working, sped up",
  "badge-aoi": "Muse Spark + SAM 3.1 inspecting, sped up",
  "badge-copilot": "Copilot thinking, sped up",
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [name, html] of Object.entries(cards)) {
  await page.setContent(html);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}
for (const [name, text] of Object.entries(badges)) {
  await page.setContent(badge(text));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: true });
}
await browser.close();
console.log("cards in", OUT);
