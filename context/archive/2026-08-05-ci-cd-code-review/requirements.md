## Overall concept

- GHA workflow run for every pull request to `main` (this repo's default branch — not `master`), plus `workflow_dispatch` for manual runs
- composite action in `.github/actions/ai-reviewer/` so the consumer workflow (`.github/workflows/review.yml`) stays a thin, readable list of steps
- reuse the existing reviewer built in M5L2 (`scripts/review.ts`, `ToolLoopAgent` + Gemini + `Output.object`) — no new agent to write, only a CI wrapper around `npm run review`

## Input parameters

- pull request title (`github.event.pull_request.title`)
- pull request description (`github.event.pull_request.body`) — included in full; the extra context on _why_ is worth the token cost here
- `git diff` computed against `main` (requires `actions/checkout@v4` with `fetch-depth: 0`)
  - excludes noise-only paths before being sent to the model: `package-lock.json`, `skills-lock.json`. These are pure lockfile diffs with no review value and only inflate token cost.
  - does **not** exclude `supabase/migrations/**` — those are hand-authored SQL (RLS policies, schema changes per `AGENTS.md`), not generated, and are exactly the kind of change that needs review.

## Code Review Criteria

Already defined and committed — not redefined for CI. `scripts/review/schema.ts` (`REVIEW_SCHEMA`) scores every diff on 5 criteria, each 1–10, with anchors tuned to FlowFit's stack (Astro SSR + Supabase + Cloudflare Workers):

- **implementationCorrectness** — does the code do what it claims, including edge cases; a new API route missing `export const prerender = false` scores 1-2 (breaks SSR).
- **idiomaticity** — adherence to project conventions: `@/*` alias, `cn()` for conditional Tailwind classes, no Next.js directives (`"use client"`/`"use server"`), React only where client interactivity is needed.
- **complexity** — simplest solution for the problem; duplicated business logic that should have reused an existing `src/lib/services/` helper counts against this criterion (not idiomaticity).
- **testRiskCoverage** — test coverage proportional to the risk of the changed paths (auth, RLS-protected queries, critical flows), regardless of test layer (unit/integration/e2e); cosmetic changes need no new tests.
- **securitySafety** — zero-tolerance: _any_ violation of a hard rule from `AGENTS.md`, even partial, caps the score at 1-2 — missing/incomplete RLS policies, a secret imported outside `astro:env/server`, a new protected path missing from `PROTECTED_ROUTES`, a leaked secret/token, or other vulnerability patterns (SQL injection, XSS).

Plus a binding `verdict` (`pass` | `fail`) — any `securitySafety` score of 1-2 must produce `verdict: fail` — and a Markdown `summary` used verbatim as the PR comment body. CI work here is purely mechanical (get diff in, verdict out) — it does not touch the prompt or schema.

## Parked for later

- business alignment (requires broader context than a diff)
- architectural fit (requires broader context than a diff)
- plan review — comparing the PR against `context/changes/<id>/plan.md` (Deep Dive path 2 from the lesson: `readPlan` + `readImplReviewCriteria` tools). Separate iteration once the base loop is proven.

## Expected side-effects

- PR comment with the review summary (`review.summary` from `REVIEW_SCHEMA`)
- labels: `ai-cr:passed` (green) on `verdict: pass`, `ai-cr:failed` (red) on `verdict: fail`
- **hard gate from day one**: a required status check (e.g. job name `ai-code-review`) that blocks merging to `main` when `verdict: fail`. This must also be turned on in GitHub branch protection settings for `main` after the workflow's first successful run — the YAML alone doesn't enforce it, same as the existing `ci` check.

## Expected behavior

- on-demand retry when the `ai-cr:review` label is added to a PR
- `GEMINI_API_KEY` already exists locally (`.env`, see `.env.example`) — must be added as a GitHub Actions repository secret with the same name before the workflow can run
