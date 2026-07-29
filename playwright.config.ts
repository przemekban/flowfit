import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:4321";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // Every spec signs in as the same globally-seeded TEST_USER against the same single seeded
  // workout (tests/e2e/fixtures/seed.ts) — running spec files across parallel workers races two
  // independent "start workout" flows against that one shared workout/session. Force serial file
  // execution rather than giving each spec its own fixture, since this rollout's cost×signal call
  // is a single north-star flow plus its failure-mode variant, not a suite that needs isolation.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./tests/e2e/fixtures/seed.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
