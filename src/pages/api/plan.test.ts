import { describe, expect, it, vi } from "vitest";
import type { APIContext } from "astro";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ createGeminiClient: vi.fn() }));

const { POST } = await import("./plan");

function buildContext(user: APIContext["locals"]["user"]): APIContext {
  return {
    locals: { user },
    request: new Request("http://test", { method: "POST" }),
    cookies: {} as APIContext["cookies"],
  } as unknown as APIContext;
}

describe("POST /api/plan", () => {
  it("returns 401 when the caller is unauthenticated", async () => {
    const context = buildContext(null);

    const response = await POST(context);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });
});
