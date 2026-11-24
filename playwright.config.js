// @ts-check
import { defineConfig, devices } from "@playwright/test";

// Credentials are never stored in code. Set SAUCE_PASSWORD in your shell before running:
//   PowerShell:  $env:SAUCE_PASSWORD = "<password from the AAQA-1 story>"
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    baseURL: "https://www.saucedemo.com",
    headless: true,
    screenshot: "on",
    trace: "on",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  outputDir: "test-results/artifacts",
});
