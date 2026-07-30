# Repository Guidelines

FlowFit is a fitness-tracking web app built on Astro 6 SSR with React 19 islands, Tailwind CSS 4, Supabase auth, and Cloudflare Workers deployment.

## Hard Rules

- All pages are server-rendered (`output: "server"`). API routes must export `const prerender = false`.
- Server-side secrets must use `astro:env/server` — never import env vars directly from `.env` in server code.
- Every new Supabase table requires RLS enabled with per-operation, per-role policies in `supabase/migrations/`.
- Do not use Next.js directives (`"use client"`, `"use server"`) — this is Astro, not Next.js.
- Use `cn()` from `@/lib/utils` for all conditional or merged Tailwind class strings; never concatenate class strings manually.
- Add new protected paths to `PROTECTED_ROUTES` in `src/middleware.ts` — omitting it leaves the route unauthenticated.
- Never run `npx supabase db reset` against the shared local dev stack to "verify a migration applies cleanly" — it wipes the entire Postgres volume, including every `auth.users` row, and this stack is shared across all worktrees (same `project_id`/ports in `supabase/config.toml`). To verify a new migration applies without destroying data, use `npx supabase migration up` instead. Only run `db reset` when the user explicitly asks for it, understanding it deletes all local data.

## Project Structure

- `src/pages/` — Astro pages; `src/pages/api/` for API endpoints
- `src/components/` — React components; `src/components/ui/` for shadcn/ui; `src/components/hooks/` for custom React hooks
- `src/lib/` — helpers and utilities; `src/lib/services/` for extracted business logic
- `src/types.ts` — all shared entity and DTO types
- `supabase/migrations/` — SQL migrations named `YYYYMMDDHHmmss_short_description.sql`
- `context/` — project planning docs (do not modify)

## Commands

- `npx supabase start` — start local Supabase stack (requires Docker); credentials printed to stdout
- `npm run dev` — start Cloudflare workerd dev server
- `npm run build` — production SSR build via `@astrojs/cloudflare`
- `npm run preview` — preview production build
- `npm run lint` — ESLint with type-checked rules (flat config, ESLint 9)
- `npm run lint:fix` — auto-fix lint issues
- `npm run format` — Prettier with astro + tailwindcss plugins

Pre-commit hooks: husky + lint-staged runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Coding Style

- Path alias `@/*` maps to `src/*`; use it over relative paths that cross directory boundaries.
- Write Astro components (`.astro`) for static content and layout; use React only when client-side interactivity is required.
- API route handlers export uppercase `GET`, `POST`, etc.; validate all input with zod.
- Install new shadcn/ui components with `npx shadcn@latest add [name]`; they land in `src/components/ui/` (new-york style variant).
- Prefix unused variables with `_` to satisfy the `@typescript-eslint/no-unused-vars` rule.
- Formatting rules: see `@.prettierrc.json`.

## Auth & Middleware

- `src/lib/supabase.ts` — SSR client using `@supabase/ssr` with cookie-based sessions; `SUPABASE_URL` and `SUPABASE_KEY` loaded via `astro:env/server`.
- `src/middleware.ts` — runs on every request, resolves current user into `context.locals.user`; add protected paths to `PROTECTED_ROUTES` here.
- Auth endpoints: `src/pages/api/auth/{signin,signup,signout}.ts`
- Auth pages: `src/pages/auth/{signin,signup,confirm-email}.astro`
- Env vars go in `.dev.vars` for Cloudflare local dev, `.env` for Node. See @README.md for full setup.

## PRs & Issues

- This repo's roadmap slices are tracked as GitHub Issues (see `context/foundation/roadmap.md` for the Change ID ↔ issue mapping). When a PR implements one, its body must include a closing keyword (`Closes #N`) so the issue auto-closes on merge — this has been missed more than once, leaving shipped work showing as an open issue.
- If a PR already merged without the keyword, close the issue manually right away with a comment linking the PR (`gh issue close N --comment "Implemented and merged via #M."`).

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on push and PR to `master`: `npm ci` → `astro sync` → `npm run lint` → `npm run build`. Both lint and build must pass before merging. No automated test suite is configured.
