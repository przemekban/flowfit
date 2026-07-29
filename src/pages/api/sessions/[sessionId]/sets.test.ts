import { describe, expect, it, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import type { WorkoutSession, WorkoutSet, WorkoutWithExercises } from "@/types";

const getSessionOwnershipMock = vi.fn();
const getWorkoutWithExercisesMock = vi.fn();
const upsertSetMock = vi.fn();
const deleteSetMock = vi.fn();

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/services/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/services/session")>();
  return {
    ...actual,
    getSessionOwnership: getSessionOwnershipMock,
    getWorkoutWithExercises: getWorkoutWithExercisesMock,
    upsertSet: upsertSetMock,
    deleteSet: deleteSetMock,
  };
});

const { PUT, DELETE } = await import("./sets");

const SESSION_ID = "11111111-1111-4111-a111-111111111111";
const EXERCISE_ID = "22222222-2222-4222-a222-222222222222";
const OTHER_EXERCISE_ID = "33333333-3333-4333-a333-333333333333";
const authedUser = { id: "user-1" } as APIContext["locals"]["user"];

function buildContext(overrides: {
  user: APIContext["locals"]["user"];
  sessionId: string;
  method?: string;
  body?: unknown;
  rawBody?: string;
}): APIContext {
  const requestInit: RequestInit = { method: overrides.method ?? "PUT" };
  if (overrides.rawBody !== undefined) {
    requestInit.body = overrides.rawBody;
  } else if (overrides.body !== undefined) {
    requestInit.body = JSON.stringify(overrides.body);
  }
  return {
    locals: { user: overrides.user },
    params: { sessionId: overrides.sessionId },
    request: new Request("http://test", requestInit),
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

const activeSession: WorkoutSession = {
  id: SESSION_ID,
  user_id: "user-1",
  workout_id: "workout-1",
  status: "active",
  started_at: "2026-07-20T00:00:00.000Z",
  completed_at: null,
};

const inactiveSession: WorkoutSession = { ...activeSession, status: "completed" };
const otherUsersSession: WorkoutSession = { ...activeSession, user_id: "user-2" };

const matchingWorkout: WorkoutWithExercises = {
  id: "workout-1",
  user_id: "user-1",
  name: "Push Day",
  description: null,
  source: "custom",
  template_id: null,
  is_archived: false,
  created_at: "2026-07-01T00:00:00.000Z",
  updated_at: "2026-07-01T00:00:00.000Z",
  exercises: [
    {
      id: "we-1",
      workout_id: "workout-1",
      exercise_id: EXERCISE_ID,
      position: 1,
      target_sets: 3,
      target_reps: 10,
      target_duration_seconds: null,
      exercise: {
        id: EXERCISE_ID,
        name: "Bench Press",
        muscle_group: "chest",
        difficulty: "beginner",
        equipment: "barbell",
        tracking_type: "reps",
        created_at: "2026-01-01T00:00:00.000Z",
        description: null,
        instructions: null,
        muscles_primary: null,
        muscles_secondary: null,
        tips: null,
        common_mistakes: null,
      },
    },
  ],
};

const savedSet: WorkoutSet = {
  id: "set-1",
  workout_session_id: SESSION_ID,
  exercise_id: EXERCISE_ID,
  set_number: 1,
  reps: 10,
  weight_kg: 40,
  duration_seconds: null,
  notes: null,
  logged_at: "2026-07-20T00:00:00.000Z",
};

describe("PUT /api/sessions/[sessionId]/sets", () => {
  beforeEach(() => {
    getSessionOwnershipMock.mockReset();
    getWorkoutWithExercisesMock.mockReset();
    upsertSetMock.mockReset();
    deleteSetMock.mockReset();
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    const context = buildContext({ user: null, sessionId: SESSION_ID });

    const response = await PUT(context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns 400 when sessionId is not a UUID", async () => {
    const context = buildContext({ user: authedUser, sessionId: "not-a-uuid" });

    const response = await PUT(context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "validation_error" });
  });

  it("returns 200 with the saved row on a valid request", async () => {
    getSessionOwnershipMock.mockResolvedValue(activeSession);
    getWorkoutWithExercisesMock.mockResolvedValue(matchingWorkout);
    upsertSetMock.mockResolvedValue(savedSet);
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      body: { exercise_id: EXERCISE_ID, set_number: 1, reps: 10, weight_kg: 40 },
    });

    const response = await PUT(context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(savedSet);
  });

  it("returns 404 not_found when the session is missing or not owned by the caller", async () => {
    getSessionOwnershipMock.mockResolvedValue(otherUsersSession);
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      body: { exercise_id: EXERCISE_ID, set_number: 1, reps: 10, weight_kg: 40 },
    });

    const response = await PUT(context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("returns 409 conflict when the session is not active", async () => {
    getSessionOwnershipMock.mockResolvedValue(inactiveSession);
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      body: { exercise_id: EXERCISE_ID, set_number: 1, reps: 10, weight_kg: 40 },
    });

    const response = await PUT(context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "conflict" });
  });

  it("returns 400 invalid_json on an unparseable body", async () => {
    getSessionOwnershipMock.mockResolvedValue(activeSession);
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      rawBody: "not-json",
    });

    const response = await PUT(context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("returns 400 validation_error when exercise_id is not part of the workout", async () => {
    getSessionOwnershipMock.mockResolvedValue(activeSession);
    getWorkoutWithExercisesMock.mockResolvedValue(matchingWorkout);
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      body: { exercise_id: OTHER_EXERCISE_ID, set_number: 1, reps: 10, weight_kg: 40 },
    });

    const response = await PUT(context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "validation_error" });
  });

  it("returns 400 validation_error when the body fails the tracking-type schema (missing reps for a reps-tracked exercise)", async () => {
    getSessionOwnershipMock.mockResolvedValue(activeSession);
    getWorkoutWithExercisesMock.mockResolvedValue(matchingWorkout);
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      body: { exercise_id: EXERCISE_ID, set_number: 1, weight_kg: 40 },
    });

    const response = await PUT(context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "validation_error" });
  });

  it("returns 500 db_error when upsertSet rejects", async () => {
    getSessionOwnershipMock.mockResolvedValue(activeSession);
    getWorkoutWithExercisesMock.mockResolvedValue(matchingWorkout);
    upsertSetMock.mockRejectedValue(new Error("connection reset"));
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      body: { exercise_id: EXERCISE_ID, set_number: 1, reps: 10, weight_kg: 40 },
    });

    const response = await PUT(context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db_error" });
  });
});

