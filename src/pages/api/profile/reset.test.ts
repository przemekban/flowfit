import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const { POST } = await import("./reset");

function buildContext(user: APIContext["locals"]["user"]): APIContext {
  return {
    locals: { user },
    request: new Request("http://test", { method: "POST" }),
    cookies: {} as APIContext["cookies"],
    redirect: vi.fn((path: string) => Response.redirect(new URL(path, "http://test"))),
  } as unknown as APIContext;
}

describe("POST /api/profile/reset", () => {
  it("redirects to /auth/signin when the caller is unauthenticated", async () => {
    const context = buildContext(null);

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith("/auth/signin");
  });
});
