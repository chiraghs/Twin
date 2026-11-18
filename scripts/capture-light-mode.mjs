import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve("docs/screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });

const pagesToCapture = [
  { url: "http://localhost:3000/twin", name: "01-twin-3d-vr-light.png", wait: 4000 },
  { url: "http://localhost:3000/commissioning", name: "02-commissioning-signals-light.png", wait: 2000 },
  { url: "http://localhost:3000/guided-maintenance", name: "03-guided-maintenance-light.png", wait: 2000 },
  { url: "http://localhost:3000/playground", name: "04-playground-builder-light.png", wait: 4000 },
  { url: "http://localhost:3000/fleet-traffic", name: "05-fleet-traffic-light.png", wait: 2000 },
  { url: "http://localhost:3000/sequencer", name: "06-sequencer-light.png", wait: 2000 },
  { url: "http://localhost:3000/simulator", name: "07-simulator-experiments-light.png", wait: 2000 },
];

async function main() {
  console.log("Launching Chromium for light mode capture...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--use-gl=angle", "--no-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2, // High-res retina
    colorScheme: "light",
  });

  // Inject light theme into localStorage before any page loads
  await context.addInitScript(() => {
    localStorage.setItem("twin-theme", "light");
    document.documentElement.setAttribute("data-theme", "light");
  });

  for (const item of pagesToCapture) {
    console.log(`Capturing ${item.url} -> ${item.name}...`);
    const page = await context.newPage();
    try {
      await page.goto(item.url, { waitUntil: "networkidle", timeout: 15000 });
      // Ensure data-theme is light
      await page.evaluate(() => {
        document.documentElement.setAttribute("data-theme", "light");
      });
      await page.waitForTimeout(item.wait);
      const outPath = path.join(OUT_DIR, item.name);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`Saved: ${outPath}`);
    } catch (err) {
      console.error(`Error capturing ${item.url}:`, err.message);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log("Capture completed!");
}

main().catch(console.error);
