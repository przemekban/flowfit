import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

const { POST } = await import("./complete");

function buildContext(overrides: { user: APIContext["locals"]["user"]; sessionId: string }): APIContext {
  return {
    locals: { user: overrides.user },
    params: { sessionId: overrides.sessionId },
    request: new Request("http://test"),
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

describe("POST /api/sessions/[sessionId]/complete", () => {
  it("returns 401 when the caller is unauthenticated", async () => {
    const context = buildContext({ user: null, sessionId: "11111111-1111-1111-1111-111111111111" });

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
});
