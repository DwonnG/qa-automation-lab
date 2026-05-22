import { defineConfig, devices } from "@playwright/test";

import { HEALTH_URL } from "./lib/paths";

const PORT = Number(process.env.PORT ?? 5050);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 2 : 0,
  // Serial workers: the auth fixture resets the shared backend store, so parallel
  // workers race each other's data. Per-worker isolation is a future enhancement.
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "playwright-report/results.xml" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "Mobile Safari", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: "uv run uvicorn demo_app.main:app --port " + PORT,
    cwd: "../demo-app",
    url: `${BASE_URL}${HEALTH_URL}`,
    reuseExistingServer: !IS_CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    env: { APP_ENV: "test" },
  },
});
