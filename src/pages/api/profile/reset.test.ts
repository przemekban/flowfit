import { describe, expect, it, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

const hasActiveWorkoutSessionMock = vi.fn();
const resetUserProfileMock = vi.fn();

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/services/workout-sessions", () => ({ hasActiveWorkoutSession: hasActiveWorkoutSessionMock }));
vi.mock("@/lib/services/profile", () => ({ resetUserProfile: resetUserProfileMock }));

const { POST } = await import("./reset");

function buildContext(user: APIContext["locals"]["user"]): APIContext {
  return {
    locals: { user },
    request: new Request("http://test", { method: "POST" }),
    cookies: {} as APIContext["cookies"],
    redirect: vi.fn((path: string) => Response.redirect(new URL(path, "http://test"))),
  } as unknown as APIContext;
}

const authedUser = { id: "user-1" } as APIContext["locals"]["user"];
const ACTIVE_SESSION_MESSAGE = "Finish or end your active workout before resetting your profile";

describe("POST /api/profile/reset", () => {
  beforeEach(() => {
    hasActiveWorkoutSessionMock.mockReset();
    resetUserProfileMock.mockReset();
  });

  it("redirects to /auth/signin when the caller is unauthenticated", async () => {
    const context = buildContext(null);

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith("/auth/signin");
  });

  it("redirects with the active-session message and never calls resetUserProfile when hasActiveWorkoutSession resolves true", async () => {
    hasActiveWorkoutSessionMock.mockResolvedValue(true);
    const context = buildContext(authedUser);

    await POST(context);

    expect(resetUserProfileMock).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith(`/onboarding?error=${encodeURIComponent(ACTIVE_SESSION_MESSAGE)}`);
  });

  it("maps a resetUserProfile rejection with Error('active_workout_session') to the same known message", async () => {
    hasActiveWorkoutSessionMock.mockResolvedValue(false);
    resetUserProfileMock.mockRejectedValue(new Error("active_workout_session"));
    const context = buildContext(authedUser);

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith(`/onboarding?error=${encodeURIComponent(ACTIVE_SESSION_MESSAGE)}`);
  });

  it("falls back to a generic message when resetUserProfile rejects with an unrecognized error", async () => {
    hasActiveWorkoutSessionMock.mockResolvedValue(false);
    resetUserProfileMock.mockRejectedValue(new Error("some_unmapped_db_error"));
    const context = buildContext(authedUser);

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith(
      `/onboarding?error=${encodeURIComponent("Something went wrong while resetting your profile")}`,
    );
  });

  it("redirects to /onboarding on success", async () => {
    hasActiveWorkoutSessionMock.mockResolvedValue(false);
    resetUserProfileMock.mockResolvedValue(undefined);
    const context = buildContext(authedUser);

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith("/onboarding");
  });
});
