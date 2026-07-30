import { test, expect } from "@playwright/test";
import {
  PROGRESS_WORKOUT_NAME,
  PROGRESS_WORKOUT_PRIOR_BEST_WEIGHT_KG,
  TEST_USER_EMAIL,
  TEST_USER_PASSWORD,
} from "./fixtures/seed";

test("shows the live Improved badge when a logged set exceeds the prior session's best", async ({ page }) => {
  await page.goto("/auth/signin");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email", { exact: true }).fill(TEST_USER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(TEST_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // This workout is seeded independently of the other two specs' shared workout/session
  // (tests/e2e/fixtures/seed.ts), with its own prior completed session and known best weight.
  await page
    .locator("div.rounded-2xl", { hasText: PROGRESS_WORKOUT_NAME })
    .getByRole("link", { name: "Start workout" })
    .click();
  await expect(page).toHaveURL(/\/session\//);
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("Improved", { exact: true })).not.toBeVisible();

  const setOneRow = page.locator("div.grid", { hasText: "Set 1 · Reps" });
  await expect(setOneRow).toBeVisible();
  await setOneRow.getByLabel("Set 1 · Reps").fill("10");
  await setOneRow.getByLabel("Weight (kg)").fill(String(PROGRESS_WORKOUT_PRIOR_BEST_WEIGHT_KG + 5));

  // No explicit save action exists (silent autosave) — wait for the actual PUT to land before
  // asserting, rather than guessing at a fixed delay.
  await page.waitForResponse((res) => res.url().includes("/sets") && res.request().method() === "PUT");

  // Live update, no page reload: the badge is derived client-side from the just-saved value.
  await expect(page.getByText("Improved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page).toHaveURL(/\/history/);
});
