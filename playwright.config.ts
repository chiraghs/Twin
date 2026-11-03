import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3000);
/** Set E2E_BASE_URL to test a deployed instance (e.g. Firebase App Hosting) instead of a local server. */
const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: REMOTE
    ? undefined
    : {
        command: `PORT=${PORT} npm start`,
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
