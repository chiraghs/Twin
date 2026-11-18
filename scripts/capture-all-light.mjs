import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.resolve("docs/screenshots");
const PUB_DIR = path.resolve("public/screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PUB_DIR, { recursive: true });

async function capture() {
  console.log("Starting browser for comprehensive light-mode capture...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-webgl", "--use-gl=angle", "--no-sandbox"],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  });

  await context.addInitScript(() => {
    localStorage.setItem("twin-theme", "light");
    document.documentElement.setAttribute("data-theme", "light");
  });

  const saveShot = async (page, filename) => {
    const p1 = path.join(OUT_DIR, filename);
    const p2 = path.join(PUB_DIR, filename);
    await page.screenshot({ path: p1, fullPage: false });
    fs.copyFileSync(p1, p2);
    console.log(`[Captured] ${filename}`);
  };

  // 1. Digital Twin Studio - 3D View
  console.log("Capturing 3D Twin View in Light Mode...");
  {
    const page = await context.newPage();
    await page.goto("http://localhost:3000/twin", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.waitForTimeout(1500);

    // Click 3D button
    const btn3D = page.locator('button:has-text("3D")');
    if (await btn3D.count()) {
      await btn3D.first().click();
      console.log("Clicked 3D tab...");
    }
    await page.waitForTimeout(4000);
    await saveShot(page, "01-twin-3d-light.png");
    await page.close();
  }

  // 2. Digital Twin Studio - VR View
  console.log("Capturing VR View in Light Mode...");
  {
    const page = await context.newPage();
    await page.goto("http://localhost:3000/twin", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.waitForTimeout(1500);

    // Click VR button
    const btnVR = page.locator('button:has-text("VR")');
    if (await btnVR.count()) {
      await btnVR.first().click();
      console.log("Clicked VR tab...");
    }
    await page.waitForTimeout(4000);
    await saveShot(page, "02-twin-vr-light.png");
    await page.close();
  }

  // 3. Commissioning & Signals
  console.log("Capturing Commissioning & Signals in Light Mode...");
  {
    const page = await context.newPage();
    await page.goto("http://localhost:3000/commissioning", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.waitForTimeout(3000);
    await saveShot(page, "03-commissioning-signals-light.png");
    await page.close();
  }

  // 4. Guided Maintenance
  console.log("Capturing Guided Maintenance in Light Mode...");
  {
    const page = await context.newPage();
    await page.goto("http://localhost:3000/guided-maintenance", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.waitForTimeout(3000);
    await saveShot(page, "04-guided-maintenance-light.png");
    await page.close();
  }

  // 5. Playground (3D Floorplan & Snap-to-line)
  console.log("Capturing Playground in Light Mode...");
  {
    const page = await context.newPage();
    await page.goto("http://localhost:3000/playground", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.waitForTimeout(4000);
    await saveShot(page, "05-playground-builder-light.png");
    await page.close();
  }

  // 6. Fleet Traffic
  console.log("Capturing Fleet Traffic in Light Mode...");
  {
    const page = await context.newPage();
    await page.goto("http://localhost:3000/fleet-traffic", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.waitForTimeout(3000);
    await saveShot(page, "06-fleet-traffic-light.png");
    await page.close();
  }

  // 7. Sequencer
  console.log("Capturing Sequencer in Light Mode...");
  {
    const page = await context.newPage();
    await page.goto("http://localhost:3000/sequencer", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.waitForTimeout(3000);
    await saveShot(page, "07-sequencer-light.png");
    await page.close();
  }

  // 8. Simulator Experiments
  console.log("Capturing Simulator Experiments in Light Mode...");
  {
    const page = await context.newPage();
    await page.goto("http://localhost:3000/simulator", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    await page.waitForTimeout(3000);
    await saveShot(page, "08-simulator-experiments-light.png");
    await page.close();
  }

  await browser.close();
  console.log("All light mode screenshots captured successfully!");
}

capture().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
