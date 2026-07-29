import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Exercise, Workout, WorkoutSession, WorkoutSet } from "@/types";
import {
  createSession,
  deleteSet,
  getLastLoggedSets,
  getWorkoutSessionHistory,
  loadOwnedSession,
  restartSession,
  upsertSet,
} from "./session";

interface QueryResult {
  data: unknown;
  error: unknown;
}

interface QueryBuilderMock {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  then: (onFulfilled: (value: QueryResult) => unknown) => Promise<unknown>;
}

function createQueryBuilder(result: QueryResult): QueryBuilderMock {
  const builder = {} as QueryBuilderMock;
  const chain = () => builder;

  builder.select = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.neq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.range = vi.fn(chain);
  builder.insert = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.upsert = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (onFulfilled) => Promise.resolve(result).then(onFulfilled);

  return builder;
}

const existingSession: WorkoutSession = {
  id: "session-1",
  user_id: "user-1",
  workout_id: "workout-1",
  status: "active",
  started_at: "2026-07-20T00:00:00.000Z",
  completed_at: null,
};

describe("upsertSet", () => {
  it("calls .upsert() with the correct onConflict target", async () => {
    const savedSet: WorkoutSet = {
      id: "set-1",
      workout_session_id: "session-1",
      exercise_id: "exercise-1",
      set_number: 1,
      reps: 10,
      weight_kg: 40,
      duration_seconds: null,
      notes: null,
      logged_at: "2026-07-20T00:00:00.000Z",
    };
    const builder = createQueryBuilder({ data: savedSet, error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await upsertSet(supabase, "session-1", {
      exercise_id: "exercise-1",
      set_number: 1,
      reps: 10,
      weight_kg: 40,
    });

    expect(builder.upsert).toHaveBeenCalledWith(
      { workout_session_id: "session-1", exercise_id: "exercise-1", set_number: 1, reps: 10, weight_kg: 40 },
      { onConflict: "workout_session_id,exercise_id,set_number" },
    );
    expect(result).toEqual(savedSet);
  });

  it("rejects with the PostgrestError unchanged when the DB write fails", async () => {
    const dbError = { code: "23514", message: "violates check constraint" };
    const builder = createQueryBuilder({ data: null, error: dbError });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    await expect(
      upsertSet(supabase, "session-1", { exercise_id: "exercise-1", set_number: 1, reps: 10, weight_kg: 40 }),
    ).rejects.toEqual(dbError);
  });
});

describe("deleteSet", () => {
  it("filters by all three key columns and does not throw when zero rows matched", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    await expect(deleteSet(supabase, "session-1", "exercise-1", 2)).resolves.toBeUndefined();

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("workout_session_id", "session-1");
    expect(builder.eq).toHaveBeenCalledWith("exercise_id", "exercise-1");
    expect(builder.eq).toHaveBeenCalledWith("set_number", 2);
  });
});

describe("getLastLoggedSets", () => {
  it("maps rows into an exercise_id -> WorkoutSet record, missing exercises map to null", async () => {
    const loggedSet: WorkoutSet = {
      id: "set-1",
      workout_session_id: "session-old",
      exercise_id: "exercise-1",
      set_number: 1,
      reps: 8,
      weight_kg: 60,
      duration_seconds: null,
      notes: null,
      logged_at: "2026-07-19T00:00:00.000Z",
    };
    const builder = createQueryBuilder({ data: [loggedSet], error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await getLastLoggedSets(supabase, "user-1", ["exercise-1", "exercise-2"], "session-current");

    expect(result["exercise-1"]).toEqual(loggedSet);
    expect(result["exercise-2"]).toBeNull();
  });
});

describe("createSession", () => {
  it("catches a 23505 conflict and falls back to getActiveSessionForWorkout", async () => {
    const conflictError = { code: "23505", message: "duplicate key value violates unique constraint" };
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    const chain = () => builder;
    builder.insert = vi.fn(chain);
    builder.select = vi.fn(chain);
    builder.eq = vi.fn(chain);
    builder.single = vi.fn(() => Promise.resolve({ data: null, error: conflictError }));
    builder.maybeSingle = vi.fn(() => Promise.resolve({ data: existingSession, error: null }));

    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await createSession(supabase, "user-1", "workout-1");

    expect(builder.single).toHaveBeenCalled();
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(result).toEqual(existingSession);
  });
});

describe("loadOwnedSession", () => {
  it("returns the row when the loader's user_id matches the caller", async () => {
    const loader = vi.fn(() => Promise.resolve(existingSession));

    const result = await loadOwnedSession(loader, "user-1");

    expect(result).toEqual(existingSession);
  });

  it("returns null when the loader's user_id does not match the caller", async () => {
    const loader = vi.fn(() => Promise.resolve(existingSession));

    const result = await loadOwnedSession(loader, "user-2");

    expect(result).toBeNull();
  });

  it("returns null when the loader rejects with a PGRST116 not-found error", async () => {
    const notFoundError = Object.assign(new Error("no rows returned"), { code: "PGRST116" });
    const loader = vi.fn(() => Promise.reject(notFoundError));

    const result = await loadOwnedSession(loader, "user-1");

    expect(result).toBeNull();
  });

  it("rethrows any error that is not a PGRST116 PostgrestError", async () => {
    const dbError = Object.assign(new Error("connection reset"), { code: "500" });
    const loader = vi.fn(() => Promise.reject(dbError));

    await expect(loadOwnedSession(loader, "user-1")).rejects.toEqual(dbError);
  });
});

describe("getWorkoutSessionHistory", () => {
  const workout: Workout = {
    id: "workout-1",
    user_id: "user-1",
    name: "Push Day",
    description: null,
    source: "custom",
    template_id: null,
    is_archived: false,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };
  const exercise: Exercise = {
    id: "exercise-1",
    name: "Bench Press",
    muscle_group: "chest",
    difficulty: "beginner",
    equipment: "barbell",
    tracking_type: "reps",
    created_at: "2026-06-01T00:00:00.000Z",
    description: null,
    instructions: null,
    muscles_primary: null,
    muscles_secondary: null,
    tips: null,
    common_mistakes: null,
  };
  function sessionRow(id: string, setNumbers: number[]) {
    return {
      id,
      user_id: "user-1",
      workout_id: "workout-1",
      status: "completed",
      started_at: "2026-06-01T08:00:00.000Z",
      completed_at: "2026-06-01T08:30:00.000Z",
      workouts: workout,
      workout_sets: setNumbers.map((set_number) => ({
        id: `set-${id}-${set_number}`,
        workout_session_id: id,
        exercise_id: "exercise-1",
        set_number,
        reps: 10,
        weight_kg: 40,
        duration_seconds: null,
        notes: null,
        logged_at: "2026-06-01T08:05:00.000Z",
        exercises: exercise,
      })),
    };
  }

  it("filters by user_id and completed/abandoned status, orders started_at desc and nested set_number asc, and ranges by limit+1", async () => {
    const builder = createQueryBuilder({ data: [], error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    await getWorkoutSessionHistory(supabase, "user-1", 10, 0);

    expect(builder.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(builder.in).toHaveBeenCalledWith("status", ["completed", "abandoned"]);
    expect(builder.order).toHaveBeenCalledWith("started_at", { ascending: false });
    expect(builder.order).toHaveBeenCalledWith("set_number", { referencedTable: "workout_sets", ascending: true });
    expect(builder.range).toHaveBeenCalledWith(0, 10);
  });

  it("sets hasMore=true and trims the extra row when more rows than the limit come back", async () => {
    const rows = [sessionRow("session-1", [1]), sessionRow("session-2", [1]), sessionRow("session-3", [1])];
    const builder = createQueryBuilder({ data: rows, error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await getWorkoutSessionHistory(supabase, "user-1", 2, 0);

    expect(result.hasMore).toBe(true);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions.map((s) => s.id)).toEqual(["session-1", "session-2"]);
  });

  it("sets hasMore=false when returned rows do not exceed the limit", async () => {
    const rows = [sessionRow("session-1", [1])];
    const builder = createQueryBuilder({ data: rows, error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await getWorkoutSessionHistory(supabase, "user-1", 10, 0);

    expect(result.hasMore).toBe(false);
    expect(result.sessions).toHaveLength(1);
  });

  it("maps workouts -> workout and workout_sets(with nested exercises) -> sets", async () => {
    const rows = [sessionRow("session-1", [1])];
    const builder = createQueryBuilder({ data: rows, error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await getWorkoutSessionHistory(supabase, "user-1", 10, 0);

    const [session] = result.sessions;
    expect(session.workout).toEqual(workout);
    expect(session.sets).toEqual([expect.objectContaining({ set_number: 1, exercise_id: "exercise-1", exercise })]);
    expect(session).not.toHaveProperty("workouts");
    expect(session).not.toHaveProperty("workout_sets");
  });

  it("returns an empty sessions array and hasMore=false when no rows are returned", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await getWorkoutSessionHistory(supabase, "user-1", 10, 0);

    expect(result).toEqual({ sessions: [], hasMore: false });
  });
});

describe("restartSession", () => {
  it("calls .rpc('restart_workout_session', ...) with the three expected params and returns the new id", async () => {
    const rpcMock = vi.fn(() => Promise.resolve({ data: "session-2", error: null }));
    const supabase = { rpc: rpcMock } as unknown as SupabaseClient;

    const result = await restartSession(supabase, "user-1", "session-1", "workout-1");

    expect(rpcMock).toHaveBeenCalledWith("restart_workout_session", {
      p_user_id: "user-1",
      p_existing_session_id: "session-1",
      p_workout_id: "workout-1",
    });
    expect(result).toBe("session-2");
  });
});
