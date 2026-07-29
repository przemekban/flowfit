import { describe, expect, it, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

const signInWithPasswordMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({ auth: { signInWithPassword: signInWithPasswordMock } })),
}));

const { POST } = await import("./signin");

function buildContext(fields: Record<string, string>): APIContext {
  return {
    request: new Request("http://test", { method: "POST", body: new URLSearchParams(fields) }),
    cookies: {} as APIContext["cookies"],
    redirect: vi.fn((path: string) => Response.redirect(new URL(path, "http://test"))),
  } as unknown as APIContext;
}

describe("POST /api/auth/signin", () => {
  beforeEach(() => {
    signInWithPasswordMock.mockReset();
  });

  it("redirects to /dashboard and calls signInWithPassword with the parsed credentials on valid input", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    const context = buildContext({ email: "user@example.com", password: "s3cret" });

    await POST(context);

    expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "user@example.com", password: "s3cret" });
    expect(context.redirect).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects with an error and never calls signInWithPassword when password is empty", async () => {
    const context = buildContext({ email: "user@example.com", password: "" });

    await POST(context);

    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/auth\/signin\?error=/));
  });

  it("redirects with an error and never calls signInWithPassword when email is malformed", async () => {
    const context = buildContext({ email: "not-an-email", password: "s3cret" });

    await POST(context);

    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/auth\/signin\?error=/));
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

    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/auth\/signin\?error=/));
  });

  it("redirects with the Supabase error message when signInWithPassword fails", async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const context = buildContext({ email: "user@example.com", password: "s3cret" });

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith(
      `/auth/signin?error=${encodeURIComponent("Invalid login credentials")}`,
    );
  });
});
