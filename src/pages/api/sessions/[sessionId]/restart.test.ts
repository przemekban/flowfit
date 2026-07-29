import { describe, expect, it, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
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
    vi.mocked(createClient).mockReturnValue({} as never);
    vi.mocked(loadOwnedSession).mockResolvedValue({ id: "session-old", status: "active", workout_id: "workout-1" });
    vi.mocked(restartSession).mockResolvedValue("session-new");
    vi.mocked(getWorkoutWithExercises).mockResolvedValue({ id: "workout-1", exercises: [{ exercise_id: "ex-1" }] });
    vi.mocked(getSessionWithSets).mockResolvedValue({ id: "session-new", status: "active" });
    vi.mocked(getLastLoggedSets).mockResolvedValue({ "ex-1": { reps: 10 } });

    const response = await POST(context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      session: { id: "session-new", status: "active" },
      lastLoggedSets: { "ex-1": { reps: 10 } },
    });
    expect(restartSession).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
      "11111111-1111-4111-a111-111111111111",
      "workout-1",
    );
  });
});
