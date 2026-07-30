import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIContext } from "astro";

vi.mock("astro:middleware", () => ({
  defineMiddleware: (fn: unknown) => fn,
}));

const getUserMock = vi.fn();
const createClientMock = vi.fn(() => ({ auth: { getUser: getUserMock } }));
vi.mock("@/lib/supabase", () => ({ createClient: createClientMock }));

const getUserProfileMock = vi.fn();
vi.mock("@/lib/services/profile", () => ({ getUserProfile: getUserProfileMock }));

const { onRequest } = await import("./middleware");

// Matches both `Astro.locals.user` and this codebase's actual
// `const { user } = Astro.locals;` destructuring form.
const READS_LOCALS_USER = /Astro\.locals\.user|\{\s*[^{}]*\buser\b[^{}]*\}\s*=\s*Astro\.locals/;

function derivePagesReadingUser(): string[] {
  const rootDir = path.dirname(fileURLToPath(import.meta.url));
  const pagesDir = path.join(rootDir, "pages");
  const entries = fs.readdirSync(pagesDir, { recursive: true }) as string[];

  const paths = new Set<string>();
  for (const relativePath of entries) {
    if (!relativePath.endsWith(".astro")) continue;

    const segments = relativePath.split(path.sep);
    if (segments[0] === "api" || segments[0] === "auth") continue;

    const source = fs.readFileSync(path.join(pagesDir, relativePath), "utf-8");
    if (!READS_LOCALS_USER.test(source)) continue;

    const firstSegment = segments.length > 1 ? segments[0] : segments[0].replace(/\.astro$/, "");
    paths.add(`/${firstSegment}`);
  }

  return [...paths];
}

const derivedProtectedPaths = derivePagesReadingUser();

const authedUser = { id: "user-1" } as APIContext["locals"]["user"];

function buildContext(pathname: string): APIContext {
  return {
    locals: {},
    request: new Request(`http://test${pathname}`),
    cookies: {} as APIContext["cookies"],
    url: new URL(`http://test${pathname}`),
    redirect: vi.fn((path: string) => Response.redirect(new URL(path, "http://test"))),
  } as unknown as APIContext;
}

describe("middleware onRequest", () => {
  beforeEach(() => {
    getUserMock.mockReset();
    createClientMock.mockClear();
    getUserProfileMock.mockReset();
  });

  it("derives at least one protected page from src/pages source", () => {
    // Guards against the derivation helper silently matching nothing (e.g. a
    // regex that no longer matches this codebase's Astro.locals access style).
    expect(derivedProtectedPaths.length).toBeGreaterThan(0);
  });

  describe("protected-route redirect (source-derived)", () => {
    describe.each(derivedProtectedPaths)("%s", (pagePath) => {
      it("redirects to /auth/signin when unauthenticated", async () => {
        getUserMock.mockResolvedValue({ data: { user: null } });
        const context = buildContext(pagePath);
        const next = vi.fn();

        await onRequest(context, next);

        expect(context.redirect).toHaveBeenCalledWith("/auth/signin");
        expect(next).not.toHaveBeenCalled();
      });
    });

    it("does not redirect to /auth/signin for an authenticated user with a profile (control)", async () => {
      getUserMock.mockResolvedValue({ data: { user: authedUser } });
      getUserProfileMock.mockResolvedValue({ id: "user-1" });
      const context = buildContext(derivedProtectedPaths[0]);
      const next = vi.fn();

      await onRequest(context, next);

      expect(context.redirect).not.toHaveBeenCalledWith("/auth/signin");
      expect(next).toHaveBeenCalled();
    });
  });

  describe("profile-required redirect (hand-specified)", () => {
    describe.each(["/dashboard", "/session", "/history"])("%s", (pagePath) => {
      it("redirects to /onboarding when authenticated but without a profile", async () => {
        getUserMock.mockResolvedValue({ data: { user: authedUser } });
        getUserProfileMock.mockResolvedValue(null);
        const context = buildContext(pagePath);
        const next = vi.fn();

        await onRequest(context, next);

        expect(context.redirect).toHaveBeenCalledWith("/onboarding");
        expect(next).not.toHaveBeenCalled();
      });
    });

    it("does not redirect /onboarding itself, even when authenticated without a profile", async () => {
      getUserMock.mockResolvedValue({ data: { user: authedUser } });
      getUserProfileMock.mockResolvedValue(null);
      const context = buildContext("/onboarding");
      const next = vi.fn();

      await onRequest(context, next);

      expect(context.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    it("does not redirect when the authenticated user already has a profile (control)", async () => {
      getUserMock.mockResolvedValue({ data: { user: authedUser } });
      getUserProfileMock.mockResolvedValue({ id: "user-1" });
      const context = buildContext("/dashboard");
      const next = vi.fn();

      await onRequest(context, next);

      expect(context.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });
});
