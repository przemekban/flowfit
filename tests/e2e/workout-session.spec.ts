import { test, expect } from "@playwright/test";
import { TEST_USER_EMAIL, TEST_USER_PASSWORD } from "./fixtures/seed";

test("launch, log a set, resume after reload, and finish a workout session", async ({ page }) => {
  await page.goto("/auth/signin");
  // SignInForm is a client:load React island with controlled inputs — filling before hydration
  // attaches its onChange handlers sets the DOM value only; the subsequent hydration re-render
  // then resets the input to its (still-empty) React state, silently discarding the typed value.
  // Wait for the client bundle to finish loading first, mirroring the same convention used below
  // for the session page's SessionLogger island.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email", { exact: true }).fill(TEST_USER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(TEST_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // First launch: no active session exists yet, so this must land directly in the logger
  // with zero intermediate screens.
  await page.getByRole("link", { name: "Start workout" }).click();
  await expect(page).toHaveURL(/\/session\//);

  // The session island (SessionLogger/SetRow) hydrates after the initial HTML paints; typing
  // before hydration attaches its listeners lands the fill in the DOM but never reaches React
  // state, so the debounced autosave never fires. Wait for the client bundle to finish loading.
  await page.waitForLoadState("networkidle");

  const setOneRow = page.locator("div.grid", { hasText: "Set 1 · Reps" });
  await expect(setOneRow).toBeVisible();
  await setOneRow.getByLabel("Set 1 · Reps").fill("10");
  await setOneRow.getByLabel("Weight (kg)").fill("20");

  // No explicit save action exists (silent autosave) — wait for the actual PUT to land before
  // reloading, rather than guessing at a fixed delay.
  await page.waitForResponse((res) => res.url().includes("/sets") && res.request().method() === "PUT");
  await page.reload();
  await page.waitForLoadState("networkidle");

  // Reloading a workout with an active session always defers to the resume/restart choice
  // (the SSR get-or-create logic can't distinguish "same tab, reloaded" from "returned later") —
  // the logged-set count in the modal's copy is what proves the earlier autosave persisted.
  await expect(page.getByText("with 1 set logged")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();

  const resumedRow = page.locator("div.grid", { hasText: "Set 1 · Reps" });
  await expect(resumedRow.getByLabel("Set 1 · Reps")).toHaveValue("10");
  await expect(resumedRow.getByLabel("Weight (kg)")).toHaveValue("20");

  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});
