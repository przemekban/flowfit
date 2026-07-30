import { test, expect } from "@playwright/test";
import { TEST_USER_EMAIL, TEST_USER_PASSWORD, TEST_WORKOUT_NAME } from "./fixtures/seed";

test("autosave failure after retries exhaust preserves the typed value and shows the failure banner", async ({
  page,
}) => {
  await page.goto("/auth/signin");
  // SignInForm is a client:load React island with controlled inputs — filling before hydration
  // attaches its onChange handlers sets the DOM value only; the subsequent hydration re-render
  // then resets the input to its (still-empty) React state, silently discarding the typed value.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email", { exact: true }).fill(TEST_USER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(TEST_USER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Scoped by workout name since the fixture now seeds a second workout (for the progress-indicator
  // spec), so a bare "Start workout" locator would be ambiguous.
  await page
    .locator("div.rounded-2xl", { hasText: TEST_WORKOUT_NAME })
    .getByRole("link", { name: "Start workout" })
    .click();
  await expect(page).toHaveURL(/\/session\//);
  await page.waitForLoadState("networkidle");

  // Registered before any input is filled so every save attempt (initial + all retries) fails.
  await page.route("**/sets", (route) => {
    if (route.request().method() === "PUT" || route.request().method() === "POST") {
      return route.fulfill({ status: 500, body: JSON.stringify({ error: "db_error" }) });
    }
    return route.continue();
  });

  const setOneRow = page.locator("div.grid", { hasText: "Set 1 · Reps" });
  await expect(setOneRow).toBeVisible();
  await setOneRow.getByLabel("Set 1 · Reps").fill("10");
  await setOneRow.getByLabel("Weight (kg)").fill("20");

  // Real wall-clock wait: 600ms debounce + 500/1000/2000ms exponential backoff across 3 retries
  // (~4-5s total) before the row gives up and signals failure. Not a flake — the browser's real
  // setTimeout is what's under test, so timers are not faked here.
  await expect(
    page.getByText("Some sets couldn't be saved after several attempts. Your entered values are still shown."),
  ).toBeVisible({ timeout: 10_000 });

  await expect(setOneRow.getByLabel("Set 1 · Reps")).toHaveValue("10");
  await expect(setOneRow.getByLabel("Weight (kg)")).toHaveValue("20");

  // Finish the workout so this session doesn't linger as "active" for the next spec — /complete
  // isn't covered by the /sets route interceptor above, so this hits the real endpoint.
  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page).toHaveURL(/\/history/);
});
