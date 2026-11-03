import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("phones see a full-page 'best on a computer' notice and can continue to the demo", async ({ page, context }) => {
  await page.goto("/dashboard");
  const notice = page.getByTestId("mobile-notice");
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("heading", { name: "Twin is best viewed on a computer" })).toBeVisible();
  await page.getByTestId("mobile-continue").click();
  await expect(notice).toBeHidden();
  await expect(page.getByRole("heading", { name: "Factory Command Center" })).toBeVisible();
  // The choice holds for the rest of the session, across pages and reloads
  await page.goto("/twin");
  await expect(page.getByTestId("mobile-notice")).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("mobile-notice")).toBeHidden();
  // A new session asks again
  const fresh = await context.newPage();
  await fresh.goto("/onboarding");
  await expect(fresh.getByTestId("mobile-notice")).toBeVisible();
});
