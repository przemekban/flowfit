import { describe, expect, it, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

const signUpMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({ auth: { signUp: signUpMock } })),
}));

const { POST } = await import("./signup");

function buildContext(fields: Record<string, string>): APIContext {
  return {
    request: new Request("http://test", { method: "POST", body: new URLSearchParams(fields) }),
    cookies: {} as APIContext["cookies"],
    redirect: vi.fn((path: string) => Response.redirect(new URL(path, "http://test"))),
  } as unknown as APIContext;
}

describe("POST /api/auth/signup", () => {
  beforeEach(() => {
    signUpMock.mockReset();
  });

  it("redirects to /auth/confirm-email and calls signUp with the parsed credentials on valid input", async () => {
    signUpMock.mockResolvedValue({ error: null });
    const context = buildContext({ email: "user@example.com", password: "s3cret" });

    await POST(context);

    expect(signUpMock).toHaveBeenCalledWith({ email: "user@example.com", password: "s3cret" });
    expect(context.redirect).toHaveBeenCalledWith("/auth/confirm-email");
  });

  it("redirects with an error and never calls signUp when password is empty", async () => {
    const context = buildContext({ email: "user@example.com", password: "" });

    await POST(context);

    expect(signUpMock).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/auth\/signup\?error=/));
  });

  it("redirects with an error and never calls signUp when email is malformed", async () => {
    const context = buildContext({ email: "not-an-email", password: "s3cret" });

    await POST(context);

    expect(signUpMock).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/auth\/signup\?error=/));
  });

  it("redirects with a friendly error instead of throwing when the body is not form-encoded", async () => {
    const context = {
      request: new Request("http://test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "s3cret" }),
      }),
      cookies: {} as APIContext["cookies"],
      redirect: vi.fn((path: string) => Response.redirect(new URL(path, "http://test"))),
    } as unknown as APIContext;

    await POST(context);

    expect(signUpMock).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/auth\/signup\?error=/));
  });

  it("redirects with the Supabase error message when signUp fails", async () => {
    signUpMock.mockResolvedValue({ error: { message: "User already registered" } });
    const context = buildContext({ email: "user@example.com", password: "s3cret" });

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith(
      `/auth/signup?error=${encodeURIComponent("User already registered")}`,
    );
  });
});
