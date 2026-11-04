import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = path.resolve(process.argv[2] ?? "/tmp/twin_rec_e");
const BASE = process.argv[3] ?? "http://localhost:3000";
fs.mkdirSync(OUT, { recursive: true });

console.log("Starting Electronics Light Mode recording at 1920x1080 against", BASE);

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } },
});

await context.addInitScript(() => {
  localStorage.setItem("twin-theme", "light");
  document.documentElement.setAttribute("data-theme", "light");
});

const page = await context.newPage();
const t0 = Date.now();
const marks = [];

const mark = (name) => {
  const t = (Date.now() - t0) / 1000;
  marks.push({ name, t });
  console.log(t.toFixed(1).padStart(7), name);
};

const hold = (s) => page.waitForTimeout(s * 1000);

async function caption(text) {
  await page.evaluate((text) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      el.style.cssText =
        "position:fixed;left:28px;bottom:28px;z-index:99999;padding:10px 18px;border-radius:12px;background:rgba(255,255,255,0.92);color:#1e293b;font:600 20px Inter,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.18);border:1px solid rgba(59,130,246,0.35);pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = text;
  }, text);
}

async function go(url, cap) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("twin-theme", "light");
  });
  await hold(2.5);
  if (cap) await caption(cap);
}

async function smoothScroll(px, ms = 2500) {
  await page.evaluate(async ([px, ms]) => {
    const el = document.scrollingElement;
    const start = el.scrollTop,
      t0 = performance.now();
    await new Promise((r) => {
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        el.scrollTop = start + px * (0.5 - Math.cos(Math.PI * k) / 2);
        k < 1 ? requestAnimationFrame(step) : r();
      };
      requestAnimationFrame(step);
    });
  }, [px, ms]);
}

try {
  // ── 0. Landing Page (0:40 - 0:43) ─────────────────────────────────────────
  console.log("Scene 0: Landing page product showcase...");
  await go("/", "Twin AI · Your factory. Reimagined before reality");
  await hold(2.0);
  const launch = page.getByRole("link", { name: /Launch Factory Demo/i }).first();
  if (await launch.isVisible()) {
    const box = await launch.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
      await hold(0.6);
      await launch.click();
      await hold(2.5);
    }
  }
  mark("landing");

  // ── 1. Calm plant & 3D Twin ──────────────────────────────────────────────
  console.log("Scene 1: Calm plant & 3D...");
  await go("/dashboard", "Aurora Electronics · live Command Center");
  await hold(4);
  mark("calm");

  await go("/twin", "Live digital twin · 3D viewport");
  const threeDBtn = page.getByRole("button", { name: "3D", exact: true });
  if (await threeDBtn.isVisible()) {
    await threeDBtn.click();
    await hold(5);
  }
  mark("twin-3d");

  // ── 2. Trigger Scripted Crisis ───────────────────────────────────────────
  console.log("Scene 2: Crisis incident...");
  await page.request.post(BASE + "/api/demo/crisis");
  await go("/dashboard", "Robot A3 starts to vibrate · critical incident");
  await hold(6);
  await smoothScroll(450, 2000);
  await hold(3);
  await smoothScroll(-450, 1500);
  await hold(2);
  mark("incident");

  // ── 3. AI Operations ─────────────────────────────────────────────────────
  console.log("Scene 3: AI Operations...");
  await go("/agents", "AI Operations · six agents + intelligence backend");
  const runBtn = page.getByRole("button", { name: /Run analysis|Start Multi-Agent Analysis/i }).first();
  if (await runBtn.isVisible()) {
    await runBtn.click();
  }
  mark("agents-start");
  await hold(12);
  mark("agents-done");

  await caption("Every finding with its evidence · verified by Meta Muse Spark");
  await hold(2);
  await smoothScroll(600, 2500);
  await hold(3);
  await smoothScroll(600, 2500);
  await hold(3);
  await smoothScroll(-1200, 2000);
  await hold(2);
  mark("agents-read");

  // ── 4. Copilot on Muse Spark ─────────────────────────────────────────────
  console.log("Scene 4: Copilot...");
  await go("/dashboard", "Twin Copilot · running on Meta Muse Spark");
  const copilotBtn = page.getByTestId("copilot-open").first();
  if (await copilotBtn.isVisible()) {
    await copilotBtn.click();
    await hold(1.5);
    const input = page.getByLabel("Message to the copilot");
    if (await input.isVisible()) {
      await input.fill("Which machine is most at risk, and will tomorrow's critical order ship on time?");
      await hold(1.0);
      await page.getByLabel("Send to copilot").click();
      mark("copilot-start");
      await hold(15);
      mark("copilot-done");
    }
  }
  await hold(4);
  mark("copilot-read");

  // ── 5. What-If Simulator ─────────────────────────────────────────────────
  console.log("Scene 5: Simulator...");
  await go("/simulator", "What-If Simulator · simulate every option");
  await hold(3);
  try {
    const slider = page.getByRole("slider").first();
    if (await slider.isVisible()) {
      await slider.focus();
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("ArrowLeft");
        await hold(0.3);
      }
      await hold(2);
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("ArrowRight");
        await hold(0.3);
      }
    }
  } catch (e) {}
  await smoothScroll(500, 2000);
  await hold(3);
  await smoothScroll(-500, 1500);
  await hold(2);
  mark("simulator");

  // ── 6. Approvals ─────────────────────────────────────────────────────────
  console.log("Scene 6: Approvals...");
  await go("/approvals", "Approvals · a person decides");
  await hold(2.5);
  const approveBtn = page.getByRole("button", { name: /Approve & execute/i }).first();
  if (await approveBtn.isVisible()) {
    await approveBtn.click();
    await hold(1.5);
    const dialogBtn = page.getByRole("dialog").getByRole("button", { name: /Approve & execute/i });
    if (await dialogBtn.isVisible()) {
      await dialogBtn.click();
      await hold(2.5);
    }
  }
  mark("approved");

  const ff = page.getByRole("button", { name: /Fast-forward 8 h/i }).first();
  if (await ff.isVisible()) {
    await caption("The twin carries out the plan · fast-forward 8 h");
    await ff.click();
    await hold(4);
  }
  mark("executed");

  await go("/dashboard", "Robot repaired · incident closed");
  await hold(3);
  mark("after");

  // ── 7. Twin Builder ──────────────────────────────────────────────────────
  console.log("Scene 7: Twin Builder...");
  await go("/onboarding", "Twin Builder · blueprint reading with full provenance");
  await hold(4);
  await smoothScroll(450, 2000);
  await hold(3);
  await smoothScroll(-450, 1500);
  await hold(2);
  mark("builder");

  // ── 8. Playground ────────────────────────────────────────────────────────
  console.log("Scene 8: Playground...");
  await go("/playground", "Playground · machines, flow and automation rules");
  await hold(4);
  await smoothScroll(300, 2000);
  await hold(3);
  mark("playground");
  mark("end");

  console.log("Finished all recording scenes successfully!");
} catch (err) {
  console.error("Recording error:", err);
} finally {
  await page.close();
  await context.close();
  await browser.close();

  fs.writeFileSync(path.join(OUT, "marks.json"), JSON.stringify(marks, null, 2));
  console.log("Saved marks.json with", marks.length, "marks");
}
