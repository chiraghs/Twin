import { expect, test, type Page } from "@playwright/test";

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.beforeEach(async ({ request }) => {
  const r = await request.post("/api/factory/reset");
  expect(r.ok()).toBeTruthy();
});

test("every page renders without console errors", async ({ page }) => {
  const errors = collectErrors(page);
  for (const path of ["/", "/onboarding", "/dashboard", "/twin", "/assets", "/quality", "/agents", "/simulator", "/approvals", "/sustainability", "/audit", "/control-room", "/integrations", "/playground"]) {
    // Wait for rendered content rather than "networkidle": the app polls live telemetry every 4 s.
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1:visible, h2:visible").first()).toBeVisible();
    await page.waitForTimeout(500);
  }
  expect(errors).toEqual([]);
});

test("guided factory crisis demo: incident → agents → scenarios → twin → approval → audit", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Launch Factory Demo" }).first().click();
  await expect(page.getByRole("heading", { name: "Factory Command Center" })).toBeVisible();

  // Scripted crisis
  await page.getByRole("button", { name: "Demo controls" }).click();
  await page.getByRole("button", { name: /Run Factory Crisis Demo/ }).click();
  await expect(page.getByText("Guided crisis demo")).toBeVisible();
  await expect(page.getByText(/Assembly Robot A3/).first()).toBeVisible();
  await expect(page.getByText("Critical", { exact: true }).first()).toBeVisible();

  // Agents investigate (real streamed stages)
  await page.getByRole("button", { name: "Investigate with AI agents" }).click();
  await expect(page.getByRole("heading", { name: "AI Operations Command Center" })).toBeVisible();
  await expect(page.getByText("Recommended action")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Without intervention: A-ROB-03 trips at h\+/).first()).toBeVisible();
  await expect(page.getByText(/Reroute ECU-200 to Assembly Line B/).first()).toBeVisible();

  // Scenario comparison responds to parameters
  await page.getByRole("button", { name: "Compare operating plans" }).click();
  await expect(page.getByRole("heading", { name: "What-If Twin Simulator" })).toBeVisible();
  const rerouteCard = page.locator("button", { hasText: "Recommended" }).first();
  await expect(rerouteCard).toContainText("Reroute");
  const before = await page.getByText(/\d+(\.\d)? \/ 100 score|^\d+\.\d$/).allTextContents();
  const slider = page.getByRole("slider", { name: "MCU-7 usable stock" });
  await slider.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("70% · ")).toBeVisible();
  await expect.poll(async () => JSON.stringify(await page.locator("button:has-text('/ 100 score')").allTextContents())).not.toBe(JSON.stringify(before));
  // restore
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");

  // Digital twin highlight
  await page.getByRole("button", { name: "See it in the digital twin" }).click();
  await expect(page.getByText(/Showing scenario/)).toBeVisible();
  await expect(page.locator(".react-flow__node[data-id='A-ROB-03']")).toBeVisible();

  // Human approval + simulated execution
  await page.getByRole("button", { name: "Review the recommendation" }).click();
  await expect(page.getByRole("heading", { name: "Human Approval & Execution" })).toBeVisible();
  await page.getByRole("button", { name: "Approve & execute" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Approve & execute" }).click();
  await expect(page.getByText("Execution status", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fast-forward 8 h" }).click();
  await expect(page.getByText("All actions completed in the twin")).toBeVisible();
  await expect(page.getByText(/A-ROB-03\s*is\s*healthy/)).toBeVisible();

  // Audit trail records the decision and outcome
  await page.getByRole("button", { name: "View the audit trail" }).click();
  await expect(page.getByRole("heading", { name: "Audit Trail & Event Timeline" })).toBeVisible();
  await expect(page.getByText(/^Approved REC-/).first()).toBeVisible();
  await expect(page.getByText("A-ROB-03 returned to service").first()).toBeVisible();

  expect(errors).toEqual([]);
});

test("reset demo restores the reproducible initial scenario", async ({ request }) => {
  await request.post("/api/demo/crisis");
  await request.post("/api/sim/advance", { data: { hours: 4 } });
  const reset = await (await request.post("/api/factory/reset")).json();
  expect(reset.clock.hour).toBe(0);
  expect(reset.analyses).toHaveLength(0);
  expect(reset.recommendations).toHaveLength(0);
  const rob = reset.assets.find((a: { id: string }) => a.id === "A-ROB-03");
  expect(rob.status).toBe("warning");
  expect(reset.incidents).toHaveLength(1);
});

test("API validates input and returns useful errors", async ({ request }) => {
  const bad = await request.post("/api/faults", { data: { assetId: "A-ROB-03", mode: "explode" } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).issues.length).toBeGreaterThan(0);
  const missing = await request.patch("/api/assets/NOPE", { data: { name: "x y" } });
  expect(missing.status()).toBe(404);
  const health = await request.get("/api/health");
  expect((await health.json()).status).toBe("ok");
});

test("isometric twin view supports selection, and the theme toggle persists", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/twin");
  await page.getByRole("button", { name: "Isometric" }).click();
  // first(): the main viewport; camera thumbnails in the asset panel render the scene too
  const robot = page.locator("[data-asset='A-ROB-03']").first();
  await expect(robot).toBeVisible();
  await robot.click();
  await expect(page.getByText("Condition diagnostics")).toBeVisible();
  await page.getByRole("button", { name: "Rotate right" }).click();
  await expect(robot).toBeVisible();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("landing scroll story advances through every chapter", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your factory\./ })).toBeVisible();
  const chapters = ["Every asset. Mirrored.", "It notices what people miss.", "Six agents. One investigation.", "See tomorrow. Choose today.", "You stay in command.", "Every decision, on the record."];
  const total = await page.evaluate(() => (document.querySelector("section[aria-label='Twin AI product story']") as HTMLElement).offsetHeight - innerHeight);
  for (let i = 0; i < chapters.length; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.round(((i + 1.45) / 7) * total));
    await expect(page.getByRole("heading", { name: chapters[i] })).toBeVisible();
  }
  await page.getByText("The crisis, by the numbers").scrollIntoViewIfNeeded();
  await expect(page.getByText("of unplanned downtime avoided")).toBeVisible();
  expect(errors).toEqual([]);
});

