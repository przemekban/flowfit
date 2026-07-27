import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

// Local-only Supabase connection details for seeding via the admin API. Read from dedicated
// INTEGRATION_* env vars — never the SUPABASE_URL/SUPABASE_KEY pair the app itself uses — so the
// service-role key can never leak into app code (see AGENTS.md's astro:env/server rule), mirroring
// tests/e2e/fixtures/seed.ts's E2E_* convention.
const SUPABASE_URL = process.env.INTEGRATION_SUPABASE_URL;
const ANON_KEY = process.env.INTEGRATION_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY;

const EMAIL_PREFIX = "integration-two-users";
const PASSWORD = "integration-test-password-123";

export interface TestIdentity {
  id: string;
  sessionId: string;
  client: SupabaseClient;
}

function requireEnv(): { url: string; anonKey: string; serviceRoleKey: string } {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error(
      "INTEGRATION_SUPABASE_URL, INTEGRATION_SUPABASE_ANON_KEY, and INTEGRATION_SUPABASE_SERVICE_ROLE_KEY must " +
        "all be set. Run `supabase start` then `supabase status -o env` against your local instance and export " +
        "API_URL as INTEGRATION_SUPABASE_URL, ANON_KEY as INTEGRATION_SUPABASE_ANON_KEY, and SERVICE_ROLE_KEY as " +
        "INTEGRATION_SUPABASE_SERVICE_ROLE_KEY before running `npm run test:integration`.",
    );
  }
  return { url: SUPABASE_URL, anonKey: ANON_KEY, serviceRoleKey: SERVICE_ROLE_KEY };
}

function emailFor(label: "a" | "b"): string {
  return `${EMAIL_PREFIX}-${label}@flowfit.test`;
}

async function seedUser(admin: SupabaseClient, url: string, anonKey: string, label: "a" | "b"): Promise<TestIdentity> {
  const email = emailFor(label);

  const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = existingUsers.users.find((u) => u.email === email);
  if (existing) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(existing.id);
    if (deleteError) throw deleteError;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createError) throw createError;
  const userId = created.user.id;

  const { data: exercise, error: exerciseError } = (await admin
    .from("exercises")
    .select("id")
    .eq("tracking_type", "reps")
    .limit(1)
    .single()) as { data: { id: string } | null; error: PostgrestError | null };
  if (exerciseError) throw exerciseError;
  if (!exercise) throw new Error("No reps-tracked exercise found to seed the fixture with");

  const { data: workout, error: workoutError } = (await admin
    .from("workouts")
    .insert({ user_id: userId, name: `Integration Workout ${label}`, source: "custom" })
    .select("id")
    .single()) as { data: { id: string } | null; error: PostgrestError | null };
  if (workoutError) throw workoutError;
  if (!workout) throw new Error("Insert succeeded but no workout row was returned");

  const { data: session, error: sessionError } = (await admin
    .from("workout_sessions")
    .insert({ user_id: userId, workout_id: workout.id, status: "active" })
    .select("id")
    .single()) as { data: { id: string } | null; error: PostgrestError | null };
  if (sessionError) throw sessionError;
  if (!session) throw new Error("Insert succeeded but no session row was returned");

  const { error: setError } = await admin.from("workout_sets").insert({
    workout_session_id: session.id,
    exercise_id: exercise.id,
    set_number: 1,
    reps: 10,
    weight_kg: 20,
  });
  if (setError) throw setError;

  const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;

  return { id: userId, sessionId: session.id, client };
}

export async function setupTwoUsers(): Promise<{ userA: TestIdentity; userB: TestIdentity }> {
  const { url, anonKey, serviceRoleKey } = requireEnv();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const userA = await seedUser(admin, url, anonKey, "a");
  const userB = await seedUser(admin, url, anonKey, "b");

  return { userA, userB };
}

export async function teardownTwoUsers(): Promise<void> {
  const { url, serviceRoleKey } = requireEnv();
  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers();
  if (listError) throw listError;

  for (const label of ["a", "b"] as const) {
    const user = existingUsers.users.find((u) => u.email === emailFor(label));
    if (user) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
      if (deleteError) throw deleteError;
    }
  }
}
