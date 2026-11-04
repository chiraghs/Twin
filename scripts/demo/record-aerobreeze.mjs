// Records the AeroBreeze Fans demo on a running Twin (default http://localhost:3105) at 1920×1080.
// Every step is real: live Twin Builder run, live agents, live approvals. Long AI waits are marked so
// the edit (make-video.mjs) can speed them up. Writes <out>/raw.webm and <out>/marks.json.
//   node scripts/demo/record-aerobreeze.mjs <outDir> [baseUrl]
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const OUT = path.resolve(process.argv[2] ?? "demo-out");
const BASE = process.argv[3] ?? "http://localhost:3105";
const DEMO = path.resolve("content/demo/aerobreeze");
const STATOR = process.env.AOI_IMAGE ?? path.join(OUT, "..", "02_winding.png");
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: OUT, size: { width: 1920, height: 1080 } } });
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
      el.style.cssText = "position:fixed;left:28px;bottom:28px;z-index:99999;padding:10px 18px;border-radius:12px;background:rgba(10,16,30,.88);color:#fff;font:600 22px Inter,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);border:1px solid rgba(120,160,255,.35);pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = text;
  }, text);
}
async function go(url, cap) {
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await hold(2.5);
  if (cap) await caption(cap);
}
async function smoothScroll(px, ms = 2500) {
  await page.evaluate(async ([px, ms]) => {
    const el = document.scrollingElement;
    const start = el.scrollTop, t0 = performance.now();
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

const ONLY = process.env.ONLY ?? ""; // "extras": just the 3D view and the copilot, on the plant already built

try {
  if (ONLY === "electronics") {
    // Aurora Electronics demo plant: scripted crisis on A-ROB-03, agents, copilot, what-if, approvals, analytics.
    await go("/dashboard", "Aurora Electronics · live Command Center");
    await hold(4);
    mark("calm");
    await go("/twin", "Live digital twin · 3D");
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await hold(8);
    mark("twin-3d");
    await page.request.post(BASE + "/api/demo/crisis");
    await go("/dashboard", "Robot A3 starts to vibrate · critical incident");
    await hold(14);
    mark("incident");
    await go("/agents", "AI Operations · six agents + intelligence backend");
    await page.getByRole("button", { name: /Run analysis/ }).first().click();
    mark("agents-start");
    await page.getByRole("button", { name: /Re-run analysis/ }).first().waitFor({ timeout: 300_000 });
    mark("agents-done");
    await caption("Every finding with its evidence · briefing written by Muse");
    await hold(3);
    await smoothScroll(700, 3000);
    await hold(3);
    await smoothScroll(700, 3000);
    await hold(3);
    mark("agents-read");
    await go("/dashboard", "Twin Copilot · multi-agent on Muse Spark");
    await page.getByTestId("copilot-open").click();
    await hold(1.5);
    await page.getByLabel("Message to the copilot").fill("Which machine is most at risk, and will tomorrow's critical order ship on time?");
    await hold(1.5);
    await page.getByLabel("Send to copilot").click();
    mark("copilot-start");
    await hold(40);
    mark("copilot-done");
    await hold(7);
    mark("copilot-read");
    await go("/simulator", "What-If · the twin simulates every option");
    await hold(5);
    await smoothScroll(600, 2500);
    await hold(4);
    mark("simulator");
    await go("/analytics/supply", "Supply Chain · MCU-7 runs out before the next delivery");
    await hold(4);
    const mcu = page.locator("tr", { hasText: "MCU-7" }).getByRole("button", { name: "Propose order" });
    if (await mcu.count()) {
      await mcu.first().scrollIntoViewIfNeeded();
      await hold(1.5);
      await mcu.first().click();
      await hold(3);
    }
    mark("supply");
    await go("/approvals", "Approvals · a person decides");
    await hold(2.5);
    for (let i = 0; i < 3; i++) {
      const pending = page.locator("button", { hasText: "pending" }).first();
      if (!(await pending.count())) break;
      await pending.click();
      await hold(2.5);
      const approve = page.getByRole("button", { name: /^Approve/ }).first();
      if (!(await approve.count())) break;
      await approve.click();
      await hold(1.5);
      await page.getByRole("dialog").getByRole("button", { name: "Approve & execute" }).click();
      await hold(3.5);
    }
    mark("approved");
    const ff = page.getByRole("button", { name: /Fast-forward 8 h/ });
    if (await ff.count()) {
      await caption("The twin carries out the plan · fast-forward 8 h");
      await ff.first().click();
      await hold(6);
    }
    mark("executed");
    await go("/dashboard", "Robot repaired · incident closed");
    await hold(6);
    mark("after");
    await go("/audit", "Audit trail · every step on the record");
    await hold(5);
    mark("audit");
    await go("/analytics/maintenance", "Analytics · maintenance, supply, demand, quality");
    await hold(5);
    mark("an-maint");
    await go("/quality", "Visual Quality · AOI, cameras and human review");
    await hold(5);
    mark("quality");
    await go("/onboarding", "Twin Builder · any plant can have its own twin");
    await hold(5);
    mark("builder");
    await go("/playground", "Playground · machines, flow and automation rules");
    await hold(5);
    mark("end");
    throw new Error("done");
  }
  if (ONLY === "extras") {
    await go("/twin", "Live digital twin · 3D, with AMRs and the forklift AGV");
    await page.getByRole("button", { name: "3D", exact: true }).click();
    mark("x-3d");
    await hold(9);
    mark("x-3d-end");
    await go("/dashboard", "Twin Copilot · multi-agent on Muse Spark");
    await page.getByTestId("copilot-open").click();
    await hold(1.5);
    await page.getByLabel("Message to the copilot").fill("Which line runs out of material first, and what should we do?");
    await hold(1.5);
    await page.getByLabel("Send to copilot").click();
    mark("copilot-start");
    await hold(40);
    mark("copilot-done");
    await hold(6);
    mark("end");
    throw new Error("done");
  }
  // ── 1. Twin Builder: drawing + requirements → live agent run ─────────────
  await go("/onboarding", "Twin Builder · drawing + requirements");
  mark("builder");
  await page.getByTestId("blueprint-file").setInputFiles(path.join(DEMO, "blueprint.png"));
  await hold(1.5);
  await page.getByLabel("Requirements").fill(fs.readFileSync(path.join(DEMO, "requirements.md"), "utf8").trim());
  await page.locator("#b-name").fill("AeroBreeze Fans");
  await page.locator("#b-ind").fill("Electrical appliances");
  await page.locator("#b-loc").fill("Peenya, Bengaluru");
  await hold(2.5);
  mark("builder-start");
  await page.getByTestId("builder-start").click();
  await caption("Muse Spark reads the drawing · researches · drafts (live)");
  await hold(4);
  mark("builder-wait");
  await page.getByTestId("builder-review").waitFor({ timeout: 420_000 });
  mark("builder-review");
  await caption("Review: every element shows where it came from");
  await hold(4);
  for (const tab of ["Blueprint", "Sources", "Products", "Connections"]) {
    const t = page.getByRole("tab", { name: tab });
    if (await t.count()) {
      await t.first().click();
      await hold(3);
    }
  }
  await smoothScroll(500, 2000);
  await hold(2);
  mark("build");
  await page.getByTestId("builder-build").click();
  await page.waitForURL("**/twin", { timeout: 120_000 });
  mark("built");

  // ── 2. The live twin ──────────────────────────────────────────────────────
  await hold(2);
  await caption("AeroBreeze is live · Digital Twin Studio");
  await hold(3);
  const tab3d = page.getByRole("button", { name: "3D", exact: true });
  if (await tab3d.count()) {
    await tab3d.first().click();
    await caption("Live digital twin · 3D, with AMRs and the forklift AGV");
    await hold(7);
  }
  mark("twin-3d");
  await go("/playground", "Playground · machines, flow and automation rules");
  await hold(5);
  mark("playground");

  // ── 3. Trouble: bearing wear on the rotor assembly robot ─────────────────
  const state = await (await page.request.get(BASE + "/api/factory")).json();
  const robot = state.assets.find((a) => /RA-06/.test(a.name)) ?? state.assets.find((a) => a.kind === "robot");
  await page.request.post(BASE + "/api/faults", { data: { assetId: robot.id, mode: "bearing-wear", severity: 60 } });
  await page.request.post(BASE + "/api/sim/advance", { data: { hours: 2 } });
  await go("/dashboard", `Command Center · ${robot.name} starts to vibrate`);
  await hold(14); // live ticks; the plant is synced to the intelligence backend
  mark("incident");

  // ── 4. Agents investigate ─────────────────────────────────────────────────
  await go("/agents", "AI Operations · six agents + intelligence backend");
  await page.getByRole("button", { name: /Run analysis/ }).first().click();
  mark("agents-start");
  await page.getByRole("button", { name: /Re-run analysis/ }).first().waitFor({ timeout: 300_000 });
  mark("agents-done");
  await caption("Findings with evidence · briefing written by Muse");
  await hold(3);
  await smoothScroll(700, 3000);
  await hold(3);
  await smoothScroll(700, 3000);
  await hold(3);
  mark("agents-read");

  // ── 5. Supply: propose the bearings order ─────────────────────────────────
  await go("/analytics/supply", "Supply Chain · bearings run out before the next delivery");
  await hold(4);
  const brg = page.locator("tr", { hasText: "6202" }).getByRole("button", { name: "Propose order" });
  if (await brg.count()) {
    await brg.first().scrollIntoViewIfNeeded();
    await hold(1.5);
    await brg.first().click();
    await hold(3);
  }
  mark("supply");

  // ── 6. What-if + approvals ────────────────────────────────────────────────
  await go("/simulator", "What-If · the twin simulates every option");
  await hold(5);
  mark("simulator");
  await go("/approvals", "Approvals · a person decides");
  await hold(2.5);
  for (const pick of [/6202/, /maintenance/i]) {
    const item = page.locator("button", { hasText: pick }).first();
    if (!(await item.count())) continue;
    await item.click();
    await hold(2.5);
    const approve = page.getByRole("button", { name: /^Approve/ }).first();
    if (await approve.count()) {
      await approve.click();
      await hold(1.5);
      await page.getByRole("dialog").getByRole("button", { name: "Approve & execute" }).click();
      await hold(3.5);
    }
  }
  mark("approved");

  // ── 7. Analytics ──────────────────────────────────────────────────────────
  await go("/analytics/maintenance", "Maintenance analytics · hours to trip, health heatmap");
  await hold(4);
  await smoothScroll(600, 2500);
  await hold(2);
  mark("an-maint");
  await go("/analytics/demand", "Demand · festival forecast vs capacity");
  await hold(5);
  mark("an-demand");
  await go("/analytics/quality", "Quality · AOI with Muse Spark + SAM 3.1");
  await page.locator("#aoi-file").setInputFiles(STATOR);
  await hold(1.5);
  await page.getByRole("button", { name: "Inspect" }).click();
  mark("aoi-start");
  await page.getByText(/Inspection stored as/).first().waitFor({ timeout: 240_000 }).catch(() => {});
  mark("aoi-done");
  await hold(4);
  await smoothScroll(500, 2000);
  await hold(2);
  mark("an-quality");

  // ── 8. Copilot ────────────────────────────────────────────────────────────
  await go("/dashboard", "Twin Copilot · multi-agent on Muse Spark");
  await page.getByTestId("copilot-open").click();
  await hold(1.5);
  await page.getByLabel("Message to the copilot").fill("Which line runs out of material first, and what should we do?");
  await hold(1.5);
  await page.getByLabel("Send to copilot").click();
  mark("copilot-start");
  await hold(40); // the multi-agent answer arrives in ~15–30 s; the edit trims this wait
  mark("copilot-done");
  await hold(7);
  mark("end");
} catch (e) {
  if (e instanceof Error && e.message === "done") { /* extras finished */ } else {
  mark("error: " + (e instanceof Error ? e.message.split("\n")[0] : String(e)));
  await page.screenshot({ path: path.join(OUT, "error.png") });
  }
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) fs.renameSync(await video.path(), path.join(OUT, "raw.webm"));
  fs.writeFileSync(path.join(OUT, "marks.json"), JSON.stringify(marks, null, 2));
  console.log("wrote", path.join(OUT, "raw.webm"));
}
