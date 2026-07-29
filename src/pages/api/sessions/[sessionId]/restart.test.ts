import { describe, expect, it, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import type { Exercise, Workout, WorkoutExercise, WorkoutSession, WorkoutSet, WorkoutWithExercises } from "@/types";
import { createClient } from "@/lib/supabase";
import {
  loadOwnedSession,
  restartSession,
  getWorkoutWithExercises,
  getSessionWithSets,
  getLastLoggedSets,
} from "@/lib/services/session";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/session", () => ({
  loadOwnedSession: vi.fn(),
  getSessionOwnership: vi.fn(),
  restartSession: vi.fn(),
  getWorkoutWithExercises: vi.fn(),
  getSessionWithSets: vi.fn(),
  getLastLoggedSets: vi.fn(),
}));

const { POST } = await import("./restart");

function buildContext(overrides: { user: APIContext["locals"]["user"]; sessionId: string }): APIContext {
  return {
    locals: { user: overrides.user },
    params: { sessionId: overrides.sessionId },
    request: new Request("http://test"),
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

describe("POST /api/sessions/[sessionId]/restart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    const context = buildContext({ user: null, sessionId: "11111111-1111-4111-a111-111111111111" });

    const response = await POST(context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns 400 when sessionId is not a UUID", async () => {
    const context = buildContext({
      user: { id: "user-1" } as APIContext["locals"]["user"],
      sessionId: "not-a-uuid",
    });

    const response = await POST(context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "validation_error" });
  });

  it("restarts the session on successful authenticated request", async () => {
    const context = buildContext({
      user: { id: "user-1" } as APIContext["locals"]["user"],
      sessionId: "11111111-1111-4111-a111-111111111111",
    });
    const existingSession: WorkoutSession = {
      id: "session-old",
      user_id: "user-1",
      workout_id: "workout-1",
      status: "active",
      started_at: "2026-07-19T00:00:00.000Z",
      completed_at: null,
    };
    const workout: Workout = {
      id: "workout-1",
      user_id: "user-1",
      name: "Push Day",
      description: null,
      source: "custom",
      template_id: null,
      is_archived: false,
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
    };
    const exercise: Exercise = {
      id: "ex-1",
      name: "Bench Press",
      muscle_group: "chest",
      difficulty: "beginner",
      equipment: "barbell",
      tracking_type: "reps",
      created_at: "2026-07-01T00:00:00.000Z",
      description: null,
      instructions: null,
      muscles_primary: null,
      muscles_secondary: null,
      tips: null,
      common_mistakes: null,
    };
    const workoutExercise: WorkoutExercise = {
      id: "we-1",
      workout_id: "workout-1",
      exercise_id: "ex-1",
      position: 1,
      target_sets: 3,
      target_reps: 10,
      target_duration_seconds: null,
    };
    const workoutWithExercises: WorkoutWithExercises = {
      ...workout,
      exercises: [{ ...workoutExercise, exercise }],
    };
    const newSession = {
      id: "session-new",
      user_id: "user-1",
      workout_id: "workout-1",
      status: "active" as const,
      started_at: "2026-07-20T00:00:00.000Z",
      completed_at: null,
      workout,
      sets: [] as (WorkoutSet & { exercise: Exercise })[],
    };
    const lastLoggedSet: WorkoutSet = {
      id: "set-1",
      workout_session_id: "session-old",
      exercise_id: "ex-1",
      set_number: 1,
      reps: 10,
      weight_kg: 40,
      duration_seconds: null,
      notes: null,
      logged_at: "2026-07-19T00:30:00.000Z",
    };
    vi.mocked(createClient).mockReturnValue({} as never);
    vi.mocked(loadOwnedSession).mockResolvedValue(existingSession);
    vi.mocked(restartSession).mockResolvedValue("session-new");
    vi.mocked(getWorkoutWithExercises).mockResolvedValue(workoutWithExercises);
    vi.mocked(getSessionWithSets).mockResolvedValue(newSession);
    vi.mocked(getLastLoggedSets).mockResolvedValue({ "ex-1": lastLoggedSet });

    const response = await POST(context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session: newSession,
      lastLoggedSets: { "ex-1": lastLoggedSet },
    });
    expect(restartSession).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      "11111111-1111-4111-a111-111111111111",
      "workout-1",
    );
  });
});
