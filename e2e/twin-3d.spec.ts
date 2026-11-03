import { expect, test } from "@playwright/test";

// Software WebGL for headless runs. Kept in its own file (its own browser) because it slows every page.
test.use({ launchOptions: { ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

test.beforeEach(async ({ request }) => {
  expect((await request.post("/api/factory/reset")).ok()).toBeTruthy();
});

test("3D twin view: orbitable scene with mobile robots and layer toggles", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/twin");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator('[data-testid="twin-3d"] canvas')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("amr-legend")).toContainText("Mobile robots · 3 of 3 active");
  // Labels come from the plant model: the assembly robot with a warning is labelled
  await expect(page.locator('[data-testid="twin-3d"]').getByText("A-ROB-03")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Mobile robots" }).click();
  await expect(page.getByTestId("amr-legend")).toHaveCount(0);
  await page.getByRole("button", { name: "Mobile robots" }).click();
  await expect(page.getByTestId("amr-legend")).toBeVisible();
  await page.getByRole("button", { name: "Top view" }).click();
  expect(errors).toEqual([]);
});
