import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = "http://localhost:3000";
const OUT_DIR = "/tmp/twin_light_rec";

if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUT_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function smoothScroll(page, distance, steps = 15, delayPerStep = 40) {
  const stepDistance = distance / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), stepDistance);
    await sleep(delayPerStep);
  }
}

async function record() {
  console.log("Resetting factory to crisis state...");
  try {
    await fetch(`${BASE_URL}/api/demo/crisis`, { method: "POST" });
  } catch (e) {
    console.error("Crisis reset failed:", e.message);
  }

  console.log("Launching Chromium for 1080p Light Mode recording...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: {
      dir: OUT_DIR,
      size: { width: 1920, height: 1080 },
    },
  });

  await context.addInitScript(() => {
    localStorage.setItem("twin-theme", "light");
    document.documentElement.setAttribute("data-theme", "light");
  });

  const page = await context.newPage();

  // === SCENE 1: Landing Page (0:40 - 0:43) ===
  console.log("1. Recording Landing Page...");
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("twin-theme", "light");
  });
  await sleep(1500);

  // Move mouse to Launch Factory Demo and click
  const launchBtn = page.getByRole("link", { name: /Launch Factory Demo/i }).first();
  if (await launchBtn.isVisible()) {
    const box = await launchBtn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
      await sleep(600);
      await launchBtn.click();
    } else {
      await page.goto(`${BASE_URL}/dashboard`);
    }
  } else {
    await page.goto(`${BASE_URL}/dashboard`);
  }
  await sleep(2500);

  // === SCENE 2: Command Center (0:43 - 1:12) ===
  console.log("2. Recording Command Center...");
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await sleep(3500);

  // Smooth scroll to show KPIs, incident INC-2041, vibration trend
  await smoothScroll(page, 450, 20, 50);
  await sleep(3500);
  await smoothScroll(page, 400, 20, 50);
  await sleep(3500);
  await smoothScroll(page, -850, 25, 40);
  await sleep(2500);

  // Click Investigate with AI agents
  const invBtn = page.getByRole("link", { name: /Investigate with AI agents/i }).or(page.getByRole("button", { name: /Investigate with AI agents/i }));
  if (await invBtn.first().isVisible()) {
    await invBtn.first().click();
  } else {
    await page.goto(`${BASE_URL}/agents`);
  }
  await sleep(3000);

  // === SCENE 3: AI Operations (1:12 - 1:38) ===
  console.log("3. Recording AI Operations...");
  await page.goto(`${BASE_URL}/agents`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await sleep(4000);

  // If there is an analyze trigger, click it
  const reanalyzeBtn = page.getByRole("button", { name: /Start Multi-Agent Analysis|Investigate/i });
  if (await reanalyzeBtn.isVisible()) {
    await reanalyzeBtn.click();
  }
  await sleep(8000);
  await smoothScroll(page, 450, 20, 50);
  await sleep(5000);
  await smoothScroll(page, 450, 20, 50);
  await sleep(4000);
  await smoothScroll(page, -900, 20, 40);
  await sleep(2000);

  // === SCENE 4: Copilot Drawer (1:38 - 1:55) ===
  console.log("4. Recording Copilot Drawer...");
  const copilotBtn = page.getByRole("button", { name: /copilot|ask copilot/i }).first();
  if (await copilotBtn.isVisible()) {
    await copilotBtn.click();
    await sleep(2500);
  }
  // If there's an input or suggested prompt
  const suggestedQuery = page.getByText(/Why is Line A rejecting more boards/i).first();
  if (await suggestedQuery.isVisible()) {
    await suggestedQuery.click();
    await sleep(6000);
  } else {
    await sleep(4000);
  }

  // === SCENE 5: What-If Simulator (1:55 - 2:12) ===
  console.log("5. Recording What-If Simulator...");
  await page.goto(`${BASE_URL}/simulator`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await sleep(3500);

  try {
    const slider = page.getByRole("slider").first();
    if (await slider.isVisible()) {
      await slider.focus();
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("ArrowLeft");
        await sleep(500);
      }
      await sleep(2500);
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("ArrowRight");
        await sleep(500);
      }
      await sleep(2000);
    }
  } catch (e) {
    console.log("Slider adjustment bypassed:", e.message);
  }
  await smoothScroll(page, 400, 15, 45);
  await sleep(3500);
  await smoothScroll(page, -400, 15, 45);
  await sleep(2000);

  // === SCENE 6: Approvals (2:12 - 2:25) ===
  console.log("6. Recording Approvals...");
  await page.goto(`${BASE_URL}/approvals`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await sleep(3500);

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
    await sleep(3500);
  }

  // === SCENE 7: Twin Builder (2:25 - 2:38) ===
  console.log("7. Recording Twin Builder...");
  await page.goto(`${BASE_URL}/onboarding`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await sleep(4000);
  await smoothScroll(page, 450, 20, 50);
  await sleep(4500);
  await smoothScroll(page, -450, 20, 40);
  await sleep(2500);

  // === SCENE 8: Playground (2:38 - 2:50) ===
  console.log("8. Recording Playground...");
  await page.goto(`${BASE_URL}/playground`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await sleep(4000);

  // Hover and interact with canvas / tools
  const canvas = page.locator("canvas, svg").first();
  if (await canvas.isVisible()) {
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      await sleep(1500);
    }
  }
  await smoothScroll(page, 300, 15, 50);
  await sleep(3500);

  console.log("Closing page and finishing video stream...");
  await page.close();
  await context.close();
  await browser.close();

  const files = fs.readdirSync(OUT_DIR);
  const webm = files.find((f) => f.endsWith(".webm"));
  console.log("Raw recording saved to:", path.join(OUT_DIR, webm));
}

record().catch((e) => {
  console.error("Recording error:", e);
  process.exit(1);
});
