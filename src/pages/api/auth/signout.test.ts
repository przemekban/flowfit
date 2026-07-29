import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

const signOutMock = vi.fn();
const createClientMock = vi.fn();

vi.mock("@/lib/supabase", () => ({ createClient: createClientMock }));

const { POST } = await import("./signout");

function buildContext(): APIContext {
  return {
    request: new Request("http://test", { method: "POST" }),
    cookies: {} as APIContext["cookies"],
    redirect: vi.fn((path: string) => Response.redirect(new URL(path, "http://test"))),
  } as unknown as APIContext;
}

describe("POST /api/auth/signout", () => {
  it("calls signOut and redirects to / when a Supabase client is configured", async () => {
    createClientMock.mockReturnValue({ auth: { signOut: signOutMock } });
    const context = buildContext();

    await POST(context);

    expect(signOutMock).toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith("/");
  });

  it("redirects to / without throwing when Supabase is not configured", async () => {
    createClientMock.mockReturnValue(null);
    const context = buildContext();

    await POST(context);

    expect(context.redirect).toHaveBeenCalledWith("/");
  });
});
