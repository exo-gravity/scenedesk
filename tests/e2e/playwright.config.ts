import { defineConfig, devices } from "@playwright/test";

const runId = process.env.SCENEDESK_E2E_RUN_ID ??
  `${new Date().toISOString().replace(/[^0-9T]/g, "")}-${process.pid}`;
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error("Invalid E2E evidence run ID");

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: `../../output/playwright/${runId}/results`,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    colorScheme: "light",
    // Traces and storageState would include authenticated requests or cookies.
    // Only synthetic-page screenshots are retained; sessions stay in memory.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
});
