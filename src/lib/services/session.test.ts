import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkoutSession, WorkoutSet } from "@/types";
import { createSession, deleteSet, getLastLoggedSets, restartSession, upsertSet } from "./session";

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
    const loggedSet: WorkoutSet & { workout_sessions: { user_id: string } } = {
      id: "set-1",
      workout_session_id: "session-old",
      exercise_id: "exercise-1",
      set_number: 1,
      reps: 8,
      weight_kg: 60,
      duration_seconds: null,
      notes: null,
      logged_at: "2026-07-19T00:00:00.000Z",
      workout_sessions: { user_id: "user-1" },
    };
    const builder = createQueryBuilder({ data: [loggedSet], error: null });
    const supabase = { from: vi.fn(() => builder) } as unknown as SupabaseClient;

    const result = await getLastLoggedSets(supabase, "user-1", ["exercise-1", "exercise-2"], "session-current");

    const { workout_sessions: _workoutSessions, ...expectedSet } = loggedSet;
    expect(result["exercise-1"]).toEqual(expectedSet);
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
