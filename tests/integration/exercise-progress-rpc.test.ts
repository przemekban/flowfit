import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { seedSession, seedSet, setupTwoUsers, teardownTwoUsers, type TestIdentity } from "./fixtures/two-users";

interface PreviousExerciseBestRow {
  exercise_id: string;
  best_weight_kg: number | null;
  best_duration_seconds: number | null;
}

async function callRpc(
  client: SupabaseClient,
  exerciseIds: string[],
  beforeSessionId: string,
): Promise<PreviousExerciseBestRow[]> {
  const { data, error } = (await client.rpc("get_previous_exercise_bests", {
    p_exercise_ids: exerciseIds,
    p_before_session_id: beforeSessionId,
  })) as { data: PreviousExerciseBestRow[] | null; error: PostgrestError | null };
  if (error) throw error;
  return data ?? [];
}

describe("get_previous_exercise_bests RPC (S-05)", () => {
  let userA: TestIdentity;
  let userB: TestIdentity;
  let admin: SupabaseClient;
  let durationExerciseId: string;

  beforeAll(async () => {
    ({ userA, userB, admin } = await setupTwoUsers());

    const { data: durationExercise, error: durationExerciseError } = (await admin
      .from("exercises")
      .select("id")
      .eq("tracking_type", "duration")
      .limit(1)
      .single()) as { data: { id: string } | null; error: PostgrestError | null };
    if (durationExerciseError) throw durationExerciseError;
    if (!durationExercise) throw new Error("No duration-tracked exercise found to seed the fixture with");
    durationExerciseId = durationExercise.id;
  }, 30_000);

  afterAll(async () => {
    await teardownTwoUsers();
  }, 30_000);

  it("returns the previous session's best weight for a reps-tracked exercise", async () => {
    const priorSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "completed",
      startedAt: "2026-07-01T08:00:00.000Z",
      completedAt: "2026-07-01T08:30:00.000Z",
    });
    await seedSet(admin, { sessionId: priorSessionId, exerciseId: userA.exerciseId, setNumber: 1, weightKg: 50 });
    await seedSet(admin, { sessionId: priorSessionId, exerciseId: userA.exerciseId, setNumber: 2, weightKg: 55 });

    // userA.sessionId is the still-'active' session seedUser() creates — a real prior-session
    // exclusion target, and a no-op one since 'active' never matches status IN ('completed','abandoned').
    const rows = await callRpc(userA.client, [userA.exerciseId], userA.sessionId);

    expect(rows).toEqual([
      expect.objectContaining({ exercise_id: userA.exerciseId, best_weight_kg: 55, best_duration_seconds: null }),
    ]);
  });

  it("returns nothing for an exercise with no prior completed/abandoned session", async () => {
    const rows = await callRpc(userA.client, [durationExerciseId], userA.sessionId);

    expect(rows.find((r) => r.exercise_id === durationExerciseId)).toBeUndefined();
  });

  it("excludes the p_before_session_id session from consideration", async () => {
    const priorSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "completed",
      startedAt: "2026-07-04T08:00:00.000Z",
      completedAt: "2026-07-04T08:30:00.000Z",
    });
    await seedSet(admin, { sessionId: priorSessionId, exerciseId: userA.exerciseId, setNumber: 1, weightKg: 60 });

    // A session with a HIGHER weight than the prior session, but excluded via p_before_session_id —
    // must not leak into the result even though it would otherwise win the "most recent" ranking.
    const excludedSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "completed",
      startedAt: "2026-07-05T08:00:00.000Z",
      completedAt: "2026-07-05T08:30:00.000Z",
    });
    await seedSet(admin, { sessionId: excludedSessionId, exerciseId: userA.exerciseId, setNumber: 1, weightKg: 999 });

    const rows = await callRpc(userA.client, [userA.exerciseId], excludedSessionId);

    expect(rows).toEqual([
      expect.objectContaining({ exercise_id: userA.exerciseId, best_weight_kg: 60, best_duration_seconds: null }),
    ]);
  });

  it("picks the most recent of several qualifying prior sessions", async () => {
    const olderSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "completed",
      startedAt: "2026-07-06T08:00:00.000Z",
      completedAt: "2026-07-06T08:30:00.000Z",
    });
    await seedSet(admin, { sessionId: olderSessionId, exerciseId: userA.exerciseId, setNumber: 1, weightKg: 100 });

    const newerSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "completed",
      startedAt: "2026-07-07T08:00:00.000Z",
      completedAt: "2026-07-07T08:30:00.000Z",
    });
    await seedSet(admin, { sessionId: newerSessionId, exerciseId: userA.exerciseId, setNumber: 1, weightKg: 70 });

    const rows = await callRpc(userA.client, [userA.exerciseId], userA.sessionId);

    // Newer session's best (70) wins over the older, larger value (100) — "most recent" beats "biggest".
    expect(rows).toEqual([
      expect.objectContaining({ exercise_id: userA.exerciseId, best_weight_kg: 70, best_duration_seconds: null }),
    ]);
  });

  it("returns best duration for a duration-tracked exercise", async () => {
    const priorSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "completed",
      startedAt: "2026-07-09T08:00:00.000Z",
      completedAt: "2026-07-09T08:30:00.000Z",
    });
    await seedSet(admin, {
      sessionId: priorSessionId,
      exerciseId: durationExerciseId,
      setNumber: 1,
      durationSeconds: 30,
    });
    await seedSet(admin, {
      sessionId: priorSessionId,
      exerciseId: durationExerciseId,
      setNumber: 2,
      durationSeconds: 45,
    });

    const rows = await callRpc(userA.client, [durationExerciseId], userA.sessionId);

    expect(rows).toEqual([
      expect.objectContaining({ exercise_id: durationExerciseId, best_weight_kg: null, best_duration_seconds: 45 }),
    ]);
  });

  it("includes abandoned (not just completed) sessions in the comparison pool", async () => {
    const abandonedSessionId = await seedSession(admin, {
      userId: userA.id,
      workoutId: userA.workoutId,
      status: "abandoned",
      startedAt: "2026-07-11T08:00:00.000Z",
      completedAt: null,
    });
    await seedSet(admin, { sessionId: abandonedSessionId, exerciseId: userA.exerciseId, setNumber: 1, weightKg: 42 });

    const rows = await callRpc(userA.client, [userA.exerciseId], userA.sessionId);

    expect(rows).toEqual([
      expect.objectContaining({ exercise_id: userA.exerciseId, best_weight_kg: 42, best_duration_seconds: null }),
    ]);
  });

  it("only ever reads the calling user's own sessions regardless of the arguments passed", async () => {
    // userA.exerciseId === userB.exerciseId (both fixtures pick "a reps-tracked exercise" from the
    // same shared catalog) — a deliberately extreme value on userB's side would leak into userA's
    // result if the RPC's WHERE clause were scoped by anything other than auth.uid().
    const userBSessionId = await seedSession(admin, {
      userId: userB.id,
      workoutId: userB.workoutId,
      status: "completed",
      startedAt: "2026-07-13T08:00:00.000Z",
      completedAt: "2026-07-13T08:30:00.000Z",
    });
    await seedSet(admin, { sessionId: userBSessionId, exerciseId: userB.exerciseId, setNumber: 1, weightKg: 9999.9 });

    // Call as userA, passing userB's own session id as the exclusion argument — an id userA does
    // not own. The result must reflect only userA's own history (the 42 from the abandoned-session
    // test above), never userB's 9999.9, proving the filter is auth.uid()-scoped, not argument-scoped.
    const rows = await callRpc(userA.client, [userA.exerciseId], userBSessionId);

    expect(rows).toEqual([
      expect.objectContaining({ exercise_id: userA.exerciseId, best_weight_kg: 42, best_duration_seconds: null }),
    ]);
  });
});
