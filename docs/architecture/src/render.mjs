// Render every docs/architecture/src/*.html to docs/architecture/<name>.png (2x) with Playwright.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.dirname(fileURLToPath(import.meta.url));
const out = path.dirname(src);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1620, height: 1000 }, deviceScaleFactor: 2 });
for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".html"))) {
  await page.goto("file://" + path.join(src, f));
  await page.locator(".wrap").screenshot({ path: path.join(out, f.replace(/\.html$/, ".png")) });
  console.log("rendered", f);
}
await browser.close();
