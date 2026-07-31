import { createClient } from "@supabase/supabase-js";
import { test, expect } from "@playwright/test";

// test-plan.md risk #7: a profile reset could delete nothing (silent DB failure) or delete the
// row but fail to land the user on a blank onboarding form. Proving that needs a real Supabase
// deletion check, not a mocked one - a unit/integration layer can only prove the code calls the
// RPC (src/pages/api/profile/reset.test.ts, src/lib/services/profile.test.ts already do that).
//
// This spec seeds its own isolated user rather than reusing tests/e2e/fixtures/seed.ts's shared
// TEST_USER_EMAIL: actually deleting that profile would strand workout-session.spec.ts and
// progress-indicator.spec.ts at /onboarding, since they depend on it existing (playwright.config.ts
// forces workers: 1 / serial execution for exactly this kind of shared-state reason).
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;

const TEST_EMAIL = "e2e-profile-reset@flowfit.test";
const TEST_PASSWORD = "e2e-test-password-123";

function createAdminClient() {
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      "E2E_SUPABASE_SERVICE_ROLE_KEY is not set. Run `supabase start` then `supabase status -o env` " +
        "against your local instance and export SERVICE_ROLE_KEY (and API_URL as E2E_SUPABASE_URL) " +
        "before running the E2E suite.",
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let userId: string;

test.beforeAll(async () => {
  const admin = createAdminClient();

  const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = existingUsers.users.find((u) => u.email === TEST_EMAIL);
  if (existing) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(existing.id);
    if (deleteError) throw deleteError;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (createError) throw createError;
  userId = created.user.id;

  const { error: profileError } = await admin.from("user_profiles").insert({
    id: userId,
    training_goal: "general_fitness",
    experience_level: "beginner",
    equipment: ["bodyweight"],
    preferred_style: "full_body",
    sessions_per_week: 3,
  });
  if (profileError) throw profileError;

  // Sign-in redirects to /dashboard before this spec ever reaches /onboarding. Without an active
  // plan, dashboard.astro renders PlanGenerator (client:load), which auto-fires a real POST
  // /api/plan on mount - a live Gemini call with no bearing on this risk. Seeding a workout +
  // user_plan row (no workout_exercises needed - only length > 0 matters) makes dashboard render
  // PlanDisplay instead, so this spec never triggers that side effect.
  const { data: workout, error: workoutError } = await admin
    .from("workouts")
    .insert({ user_id: userId, name: "E2E Profile Reset Workout", source: "custom" })
    .select("id")
    .single();
  if (workoutError) throw workoutError;

  const { error: planError } = await admin.from("user_plan").insert({
    user_id: userId,
    workout_id: workout.id,
    position: 1,
  });
  if (planError) throw planError;
});

test.afterAll(async () => {
  // The reset flow itself deletes the user_profiles row - this only needs to clean up the auth
  // user (and anything else FK-cascaded to it) so a re-run of this spec starts from a clean slate.
  if (userId) {
    const admin = createAdminClient();
    await admin.auth.admin.deleteUser(userId);
  }
});

test("resetting a profile deletes it in Supabase and redirects to a blank onboarding form", async ({ page }) => {
  await page.goto("/auth/signin");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email", { exact: true }).fill(TEST_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Your training profile" })).toBeVisible();

  // ProfileSummary is a client:load React island - its onClick handlers aren't attached until
  // hydration finishes, so a click issued right after goto() lands on inert SSR'd markup and
  // silently does nothing (same gotcha documented in workout-session.spec.ts).
  await page.waitForLoadState("networkidle");

  // Two "Reset profile" buttons share the same accessible name: the dialog trigger (rendered
  // now) and the destructive submit button inside DialogContent (not mounted until opened). Only
  // the trigger exists yet, so this role query is unambiguous.
  await page.getByRole("button", { name: "Reset profile" }).click();

  const dialog = page.getByRole("dialog", { name: "Reset your training profile?" });
  await expect(dialog).toBeVisible();
  // Scoping to the dialog disambiguates from the trigger button, which stays mounted underneath.
  await dialog.getByRole("button", { name: "Reset profile" }).click();

  // The reset form is a plain HTML POST (no fetch/JS) - the browser follows the server's redirect
  // natively, so waiting for the URL is enough; no response interception needed.
  await page.waitForURL(/\/onboarding(\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Tell us about your training" })).toBeVisible();

  // The control assertion for this risk: prove the row is actually gone in Supabase, not just
  // that the UI navigated somewhere that looks right.
  const admin = createAdminClient();
  const { data: remainingProfile, error } = await admin
    .from("user_profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  expect(remainingProfile).toBeNull();
});
