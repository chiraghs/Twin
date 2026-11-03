import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const BASE_URL = "http://localhost:3001";
const VIDEO_DIR = "/tmp/video_record_ai_ops";

if (fs.existsSync(VIDEO_DIR)) {
  fs.rmSync(VIDEO_DIR, { recursive: true, force: true });
}
fs.mkdirSync(VIDEO_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function smoothScroll(page, distance, steps = 20, delayPerStep = 40) {
  const stepDistance = distance / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), stepDistance);
    await sleep(delayPerStep);
  }
}

// Inject floating explanatory HUD overlay
async function updateHUD(page, step, title, desc) {
  await page.evaluate(({ step, title, desc }) => {
    let hud = document.getElementById("ai-ops-explainer");
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "ai-ops-explainer";
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
      hud.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif";
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
          <span style="font-size: 12.5px; color: #94a3b8; font-weight: 500;">Twin AI · Autonomous Operations</span>
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

  console.log("=== SCENE 1: The Incident Trigger (0:00 - 0:15) ===");
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
  await sleep(1500);

  // Trigger crisis
  const demoControlsBtn = page.getByRole("button", { name: "Demo controls" });
  if (await demoControlsBtn.isVisible()) {
    await demoControlsBtn.click();
    await sleep(1000);
    const crisisBtn = page.getByRole("button", { name: /Run Factory Crisis Demo/ });
    if (await crisisBtn.isVisible()) {
      await crisisBtn.click();
      await sleep(2500);
    }
  }

  await updateHUD(
    page,
    "INCIDENT DETECTED",
    "Telemetry Anomaly on Assembly Robot A-ROB-03",
    "Continuous IoT telemetry streams detect excessive vibration and thermal drift on Line A. A critical failure warning is flagged in the factory twin."
  );
  await sleep(6000);

  console.log("=== SCENE 2: Launching AI Operations (0:15 - 0:35) ===");
  const investigateBtn = page.getByRole("button", { name: "Investigate with AI agents" });
  if (await investigateBtn.isVisible()) {
    await investigateBtn.click();
  } else {
    await page.goto(`${BASE_URL}/agents`, { waitUntil: "networkidle" });
  }
  await sleep(3000);

  await updateHUD(
    page,
    "STAGE 1: OBSERVE & INITIATE",
    "Multi-Agent Swarm Orchestration",
    "Six specialist AI agents spin up to investigate the snapshot: Maintenance, Quality, Production Planning, Supply Chain, Energy & Orchestrator."
  );

  // Trigger streaming analysis
  const analyzeBtn = page.getByRole("button", { name: /Re-run analysis|Run analysis|Start/i });
  if (await analyzeBtn.isVisible()) {
    await analyzeBtn.click();
  }

  await sleep(7000);

  console.log("=== SCENE 3: Live Evidence Streaming (0:35 - 0:55) ===");
  await updateHUD(
    page,
    "STAGE 2: STREAMING EVIDENCE",
    "Real-Time Diagnostic Ingestion",
    "Specialist agents concurrently scan 16 assets and 1,200+ telemetry points. The live event terminal logs verified inputs, statistical tests, and anomaly detections."
  );
  await sleep(10000);

  console.log("=== SCENE 4: Specialist Deep Dive: Maintenance & Quality (0:55 - 1:15) ===");
  // Click Maintenance Agent
  const maintCard = page.locator("button, div").filter({ hasText: /Maintenance/i }).first();
  if (await maintCard.isVisible()) {
    await maintCard.click();
    await sleep(2000);
  }

  await updateHUD(
    page,
    "MAINTENANCE SPECIALIST",
    "Root-Cause Isolation & Wear Physics",
    "Isolates joint-4 bearing failure via FFT vibration spectral tracking and ISO 10816-3 thresholds. RUL degradation rate: 92% confidence."
  );
  await smoothScroll(page, 320, 15, 30);
  await sleep(6000);

  // Click Quality Agent
  const qualityCard = page.locator("button, div").filter({ hasText: /Quality/i }).first();
  if (await qualityCard.isVisible()) {
    await qualityCard.click();
    await sleep(1500);
  }

  await updateHUD(
    page,
    "QUALITY SPECIALIST",
    "Automated Optical Inspection (AOI) Correlation",
    "Detects Line A reject rate surge from 1.7% to 3.3% (IPC-A-610 Class 2 defect classification). Confirms strong correlation (r ≈ 0.89) with robot vibration."
  );
  await sleep(7000);

  console.log("=== SCENE 5: Grounded Evidence Table (1:15 - 1:35) ===");
  await updateHUD(
    page,
    "GROUNDING PRINCIPLE",
    "Evidence-Backed, Deterministic Numbers",
    "Our Core Principle: LLMs explain, numbers come from verified domain rules. Every agent finding lists its explicit inputs, algorithm, and mathematical evidence."
  );
  await smoothScroll(page, 200, 10, 30);
  await sleep(8000);
  await smoothScroll(page, -520, 15, 30);
  await sleep(2000);

  console.log("=== SCENE 6: Predictive Forecast & What-If Simulation (1:35 - 1:55) ===");
  await updateHUD(
    page,
    "STAGE 3 & 4: PREDICT & SIMULATE",
    "Failure Trajectory & Mitigation Evaluation",
    "Unmitigated trajectory: A-ROB-03 trips at h+16, causing 700 late units. Orchestrator simulates 4 alternative plans: Reroute to Line B scores 82.2 with 0 late units."
  );
  await sleep(10000);

  console.log("=== SCENE 7: Human Authorization Gate (1:55 - 2:08) ===");
  const approveLink = page.getByRole("link", { name: /Review & approve/i });
  if (await approveLink.isVisible()) {
    await approveLink.click();
  } else {
    await page.goto(`${BASE_URL}/approvals`, { waitUntil: "networkidle" });
  }
  await sleep(2500);

  await updateHUD(
    page,
    "STAGE 5: HUMAN APPROVAL",
    "People Decide · Complete Audit Trail",
    "AI agents propose optimal strategies, but execution requires human authorization. Every decision, tool call, and state transition is cryptographically logged."
  );
  await sleep(8000);

  console.log("Finishing recording...");
  await page.close();
  await context.close();
  await browser.close();

  const files = fs.readdirSync(VIDEO_DIR);
  const webmFile = files.find((f) => f.endsWith(".webm"));
  if (!webmFile) {
    throw new Error("No webm video was recorded!");
  }

  const inputWebm = path.join(VIDEO_DIR, webmFile);
  const outputMp4 = path.join(process.cwd(), "docs", "Twin_AI_Operations_Explained.mp4");

  console.log(`Converting ${inputWebm} to high quality MP4: ${outputMp4}...`);
  execSync(
    `/opt/homebrew/bin/ffmpeg -y -i "${inputWebm}" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 30 "${outputMp4}"`,
    { stdio: "inherit" }
  );

  console.log("AI Operations Explainer video saved to:", outputMp4);
}

run().catch((err) => {
  console.error("Recording failed:", err);
  process.exit(1);
});
