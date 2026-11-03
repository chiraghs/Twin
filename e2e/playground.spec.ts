import { expect, test, type Page } from "@playwright/test";

/** The playground: a sandbox draft edited on a floor plan, with rules, applied to the live twin on request. */

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

const counts = (page: Page) => page.getByText(/\d+ lines · \d+ machines/);

test.beforeEach(async ({ request, page }) => {
  expect((await request.post("/api/factory/reset")).ok()).toBeTruthy();
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("pg-e2e")) {
        localStorage.removeItem("twin-playground");
        sessionStorage.setItem("pg-e2e", "1");
      }
    } catch {
      /* storage blocked */
    }
  });
});

test.afterAll(async ({ request }) => {
  await request.post("/api/factory/reset");
});

test("place, connect, delete and undo on the floor; add rules; apply to the twin", async ({ page, request }) => {
  const errors = collectErrors(page);
  await page.goto("/playground", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Playground" })).toBeVisible();
  const svg = page.getByTestId("pg-svg");
  await expect(svg).toBeVisible();
  await expect(counts(page)).toContainText("3 lines · 12 machines · 3 robots · 0 rules");

  // Drag a machine from the palette into empty floor: it starts a new line and is selected.
  const box = (await svg.boundingBox())!;
  await page.getByTestId("pg-palette-cnc").dragTo(svg, { targetPosition: { x: box.width * 0.45, y: box.height * 0.92 } });
  await expect(counts(page)).toContainText("4 lines · 13 machines");
  await expect(page.getByTestId("pg-inspector")).toContainText("CNC");

  // Delete the selection with the keyboard, then undo.
  await page.keyboard.press("Delete");
  await expect(counts(page)).toContainText("3 lines · 12 machines");
  await page.keyboard.press("Control+z");
  await expect(counts(page)).toContainText("4 lines · 13 machines");

  // Connect: drag from the end of Assembly Line A to the new CNC; the new line is absorbed.
  const machines = page.locator('[data-testid^="pg-machine-"]');
  const aoi = machines.nth(3);
  await aoi.click();
  const port = page.locator('[data-testid^="pg-port-"]').first();
  const cnc = page.getByTestId("pg-machine-line-4-cnc");
  const pb = (await port.boundingBox())!;
  const cb = (await cnc.boundingBox())!;
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(counts(page)).toContainText("3 lines · 13 machines");

  // Rules: a connector action and an inventory trigger.
  await page.getByRole("tab", { name: "Rules" }).click();
  await page.getByTestId("pg-add-connector").click();
  await page.getByTestId("pg-save-rule").click();
  await page.getByTestId("pg-add-inventory").click();
  await page.getByTestId("pg-save-rule").click();
  await expect(page.getByTestId("pg-rule")).toHaveCount(2);
  await expect(counts(page)).toContainText("2 rules");

  // Apply: the live twin is rebuilt with the layout and the rules.
  await page.getByTestId("pg-apply").click();
  await page.getByTestId("pg-apply-confirm").click();
  await expect(page).toHaveURL(/\/twin/);
  const state = await (await request.get("/api/factory")).json();
  expect(state.rules).toHaveLength(2);
  expect(state.assets).toHaveLength(13);
  expect(Object.keys(state.layout ?? {})).toHaveLength(13);
  expect(state.profile.isDemo).toBe(false);
  expect(errors).toEqual([]);
});
