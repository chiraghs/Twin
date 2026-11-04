import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const BASE_URL = "http://localhost:3001";
const VIDEO_DIR = "/tmp/video_record_twin_studio";

if (fs.existsSync(VIDEO_DIR)) {
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
}
fs.mkdirSync(VIDEO_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Inject sleek floating HUD overlay (pointerEvents = none to avoid intercepting clicks)
async function updateHUD(page, step, title, desc) {
  await page.evaluate(({ step, title, desc }) => {
    let hud = document.getElementById("twin-studio-explainer");
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "twin-studio-explainer";
      hud.style.position = "fixed";
      hud.style.bottom = "28px";
      hud.style.left = "50%";
      hud.style.transform = "translateX(-50%)";
      hud.style.background = "rgba(15, 23, 42, 0.94)";
      hud.style.backdropFilter = "blur(14px)";
      hud.style.border = "1.5px solid rgba(59, 130, 246, 0.5)";
      hud.style.borderRadius = "16px";
      hud.style.padding = "16px 26px";
      hud.style.color = "#ffffff";
      hud.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      hud.style.boxShadow = "0 20px 45px rgba(0, 0, 0, 0.6)";
      hud.style.zIndex = "999999";
      hud.style.pointerEvents = "none";
      hud.style.maxWidth = "980px";
      hud.style.width = "90%";
      hud.style.transition = "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)";
      hud.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span id="hud-step" style="background: #1a73e8; color: #fff; padding: 4px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;"></span>
            <h3 id="hud-title" style="font-size: 17px; font-weight: 600; margin: 0; color: #f8fafc; letter-spacing: -0.01em;"></h3>
          </div>
          <span style="font-size: 12.5px; color: #94a3b8; font-weight: 500;">Twin AI · Digital Twin Studio</span>
        </div>
        <p id="hud-desc" style="font-size: 14.5px; line-height: 1.5; margin: 0; color: #cbd5e1; font-weight: 400;"></p>
      `;
      document.body.appendChild(hud);
    }
    document.getElementById("hud-step").innerText = step;
    document.getElementById("hud-title").innerText = title;
    document.getElementById("hud-desc").innerText = desc;
  }, { step, title, desc });
}

async function run() {
  console.log("Resetting factory state...");
  await fetch(`${BASE_URL}/api/factory/reset`, { method: "POST" });

  console.log("Launching Chromium for 1080p Digital Twin Studio recording...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1920, height: 1080 },
    },
  });

  const page = await context.newPage();

  console.log("=== SCENE 1: Introduction & Topology View (0:00 - 0:20) ===");
  await page.goto(`${BASE_URL}/twin`, { waitUntil: "networkidle" });
  await sleep(2000);

  await updateHUD(
    page,
    "DIGITAL TWIN STUDIO",
    "Unified Industrial Topology & Live State",
    "A unified digital twin platform that connects production lines, machinery, IoT sensors, warehouse inventory, and customer orders in a live, interactive topology."
  );
  await sleep(7000);

  // Toggle Layer buttons to demonstrate topology flexibility
  const sensorsBtn = page.getByRole("button", { name: "Sensors" });
  if (await sensorsBtn.isVisible()) {
    await sensorsBtn.click();
    await sleep(1500);
    await sensorsBtn.click();
    await sleep(1500);
  }

  const inventoryBtn = page.getByRole("button", { name: "Inventory" });
  if (await inventoryBtn.isVisible()) {
    await inventoryBtn.click();
    await sleep(1500);
    await inventoryBtn.click();
    await sleep(1500);
  }

  await sleep(2000);

  console.log("=== SCENE 2: Asset Telemetry & Diagnostics Inspection (0:20 - 0:40) ===");
  await updateHUD(
    page,
    "ASSET INSPECTION",
    "Real-Time Telemetry & Machine Diagnostics",
    "Select any machine or station to inspect live telemetry: vibration (mm/s), temperature (°C), power draw (kW), health score, operating modes, and failure history."
  );

  // Click on robot A-ROB-03
  const robNode = page.locator(".react-flow__node[data-id='A-ROB-03']").first();
  if (await robNode.isVisible()) {
    await robNode.click();
    await sleep(3000);
  }

  // Scroll through the asset panel drawer
  const assetPanel = page.locator("aside").first();
  if (await assetPanel.isVisible()) {
    await assetPanel.evaluate((el) => el.scrollBy({ top: 300, behavior: "smooth" }));
    await sleep(4000);
    await assetPanel.evaluate((el) => el.scrollBy({ top: -300, behavior: "smooth" }));
    await sleep(3000);
  }

  // Close panel
  const closeBtn = page.locator("aside button[aria-label='Close panel'], aside button:has-text('✕')").first();
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
    await sleep(1500);
  }

  console.log("=== SCENE 3: Isometric Factory Twin & Status Stacklights (0:40 - 1:00) ===");
  const isoBtn = page.getByRole("button", { name: /Isometric/i });
  if (await isoBtn.isVisible()) {
    await isoBtn.click();
    await sleep(3000);
  }

  await updateHUD(
    page,
    "ISOMETRIC PROJECTION",
    "2.5D Elevation, Stacklights & Material Belts",
    "Explore the plant in 2.5D isometric view. Observe live color-coded machine status stacklights (green/yellow/red), moving conveyor belts, warehouse racks, and camera fields of view."
  );
  await sleep(8000);

  // Click thermal camera in Isometric view
  const camNode = page.locator("button, div").filter({ hasText: /THM-A1/i }).first();
  if (await camNode.isVisible()) {
    await camNode.click();
    await sleep(4000);
    const camClose = page.locator("aside button[aria-label='Close panel']").first();
    if (await camClose.isVisible()) await camClose.click();
    await sleep(1500);
  } else {
    await sleep(4000);
  }

  console.log("=== SCENE 4: Full 3D Spatial Twin (Three.js) (1:00 - 1:25) ===");
  const threeDBtn = page.getByRole("button", { name: /3D/i });
  if (await threeDBtn.isVisible()) {
    await threeDBtn.click();
    await sleep(4000);
  }

  await updateHUD(
    page,
    "3D SPATIAL DIGITAL TWIN",
    "Interactive Three.js Factory Environment",
    "A full 3D industrial environment featuring concrete flooring, steel columns, safety enclosures, articulating robot arms with grippers, live conveyor rollers, and ambient occlusion."
  );

  // Orbit smoothly around 3D canvas
  const canvas = page.locator("canvas").first();
  if (await canvas.isVisible()) {
    const box = await canvas.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // Orbit right
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 24; i++) {
        await page.mouse.move(cx + i * 10, cy - i * 2);
        await sleep(60);
      }
      await page.mouse.up();
      await sleep(2500);

      // Orbit back and tilt
      await page.mouse.move(cx + 240, cy - 48);
      await page.mouse.down();
      for (let i = 0; i < 20; i++) {
        await page.mouse.move(cx + 240 - i * 12, cy - 48 + i * 4);
        await sleep(60);
      }
      await page.mouse.up();
      await sleep(3000);
    }
  }

  console.log("=== SCENE 5: Autonomous Mobile Robots (AMRs) (1:25 - 1:45) ===");
  await updateHUD(
    page,
    "AUTONOMOUS INTRALOGISTICS",
    "Mobile Fleet (AMRs, AGVs & Automated Forklifts)",
    "Derived and simulated AMR fleets transfer raw kits and finished goods across aisles. Trips match real line rates, and robots automatically park with clear reasons when lines halt."
  );

  // Smooth pan in 3D canvas across AMR lanes
  if (canvas && (await canvas.isVisible())) {
    const box = await canvas.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down({ button: "right" }); // right-drag to pan
      for (let i = 0; i < 15; i++) {
        await page.mouse.move(cx - i * 8, cy);
        await sleep(60);
      }
      await page.mouse.up({ button: "right" });
    }
  }
  await sleep(8000);

  console.log("=== SCENE 6: 2D Floor Plan Blueprint (1:45 - 1:55) ===");
  const floorBtn = page.getByRole("button", { name: /Floor plan/i });
  if (await floorBtn.isVisible()) {
    await floorBtn.click();
    await sleep(2000);
  }

  await updateHUD(
    page,
    "2D FLOOR PLAN BLUEPRINT",
    "Architectural Layout & Safety Zones",
    "Architectural 2D layout mapping production lines, safety exclusion barriers, machine footprints, material staging buffers, and transit pathways."
  );
  await sleep(7000);

  console.log("=== SCENE 7: Dynamic Studio Customization (1:55 - 2:05) ===");
  const topoBtn = page.getByRole("button", { name: /Topology/i });
  if (await topoBtn.isVisible()) {
    await topoBtn.click();
    await sleep(2000);
  }

  // Open Add Asset dialog to show customization
  const addAssetBtn = page.getByRole("button", { name: "Add asset" });
  if (await addAssetBtn.isVisible()) {
    await addAssetBtn.click();
    await sleep(2000);
  }

  await updateHUD(
    page,
    "EXTENSIBLE FACTORY MODELING",
    "Asset Creation & Dependency Wiring",
    "Dynamically configure new production equipment, define material flow positions, connect process dependencies, and evaluate changes safely before physical implementation."
  );
  await sleep(6000);

  const cancelBtn = page.getByRole("button", { name: "Cancel" });
  if (await cancelBtn.isVisible()) {
    await cancelBtn.click();
    await sleep(2000);
  }

  console.log("Finishing Digital Twin Studio recording...");
  await page.close();
  await context.close();
  await browser.close();

  const files = fs.readdirSync(VIDEO_DIR);
  const webmFile = files.find((f) => f.endsWith(".webm"));
  if (!webmFile) {
    throw new Error("No webm video was recorded!");
  }

  const inputWebm = path.join(VIDEO_DIR, webmFile);
  const outputMp4 = path.join(process.cwd(), "docs", "Twin_Digital_Twin_Studio.mp4");

  console.log(`Converting ${inputWebm} to high quality MP4: ${outputMp4}...`);
  execSync(
    `/opt/homebrew/bin/ffmpeg -y -i "${inputWebm}" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 "${outputMp4}"`,
    { stdio: "inherit" }
  );

  console.log("Digital Twin Studio Explainer video saved to:", outputMp4);
  console.log("(Note: As requested, this file will NOT be pushed to git).");
}

run().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