describe("DELETE /api/sessions/[sessionId]/sets", () => {
  beforeEach(() => {
    getSessionOwnershipMock.mockReset();
    getWorkoutWithExercisesMock.mockReset();
    upsertSetMock.mockReset();
    deleteSetMock.mockReset();
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    const context = buildContext({ user: null, sessionId: SESSION_ID, method: "DELETE" });

    const response = await DELETE(context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns 400 when sessionId is not a UUID", async () => {
    const context = buildContext({ user: authedUser, sessionId: "not-a-uuid", method: "DELETE" });

    const response = await DELETE(context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "validation_error" });
  });

  it("returns 204 with an empty body on a valid request", async () => {
    getSessionOwnershipMock.mockResolvedValue(activeSession);
    deleteSetMock.mockResolvedValue(undefined);
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      method: "DELETE",
      body: { exercise_id: EXERCISE_ID, set_number: 1 },
    });

    const response = await DELETE(context);

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });

  it("returns 404 not_found when the session is missing or not owned by the caller", async () => {
    getSessionOwnershipMock.mockResolvedValue(otherUsersSession);
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      method: "DELETE",
      body: { exercise_id: EXERCISE_ID, set_number: 1 },
    });

    const response = await DELETE(context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("returns 409 conflict when the session is not active", async () => {
    getSessionOwnershipMock.mockResolvedValue(inactiveSession);
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      method: "DELETE",
      body: { exercise_id: EXERCISE_ID, set_number: 1 },
    });

    const response = await DELETE(context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "conflict" });
  });

  it("returns 500 db_error when deleteSet rejects", async () => {
    getSessionOwnershipMock.mockResolvedValue(activeSession);
    deleteSetMock.mockRejectedValue(new Error("connection reset"));
    const context = buildContext({
      user: authedUser,
      sessionId: SESSION_ID,
      method: "DELETE",
      body: { exercise_id: EXERCISE_ID, set_number: 1 },
    });

    const response = await DELETE(context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "db_error" });
  });
});
