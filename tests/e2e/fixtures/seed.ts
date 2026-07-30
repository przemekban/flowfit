import { createClient } from "@supabase/supabase-js";

// Local-only Supabase connection details for seeding via the admin API. These are read from
// dedicated E2E_* env vars — never the SUPABASE_URL/SUPABASE_KEY pair the app itself uses — so
// the service-role key can never leak into app code (see AGENTS.md's astro:env/server rule).
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;

export const TEST_USER_EMAIL = "e2e-workout-session@flowfit.test";
export const TEST_USER_PASSWORD = "e2e-test-password-123";
export const TEST_WORKOUT_NAME = "E2E Seeded Workout";
export const PROGRESS_WORKOUT_NAME = "E2E Progress Workout";
export const PROGRESS_WORKOUT_PRIOR_BEST_WEIGHT_KG = 20;

export default async function globalSetup(): Promise<void> {
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      "E2E_SUPABASE_SERVICE_ROLE_KEY is not set. Run `supabase start` then `supabase status -o env` " +
        "against your local instance and export SERVICE_ROLE_KEY (and API_URL as E2E_SUPABASE_URL) " +
        "before running the E2E suite.",
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Idempotent: wipe any leftover user from a prior local run (cascades to their workouts,
  // profile, sessions, and plan via ON DELETE CASCADE) before seeding fresh.
  const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = existingUsers.users.find((u) => u.email === TEST_USER_EMAIL);
  if (existing) {
    const { error: deleteError } = await supabase.auth.admin.deleteUser(existing.id);
    if (deleteError) throw deleteError;
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD,
    email_confirm: true,
  });
  if (createError) throw createError;
  const userId = created.user.id;

  const { error: profileError } = await supabase.from("user_profiles").insert({
    id: userId,
    training_goal: "general_fitness",
    experience_level: "beginner",
    equipment: ["bodyweight"],
    preferred_style: "full_body",
    sessions_per_week: 3,
  });
  if (profileError) throw profileError;

  const { data: exercise, error: exerciseError } = await supabase
    .from("exercises")
    .select("id")
    .eq("tracking_type", "reps")
    .limit(1)
    .single();
  if (exerciseError) throw exerciseError;

  const { data: workout, error: workoutError } = await supabase
    .from("workouts")
    .insert({ user_id: userId, name: TEST_WORKOUT_NAME, source: "custom" })
    .select("id")
    .single();
  if (workoutError) throw workoutError;

  const { error: workoutExerciseError } = await supabase.from("workout_exercises").insert({
    workout_id: workout.id,
    exercise_id: exercise.id,
    position: 1,
    target_sets: 3,
    target_reps: 10,
  });
  if (workoutExerciseError) throw workoutExerciseError;

  const { error: planError } = await supabase.from("user_plan").insert({
    user_id: userId,
    workout_id: workout.id,
    position: 1,
  });
  if (planError) throw planError;

  // A second, independent workout for the progress-indicator spec, so it doesn't depend on run
  // order relative to the other two specs' shared workout/session (playwright.config.ts:6-13).
  const { data: progressWorkout, error: progressWorkoutError } = await supabase
    .from("workouts")
    .insert({ user_id: userId, name: PROGRESS_WORKOUT_NAME, source: "custom" })
    .select("id")
    .single();
  if (progressWorkoutError) throw progressWorkoutError;

  const { error: progressWorkoutExerciseError } = await supabase.from("workout_exercises").insert({
    workout_id: progressWorkout.id,
    exercise_id: exercise.id,
    position: 1,
    target_sets: 3,
    target_reps: 10,
  });
  if (progressWorkoutExerciseError) throw progressWorkoutExerciseError;

  const { error: progressPlanError } = await supabase.from("user_plan").insert({
    user_id: userId,
    workout_id: progressWorkout.id,
    position: 2,
  });
  if (progressPlanError) throw progressPlanError;

  const { data: priorSession, error: priorSessionError } = await supabase
    .from("workout_sessions")
    .insert({
      user_id: userId,
      workout_id: progressWorkout.id,
      status: "completed",
      started_at: "2026-07-01T08:00:00.000Z",
      completed_at: "2026-07-01T08:30:00.000Z",
    })
    .select("id")
    .single();
  if (priorSessionError) throw priorSessionError;

  const { error: priorSetError } = await supabase.from("workout_sets").insert({
    workout_session_id: priorSession.id,
    exercise_id: exercise.id,
    set_number: 1,
    reps: 10,
    weight_kg: PROGRESS_WORKOUT_PRIOR_BEST_WEIGHT_KG,
  });
  if (priorSetError) throw priorSetError;
}
