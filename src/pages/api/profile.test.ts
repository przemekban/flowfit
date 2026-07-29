import { describe, expect, it, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

const createUserProfileMock = vi.fn();

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn(() => ({})) }));
vi.mock("@/lib/services/profile", () => ({ createUserProfile: createUserProfileMock }));

const { POST } = await import("./profile");

const validFields = {
  training_goal: "strength",
  experience_level: "beginner",
  preferred_style: "full_body",
  sessions_per_week: "3",
};

function buildFormBody(fields: Record<string, string | string[]>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.append(key, value);
    }
  }
  return params;
}

function buildContext(
  user: APIContext["locals"]["user"],
  body?: URLSearchParams | string,
  contentType?: string,
): APIContext {
  return {
    locals: { user },
    request: new Request("http://test", {
      method: "POST",
      ...(body !== undefined ? { body, headers: contentType ? { "Content-Type": contentType } : undefined } : {}),
    }),
    cookies: {} as APIContext["cookies"],
    redirect: vi.fn((path: string) => Response.redirect(new URL(path, "http://test"))),
  } as unknown as APIContext;
}

const authedUser = { id: "user-1" } as APIContext["locals"]["user"];

describe("POST /api/profile", () => {
  beforeEach(() => {
    createUserProfileMock.mockReset();
  });

  it("redirects to /auth/signin when the caller is unauthenticated", async () => {
    const context = buildContext(null);

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith("/auth/signin");
  });

  it("redirects to /onboarding with an error when a required field (training_goal) is missing", async () => {
    const { training_goal: _omitted, ...rest } = validFields;
    const context = buildContext(authedUser, buildFormBody({ ...rest, equipment: ["barbell"] }));

    await POST(context);

    expect(createUserProfileMock).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/onboarding\?error=/));
  });

  it("redirects to /dashboard (benign double-submit) when createUserProfile rejects with a 23505 error", async () => {
    createUserProfileMock.mockRejectedValue({ code: "23505", message: "duplicate key value" });
    const context = buildContext(authedUser, buildFormBody({ ...validFields, equipment: ["barbell"] }));

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects to /onboarding carrying the message when createUserProfile rejects with an unrelated error", async () => {
    createUserProfileMock.mockRejectedValue(new Error("connection reset"));
    const context = buildContext(authedUser, buildFormBody({ ...validFields, equipment: ["barbell"] }));

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith(`/onboarding?error=${encodeURIComponent("connection reset")}`);
  });

  it("redirects to /dashboard?saved=1 on a valid submission", async () => {
    createUserProfileMock.mockResolvedValue({ id: "user-1" });
    const context = buildContext(authedUser, buildFormBody({ ...validFields, equipment: ["barbell"] }));

    await POST(context);

    expect(createUserProfileMock).toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith("/dashboard?saved=1");
  });
});
