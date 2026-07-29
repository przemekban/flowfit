import { describe, expect, it, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import { createClient } from "@/lib/supabase";
import { loadOwnedSession, completeSession } from "@/lib/services/session";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/session", () => ({
  loadOwnedSession: vi.fn(),
  getSessionOwnership: vi.fn(),
  completeSession: vi.fn(),
}));

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

  it("completes the session on successful authenticated request", async () => {
    const context = buildContext({
      user: { id: "user-1" } as APIContext["locals"]["user"],
      sessionId: "11111111-1111-4111-a111-111111111111",
    });
    vi.mocked(createClient).mockReturnValue({} as never);
    vi.mocked(loadOwnedSession).mockResolvedValue({ id: "session-1", status: "active" });
    vi.mocked(completeSession).mockResolvedValue({ id: "session-1", status: "completed" });

    const response = await POST(context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "session-1", status: "completed" });
    expect(completeSession).toHaveBeenCalledWith(expect.any(Object), "11111111-1111-4111-a111-111111111111");
  });
});