test("cameras: twin card → live view (audited) → visual quality review with human disposition", async ({ page, request }) => {
  const errors = collectErrors(page);
  await request.post("/api/demo/crisis");

  // Camera in the isometric twin opens a card with the camera's view
  await page.goto("/twin");
  await page.getByRole("button", { name: "Isometric" }).click();
  await page.getByRole("button", { name: "Camera THM-A1" }).click();
  const card = page.getByTestId("camera-panel");
  await expect(card).toBeVisible();
  await expect(card.getByText(/Hottest: A-ROB-03/)).toBeVisible();
  await expect(card.getByText("Twin feed", { exact: true })).toBeVisible();

  // The user chooses to watch the live stream; the access is written to the audit trail
  await card.getByRole("button", { name: "Watch live stream" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("live-feed")).toBeVisible();
  await expect(dialog.getByText("Access logged")).toBeVisible();
  await expect
    .poll(async () => ((await (await request.get("/api/audit")).json()) as { entries: { title: string }[] }).entries.some((e) => e.title === "Live view opened: THM-A1"))
    .toBe(true);
  await dialog.getByRole("button", { name: "Close" }).click();

  // Visual Quality: rising AOI rejects linked to the robot; review needs a human decision
  await page.getByRole("link", { name: "Visual Quality" }).click();
  await expect(page.getByRole("heading", { name: "Visual Quality" })).toBeVisible();
  await expect(page.getByText("rising", { exact: true })).toBeVisible();
  await expect(page.getByText(/r = 0\.\d\d/).first()).toBeVisible();
  await expect(page.getByTestId("camera-tile")).toHaveCount(9);
  await page.getByRole("button", { name: "Review last 60 units" }).click();
  const review = page.getByTestId("vision-review").first();
  await expect(review.getByText("Awaiting human review")).toBeVisible();
  await review.getByRole("button", { name: /Confirm/ }).click();
  await expect(review.getByText("confirmed")).toBeVisible();
  expect(errors).toEqual([]);
});

test("camera API rejects insecure stream URLs and reports AI status honestly", async ({ request }) => {
  const insecure = await request.patch("/api/cameras/CCTV-A1", { data: { kind: "hls", url: "http://10.0.0.9/a.m3u8" } });
  expect(insecure.status()).toBe(400);
  const unknown = await request.post("/api/cameras/NOPE/view", { data: {} });
  expect(unknown.status()).toBe(404);
  const integrations = (await (await request.get("/api/integrations")).json()) as { integrations: { id: string; state: string }[] };
  const meta = integrations.integrations.find((i) => i.id === "meta-ai")!;
  const upload = await request.post("/api/vision/analyze", { multipart: { file: { name: "frame.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } } });
  if (meta.state === "not-configured") expect(upload.status()).toBe(503);
  else expect([201, 502]).toContain(upload.status());

  // Python vision service: an honest 503 when it isn't connected; a real verdict on the input when it is
  const vision = integrations.integrations.find((i) => i.id === "vision-service")!;
  const inspect = await request.post("/api/vision/inspect", { multipart: { file: { name: "frame.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) } } });
  if (vision.state === "not-configured") expect(inspect.status()).toBe(503);
  else expect([422, 502]).toContain(inspect.status());
});

test("Twin Builder: describe → draft → review with provenance → plan a connection → build", async ({ page, request }) => {
  const errors = collectErrors(page);
  await page.goto("/onboarding");
  await page.evaluate(() => localStorage.removeItem("twin-builder"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Twin Builder" })).toBeVisible();
  const meta = (await (await request.get("/api/builder")).json()) as { ai: { available: boolean } };

  await page.getByLabel("Requirements").fill("We bottle spring water in PET on one line, then case packing and palletizing. Two AMRs bring preforms and caps from the warehouse to the bottling line.");
  await page.getByLabel("Factory name").fill("Riverside Bottling");
  if (meta.ai.available) await page.getByRole("switch", { name: "Research on the web" }).click(); // keep the e2e run offline-fast
  await page.getByTestId("builder-start").click();
  const review = page.getByTestId("builder-review");
  await expect(review).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("line-editor").first()).toBeVisible();
  if (!meta.ai.available) await expect(review.getByText("Drafted from a template")).toBeVisible();
  // The robots asked for in the requirements are in the draft, reviewable and editable
  const robots = page.getByTestId("robots-editor");
  await expect(robots.getByTestId("robot-fleet").first()).toBeVisible();
  const fleetCount = await robots.getByTestId("robot-fleet").count();
  await page.getByTestId("add-robot-fleet").click();
  await expect(robots.getByTestId("robot-fleet")).toHaveCount(fleetCount + 1);

  // Manual edit goes through validated operations and is attributed to the user
  const rate = page.getByTestId("line-editor").first().getByLabel("Rate per hour").first();
  await rate.fill("15000");
  await rate.blur();
  await expect(review.getByText("Your edit").first()).toBeVisible();

  await page.getByRole("tab", { name: "Connections" }).click();
  await page.getByLabel("Connection type").selectOption("opcua");
  await page.getByLabel("Address").fill("ns=3;s=Line.Speed");
  await page.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByText("ns=3;s=Line.Speed")).toBeVisible();

  await page.getByTestId("builder-build").click();
  await page.waitForURL("**/twin");
  await expect(page.getByText("Riverside Bottling").first()).toBeVisible();
  const state = (await (await request.get("/api/factory")).json()) as { profile: { name: string }; twinSpec: unknown; dataPlan: { kind: string; status: string }[]; audit: { title: string }[]; mobileRobots?: { mission: string }[] };
  // Two requested kitting AMRs (at least) plus the fleet added by hand
  expect(state.mobileRobots?.length ?? 0).toBeGreaterThanOrEqual(3);
  expect(state.profile.name).toBe("Riverside Bottling");
  expect(state.twinSpec).toBeTruthy();
  expect(state.dataPlan).toContainEqual(expect.objectContaining({ kind: "opcua", address: "ns=3;s=Line.Speed", status: "planned" }));
  expect(state.audit[0].title).toContain("Twin Builder");
  expect(errors).toEqual([]);
});

test("MCP server: initialize, list tools with read-only hints, call a tool", async ({ request }) => {
  const headers = { accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-protocol-version": "2025-06-18" };
  const init = await request.post("/api/mcp", { headers, data: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } } });
  expect((await init.json()).result.serverInfo.name).toBe("twin");
  const list = (await (await request.post("/api/mcp", { headers, data: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } })).json()) as { result: { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] } };
  expect(list.result.tools).toHaveLength(12);
  expect(list.result.tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name)).toEqual(["propose_plan"]);
  const call = (await (await request.post("/api/mcp", { headers, data: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "diagnose_asset", arguments: { assetId: "A-ROB-03" } } } })).json()) as { result: { content: { text: string }[] } };
  expect(JSON.parse(call.result.content[0].text).asset.id).toBe("A-ROB-03");
  const bad = (await (await request.post("/api/mcp", { headers, data: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "diagnose_asset", arguments: { assetId: "NOPE" } } } })).json()) as { result: { isError: boolean } };
  expect(bad.result.isError).toBe(true);
});

test("Copilot (Muse Spark): grounded answer with a visible tool trace", async ({ page, request }) => {
  const info = (await (await request.get("/api/copilot")).json()) as { available: boolean };
  test.skip(!info.available, "No AI provider is configured (or AI is off) on this server");
  test.setTimeout(150_000);
  const errors = collectErrors(page);
  await request.post("/api/demo/crisis");
  await page.goto("/dashboard");
  await page.evaluate(() => localStorage.removeItem("twin-copilot"));
  await page.reload();
  await page.getByTestId("copilot-open").click();
  await page.getByLabel("Message to the copilot").fill("Which machine is most at risk right now? Answer briefly.");
  await page.getByRole("button", { name: "Send to copilot" }).click();
  const answer = page.getByTestId("copilot-answer").last();
  await expect(answer.getByText(/figures checked against tool results|not traced to a tool/)).toBeVisible({ timeout: 120_000 });
  await expect(answer.getByText(/A-ROB-03/).first()).toBeVisible();
  await expect(answer.getByText(/tool calls? by/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("CCTV control room: switch every camera to reference footage and back (admin, audited)", async ({ page, request }) => {
  const errors = collectErrors(page);
  const session = (await (await request.get("/api/admin/session")).json()) as { admin: boolean; mode: string };
  test.skip(!session.admin, "Admin is not open on this server (a passcode is set); covered by the unit tests.");
  await page.goto("/control-room");
  await expect(page.getByRole("heading", { name: "CCTV Control Room" })).toBeVisible();
  const tiles = page.getByTestId("control-tile");
  await expect(tiles).toHaveCount(9);
  await expect(page.getByTestId("footage-clip").first()).toBeVisible();

  await page.getByTestId("all-footage").click();
  await expect(page.locator('[data-testid="control-tile"][data-source="footage"]')).toHaveCount(9);
  await expect(page.locator('[data-testid="control-tile"] video[src^="/footage/"]').first()).toBeVisible();
  await expect(page.getByText("REFERENCE FOOTAGE").first()).toBeVisible();
  await expect(page.getByTestId("camera-inspector").getByText("Reference footage, not this plant.")).toBeVisible();
  // The copilot tools describe the source honestly
  const cams = (await (await request.get("/api/cameras")).json()) as { cameras: { id: string; stream: { kind: string; url: string } }[] };
  expect(cams.cameras.every((c) => c.stream.kind === "footage")).toBe(true);
  const clip = await request.get(cams.cameras[0].stream.url);
  expect(clip.ok()).toBeTruthy();
  expect(clip.headers()["content-type"]).toContain("video/mp4");

  await page.getByTestId("all-twin").click();
  await expect(page.locator('[data-testid="control-tile"][data-source="simulated"]')).toHaveCount(9);
  const audit = (await (await request.get("/api/audit")).json()) as { entries?: { title: string }[] } | { title: string }[];
  const titles = (Array.isArray(audit) ? audit : (audit.entries ?? [])).map((e) => e.title);
  expect(titles.some((t) => /switched to reference footage/.test(t))).toBe(true);

  // Visual QA needs reference footage on the camera; on the twin feed it explains why not
  const qa = await request.post("/api/cameras/CCTV-A1/analyze", { data: { engine: "opencv" } });
  expect(qa.status()).toBe(409);
  expect(errors).toEqual([]);
});

test("integrations can be configured from the UI and returned to the deployment value", async ({ page, request }) => {
  const session = (await (await request.get("/api/admin/session")).json()) as { admin: boolean };
  test.skip(!session.admin, "Admin is not open on this server (a passcode is set).");
  const bad = await request.put("/api/integrations/settings", { data: { values: { VISION_SERVICE_URL: "http://10.1.2.3:8000" } } });
  expect(bad.status()).toBe(400);
  expect(((await bad.json()) as { issues: string[] }).issues.join(" ")).toMatch(/https/);

  await page.goto("/integrations");
  const card = page.getByTestId("integration-mqtt");
  await expect(card.getByText("Not configured", { exact: true })).toBeVisible();
  await page.getByTestId("configure-mqtt").click();
  await card.getByLabel("Broker URL").fill("mqtts://broker.example.com:8883");
  await page.getByTestId("save-mqtt").click();
  await expect(card.getByText("Configured · not yet verified")).toBeVisible();
  await expect(card.getByText("set here").first()).toBeVisible();

  // The AI card shows the Meta Model API settings
  await page.getByTestId("configure-meta-ai").click();
  const ai = page.getByTestId("settings-form-meta-ai");
  await expect(ai.getByLabel("Meta Model API key")).toBeVisible();
  await expect(ai.getByLabel("Agent model")).toBeVisible();
  await expect(ai.getByLabel("Reasoning model")).toBeVisible();
  await ai.getByRole("button", { name: "Cancel" }).click();

  const reset = await request.put("/api/integrations/settings", { data: { values: { MQTT_BROKER_URL: null } } });
  expect(reset.ok()).toBeTruthy();
  const after = (await reset.json()) as { integrations: { id: string; state: string }[] };
  expect(after.integrations.find((i) => i.id === "mqtt")!.state).toBe("not-configured");
});

test("Intelligence Backend page: live backend data, or clear guidance when the Python service is down; proxy is allow-listed", async ({ page, request }) => {
  const blocked = await request.get("/api/backend/etc/passwd");
  expect(blocked.status()).toBe(404);
  const ready = await request.get("/api/backend/ready");
  await page.goto("/intelligence", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Intelligence Backend" })).toBeVisible();
  if (ready.ok() && (await ready.json()).status === "READY") {
    await expect(page.getByText("Data model (SQLite)")).toBeVisible();
    await page.getByRole("tab", { name: /Configuration/ }).click();
    await expect(page.getByText("Change history")).toBeVisible();
  } else {
    await expect(page.getByText("The intelligence backend isn't reachable")).toBeVisible();
  }
});

test("browser preferences are stored on the server per client", async ({ request }) => {
  const put = await request.put("/api/prefs/e2e-check", { data: { value: { hello: "twin" } } });
  expect(put.ok()).toBeTruthy();
  const got = (await (await request.get("/api/prefs/e2e-check")).json()) as { value: { hello: string } };
  expect(got.value.hello).toBe("twin");
  expect((await request.put("/api/prefs/Bad Name", { data: { value: 1 } })).status()).toBe(400);
  await request.delete("/api/prefs/e2e-check");
});

test("intelligence features: off by default, admin turns one on, its analytics page and agent evidence follow", async ({ page, request }) => {
  const list = (await (await request.get("/api/intelligence")).json()) as { features: { id: string; enabled: boolean }[] };
  for (const f of list.features) expect(f.enabled).toBe(false);
  const off = await request.get("/api/intelligence/maintenance/analytics");
  expect(off.ok()).toBeTruthy();
  expect(((await off.json()) as { enabled: boolean }).enabled).toBe(false);
  await page.goto("/analytics/maintenance", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Predictive maintenance is off")).toBeVisible();

  const ready = await request.get("/api/backend/ready");
  test.skip(!ready.ok(), "Needs the Python intelligence backend");
  try {
    const on = await request.put("/api/intelligence", { data: { feature: "maintenance", enabled: true } });
    expect(on.ok()).toBeTruthy();
    expect(((await on.json()) as { sync: { ok: boolean } }).sync.ok).toBe(true);
    await page.goto("/features", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("switch", { name: "Predictive maintenance on or off" })).toBeChecked();
    await page.goto("/analytics/maintenance", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Hours to trip" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All machines" })).toBeVisible();
    // The backend's result reaches the maintenance agent as a separately sourced finding.
    const events = (await (await request.post("/api/agents/analyze?fast=1")).text()).trim().split("\n").map((l) => JSON.parse(l));
    const maint = events.find((e) => e.type === "agent" && e.agentId === "maintenance" && e.status === "complete");
    expect(maint.report.findings.some((f: { id: string }) => f.id === "xb-maint")).toBe(true);
  } finally {
    await request.put("/api/intelligence", { data: { feature: "maintenance", enabled: false } });
  }
});

test("Plant-Private AI: Blueprint to Twin page runs on the open-weight model only, and says clearly when it is not configured", async ({ page, request }) => {
  const status = (await (await request.get("/api/private-ai")).json()) as { configured: boolean; provider: string; model: string };
  expect(status.provider).toBe("Baseten");
  expect(status.model).toMatch(/muse-spark-open/);
  await page.goto("/private-ai", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Blueprint to Twin · Plant-Private AI" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Blueprint to Twin" })).toBeVisible();
  if (!status.configured) {
    await expect(page.getByText("not configured: set BASETEN_API_KEY in .env")).toBeVisible();
    const res = await request.post("/api/private-ai/blueprint", { multipart: { requirements: "test" } });
    expect(res.status()).toBe(503);
  }
});
