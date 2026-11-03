import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const BASE_URL = "http://localhost:3001";
const VIDEO_DIR = "/tmp/video_record";

if (fs.existsSync(VIDEO_DIR)) {
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
}
fs.mkdirSync(VIDEO_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function smoothScroll(page, distance, steps = 20, delayPerStep = 50) {
  const stepDistance = distance / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), stepDistance);
    await sleep(delayPerStep);
  }
}

async function run() {
  console.log("Resetting demo factory state...");
  await fetch(`${BASE_URL}/api/factory/reset`, { method: "POST" });

  console.log("Launching Chromium browser for 1080p recording...");
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

  console.log("=== SCENE 1: Landing Page (0:00 - 0:20) ===");
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await sleep(3000);
  // Smooth scroll down the landing page
  await smoothScroll(page, 700, 30, 60);
  await sleep(3000);
  await smoothScroll(page, 700, 30, 60);
  await sleep(3000);
  await smoothScroll(page, 700, 30, 60);
  await sleep(3000);
  // Scroll back to top
  await smoothScroll(page, -2100, 30, 40);
  await sleep(2000);

  console.log("=== SCENE 2: Factory Command Center & Crisis Injection (0:20 - 0:45) ===");
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
  await sleep(4000);
  
  // Trigger crisis demo
  const demoControlsBtn = page.getByRole("button", { name: "Demo controls" });
  if (await demoControlsBtn.isVisible()) {
    await demoControlsBtn.click();
    await sleep(1500);
    const crisisBtn = page.getByRole("button", { name: /Run Factory Crisis Demo/ });
    if (await crisisBtn.isVisible()) {
      await crisisBtn.click();
      await sleep(3000);
    }
  }

  // Scroll through Command Center dashboard
  await smoothScroll(page, 500, 25, 60);
  await sleep(4000);
  await smoothScroll(page, -500, 20, 50);
  await sleep(3000);

  console.log("=== SCENE 3: AI Operations & Multi-Agent Investigation (0:45 - 1:15) ===");
  const investigateBtn = page.getByRole("button", { name: "Investigate with AI agents" });
  if (await investigateBtn.isVisible()) {
    await investigateBtn.click();
  } else {
    await page.goto(`${BASE_URL}/agents`, { waitUntil: "networkidle" });
  }
  await sleep(3000);

  // If there is an analyze trigger, click it
  const reanalyzeBtn = page.getByRole("button", { name: /Start Multi-Agent Analysis|Investigate/ });
  if (await reanalyzeBtn.isVisible()) {
    await reanalyzeBtn.click();
  }
  
  // Wait for agent findings to stream
  console.log("Waiting for agents to stream analysis...");
  await sleep(14000);
  await smoothScroll(page, 450, 20, 60);
  await sleep(6000);
  await smoothScroll(page, 450, 20, 60);
  await sleep(6000);
  await smoothScroll(page, -900, 25, 40);
  await sleep(2000);

  console.log("=== SCENE 4: What-If Twin Simulator (1:15 - 1:45) ===");
  const compareBtn = page.getByRole("button", { name: "Compare operating plans" });
  if (await compareBtn.isVisible()) {
    await compareBtn.click();
  } else {
    await page.goto(`${BASE_URL}/simulator`, { waitUntil: "networkidle" });
  }
  await sleep(4000);

  // Explore What-If sliders
  try {
    const slider = page.getByRole("slider", { name: "MCU-7 usable stock" });
    if (await slider.isVisible()) {
      await slider.focus();
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("ArrowLeft");
        await sleep(600);
      }
      await sleep(3000);
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("ArrowRight");
        await sleep(500);
      }
      await sleep(2000);
    }
  } catch (e) {
    console.log("Slider interaction skipped:", e.message);
  }

  await smoothScroll(page, 400, 20, 50);
  await sleep(5000);
  await smoothScroll(page, -400, 15, 40);
  await sleep(2000);

  console.log("=== SCENE 5: Digital Twin Studio (1:45 - 2:15) ===");
  await page.goto(`${BASE_URL}/twin`, { waitUntil: "networkidle" });
  await sleep(4000);

  // Switch to Isometric view
  const isoBtn = page.getByRole("button", { name: /Isometric/i });
  if (await isoBtn.isVisible()) {
    await isoBtn.click();
    await sleep(4000);
  }

  // Switch to 3D view
  const threeDBtn = page.getByRole("button", { name: /3D/i });
  if (await threeDBtn.isVisible()) {
    await threeDBtn.click();
    await sleep(5000);

    // Orbit in 3D canvas
    const canvas = page.locator("canvas").first();
    if (await canvas.isVisible()) {
      const box = await canvas.boundingBox();
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        // Orbit drag
        for (let i = 0; i < 20; i++) {
          await page.mouse.move(cx + i * 8, cy - i * 3);
          await sleep(50);
        }
        await page.mouse.up();
        await sleep(3000);
      }
    }
  }

  // Switch to Topology view
  const topoBtn = page.getByRole("button", { name: /Topology/i });
  if (await topoBtn.isVisible()) {
    await topoBtn.click();
    await sleep(4000);
  }

  console.log("=== SCENE 6: Visual Quality & Inspection Cameras (2:15 - 2:35) ===");
  await page.goto(`${BASE_URL}/quality`, { waitUntil: "networkidle" });
  await sleep(4000);
  await smoothScroll(page, 500, 25, 50);
  await sleep(5000);
  await smoothScroll(page, -500, 20, 50);
  await sleep(2000);

  // CCTV Control room
  await page.goto(`${BASE_URL}/control-room`, { waitUntil: "networkidle" });
  await sleep(5000);

  console.log("=== SCENE 7: Human Approvals & Execution (2:35 - 2:50) ===");
  await page.goto(`${BASE_URL}/approvals`, { waitUntil: "networkidle" });
  await sleep(4000);
  
  const approveBtn = page.getByRole("button", { name: /Approve & execute/i }).first();
  if (await approveBtn.isVisible()) {
    await approveBtn.click();
    await sleep(1500);
    const modalApprove = page.getByRole("dialog").getByRole("button", { name: /Approve & execute/i });
    if (await modalApprove.isVisible()) {
      await modalApprove.click();
      await sleep(2000);
    }
  }

  const fastForwardBtn = page.getByRole("button", { name: /Fast-forward 8 h/i });
  if (await fastForwardBtn.isVisible()) {
    await fastForwardBtn.click();
    await sleep(4000);
  }

  console.log("=== SCENE 8: Twin Builder & Playground (2:50 - 3:10) ===");
  await page.goto(`${BASE_URL}/onboarding`, { waitUntil: "networkidle" });
  await sleep(5000);
  await smoothScroll(page, 400, 20, 50);
  await sleep(3000);

  await page.goto(`${BASE_URL}/playground`, { waitUntil: "networkidle" });
  await sleep(6000);

  console.log("Closing page and saving video...");
  await page.close();
  await context.close();
  await browser.close();

  console.log("Finding recorded webm video...");
  const files = fs.readdirSync(VIDEO_DIR);
  const webmFile = files.find((f) => f.endsWith(".webm"));
  if (!webmFile) {
    throw new Error("No webm video was recorded!");
  }

  const inputWebm = path.join(VIDEO_DIR, webmFile);
  const outputMp4 = path.join(process.cwd(), "docs", "Twin_AI_Walkthrough.mp4");

  console.log(`Converting ${inputWebm} to high quality MP4: ${outputMp4}...`);
  execSync(
    `/opt/homebrew/bin/ffmpeg -y -i "${inputWebm}" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 "${outputMp4}"`,
    { stdio: "inherit" }
  );

  console.log("Recording complete! Output saved to:", outputMp4);
}

run().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
