---
date: 2026-08-05T00:00:00Z
researcher: Claude
git_commit: 2d8a438558910066bf546be59006746e800e2dff
branch: ci-cd-code-review
repository: przemekban/flowfit
topic: "CI/CD workflow for automated PR code review (wrapping the M5L2 local reviewer)"
tags: [research, codebase, github-actions, ci-cd, code-review, scripts-review]
status: complete
last_updated: 2026-08-05
last_updated_by: Claude
---

# Research: CI/CD workflow for automated PR code review

**Date**: 2026-08-05
**Researcher**: Claude
**Git Commit**: 2d8a438558910066bf546be59006746e800e2dff
**Branch**: ci-cd-code-review
**Repository**: przemekban/flowfit

## Research Question

Per `context/changes/ci-cd-code-review/requirements.md`: what does the codebase already provide, and what's missing, to build a GHA workflow (`.github/workflows/review.yml` + composite action `.github/actions/ai-reviewer/`) that wraps the existing local reviewer (`scripts/review.ts`, `scripts/review/schema.ts`) to review every PR to `main`, post a PR comment, apply `ai-cr:passed`/`ai-cr:failed` labels, and act as a required, blocking status check?

## Summary

The reviewer engine itself (`scripts/review.ts` + `scripts/review/schema.ts`) is done and reusable as-is — CI wiring was explicitly deferred to this exact change when M5L2 was built, so nothing needs to change in the review logic. What's genuinely new work, with no existing precedent in this repo to follow:

1. **No `.github/actions/` directory exists yet** — the composite action has to be built from scratch, no local pattern to mirror.
2. **No PR-comment/labeling precedent** — no `actions/github-script`, no octokit, no `gh` CLI usage in any workflow. The only `gh` CLI usage anywhere is manual issue-triage commands in a foundation doc (not code).
3. **The `ai-cr:passed` / `ai-cr:failed` (and `ai-cr:review` retry-trigger) labels don't exist in the repo** and there's no `.github/labels.yml` or similar config — they must be created (via `gh label create` or equivalent) before the workflow's labeling step can succeed, since GitHub Actions fails to apply a label that doesn't exist.
4. **`GEMINI_API_KEY` is already declared in `astro.config.mjs`'s `astro:env` schema** (server/secret/optional) as well as `.env.example` — but `scripts/review.ts` reads it via plain `process.env.GEMINI_API_KEY`, not `astro:env/server`, so in CI it only needs to arrive via workflow `env:` sourced from a new `secrets.GEMINI_API_KEY` repo secret. No `astro:env` involvement needed for the CI wrapper.
5. **`git diff` output can be piped to `scripts/review.ts` unmodified** — the script expects raw unified-diff text on stdin (confirmed against the `scripts/review/sample-diff.txt` fixture), so the composite action's diff-computation step just needs `git diff` (with the two path exclusions from requirements.md) piped straight into `npm run review`.
6. **`skills-lock.json` doesn't currently exist in this repo** — the exclusion rule from requirements.md is forward-looking/defensive, not something you can test against today.
7. **Repo is `przemekban/flowfit`** (confirmed via `gh repo view`), useful for constructing any `gh`/API calls in the composite action.
8. **Known open risk carried over from M5L2, never resolved**: Gemini `gemini-3.1-flash-lite` free-tier rate limits were only ever validated for "occasional local runs" — CI will call this on every PR (plus every `ai-cr:review` retry), which is a materially different volume. Worth flagging to the user before/while implementing, since a rate-limit failure would make the required status check flaky rather than a true signal.

## Detailed Findings

### The existing reviewer (`scripts/review.ts`, `scripts/review/schema.ts`)

- `scripts/review.ts:1-52` — CLI entrypoint: reads the entire diff from stdin (`readStdin()`, lines 7-13), requires `GEMINI_API_KEY` in `process.env` (lines 40-44, exits 1 with a clear message if missing), builds a `ToolLoopAgent` (`ai` SDK) with `Output.object({ schema: REVIEW_SCHEMA })` and `stopWhen: isStepCount(2)`, and prints the resulting JSON review to stdout via `console.log`. Exits 1 with a message on empty stdin or any thrown error — both are CI-friendly failure modes (a composite action step can just check the exit code).
- `scripts/review/schema.ts` — defines `SYSTEM_PROMPT` and `REVIEW_SCHEMA` (zod). The working tree currently has an **uncommitted** edit to this file (visible in `git status`/`git diff`) that expands the prompt and per-field descriptions to match `requirements.md`'s five criteria almost verbatim (FlowFit-specific anchors: `prerender = false`, `@/*` alias, `cn()`, no Next.js directives, `src/lib/services/` reuse, RLS/`astro:env/server`/`PROTECTED_ROUTES`/leaked-secret checks). This is in-progress prep work for the current change, already aligned with requirements.md — no further schema changes appear necessary for the CI wrapper itself.
- `package.json:16-17` — `"review": "tsx --env-file=.env scripts/review.ts"`, `"review:sample": "tsx --env-file=.env scripts/review.ts < scripts/review/sample-diff.txt"`. In CI, `--env-file=.env` is unnecessary (no `.env` file will exist) since `GEMINI_API_KEY` will already be in `process.env` via the workflow's `env:` block — but leaving the flag in place is harmless since `tsx --env-file` on a missing file is a no-op it won't error on.
- `scripts/review/sample-diff.txt` — a real unified-diff fixture (`diff --git a/... b/...`, `---`/`+++`, `@@ ... @@` hunks), confirming `scripts/review.ts` expects and correctly parses raw `git diff` output with no preprocessing.

### M5L2 plan history — CI was deliberately deferred, not forgotten

- `context/archive/2026-08-04-code-review-agent/plan-brief.md:38-44` ("Out of scope") and `context/archive/2026-08-04-code-review-agent/plan.md:29-36` ("What We're NOT Doing") both explicitly list "CI/CD wiring, PR commenting, human-in-the-loop" as **M5L3** — i.e., this current change.
- `plan-brief.md:25` — the system prompt was deliberately kept generic (no `AGENTS.md` injection) because "project-convention-awareness is a natural fit for the M5L3 CI integration instead." The in-progress `schema.ts` edit (see above) is exactly that follow-through.
- `plan-brief.md:26` — `npm run review:sample`'s fixture-diff pattern was explicitly built to be "reusable later by CI in M5L3" — confirms the fixture/test pattern is intended for CI use (e.g., a smoke-test step or PR template), not just local dev.
- `plan-brief.md:23,63` — model choice (`gemini-3.1-flash-lite`) reused the model already used by `src/lib/services/plan.ts` to avoid a new cost surface, under a hard $0-AI-provider constraint (`tech-stack.md` decision ORQ-2, Anthropic explicitly rejected for cost). The rate-limit assumption was flagged as an _open risk_, never load-tested — see Summary point 8.
- Schema/criteria history: git log shows `scripts/review/schema.ts` and `scripts/review.ts` were introduced together in a single commit (`2d8a438`, "feat: local code review agent (M5L2) (#24)") with exactly the 5 criteria requirements.md still uses — no prior schema churn to account for.

### GitHub Actions conventions (what exists vs. what's new)

- `.github/workflows/ci.yml` is the only workflow in the repo (confirmed via `Glob .github/**`) — no `.github/actions/` composite actions exist anywhere yet, so the new `.github/actions/ai-reviewer/` will be the first.
- `.github/workflows/ci.yml:16-21` conventions worth mirroring: `actions/checkout@v4`, `actions/setup-node@v4` with `node-version: 22, cache: npm` (matches `.nvmrc` = `22.14.0`, confirmed at repo root; no `engines` field in `package.json`), `npm ci`.
- No `actions/github-script`, octokit, or `gh` CLI usage in any workflow or script. The only `gh` CLI usage anywhere in the repo is manual issue-triage documentation in `context/foundation/tasks-github.md:62-100` (e.g. `gh issue list/view/edit/comment/close --repo przemekban/flowfit`) — a naming-convention reference only, not a PR-comment/label precedent to copy code from.
- No `.github/labels.yml` or any labels config file exists. The `ai-cr:passed` (green) / `ai-cr:failed` (red) labels — and the `ai-cr:review` label used for the on-demand retry trigger — do not exist in the repo today and must be created before the workflow can apply them (a GH Actions labeling step errors if the label doesn't already exist on the repo).
- No CODEOWNERS, no `.github/PULL_REQUEST_TEMPLATE.md`, no issue templates — no additional repo conventions to reconcile with.
- `.env.example` (root, 3 lines): `SUPABASE_URL=###`, `SUPABASE_KEY=###`, `GEMINI_API_KEY=###` — flat `NAME=###` convention, confirming `GEMINI_API_KEY` is the correct secret name to add as a GitHub Actions repository secret (per requirements.md:42).
- `astro.config.mjs:18-21` — `GEMINI_API_KEY` is declared in the `astro:env` schema (`envField.string({ context: "server", access: "secret", optional: true })`) alongside `SUPABASE_URL`/`SUPABASE_KEY`. This is Astro's own typed-env validation for the app runtime; `scripts/review.ts` (a standalone Node/tsx script, not part of the Astro app) bypasses this entirely and reads `process.env.GEMINI_API_KEY` directly — so the CI wrapper only needs a plain `env:` secret injection, no `astro:env` involvement.
- Repo identity: `przemekban/flowfit` (via `gh repo view --json owner,name`) — matches `tasks-github.md`'s `--repo przemekban/flowfit` convention.

### Diff computation / exclusions

- `package-lock.json` exists at repo root (~578KB, 16,139 lines) — a real, large lockfile diff that justifies the exclusion.
- `skills-lock.json` does not exist anywhere in the repo currently — the exclusion is defensive/forward-looking per requirements.md, not testable against real repo state today.
- `.gitattributes` (root, single line: `* text=auto eol=lf`) has no `linguist-generated` or `diff=` driver markers — no additional hidden exclusion candidates surfaced there.
- No existing "diff helper" script anywhere in `scripts/` — the composite action will be the first place `git diff` computation + path-exclusion logic lives. `scripts/local/check-quality.mjs` (the closest same-directory neighbor) was checked and ruled out as a pattern to follow — it's an unrelated one-off local data-inspection script (filters exercise JSON by keyword), not a CI-style gate with pass/fail exit codes.

## Code References

- `scripts/review.ts:1-52` — reviewer CLI entrypoint (stdin → JSON stdout, exit codes)
- `scripts/review/schema.ts` — `SYSTEM_PROMPT` + `REVIEW_SCHEMA` (zod, 5 criteria + verdict + summary); currently has an uncommitted in-progress edit aligning it with requirements.md
- `scripts/review/sample-diff.txt` — unified-diff fixture proving the expected stdin shape
- `package.json:16-17` — `review` / `review:sample` script entries
- `.github/workflows/ci.yml:16-21` — checkout/setup-node/npm ci conventions to mirror
- `.env.example:1-3` — secret-naming convention (`GEMINI_API_KEY=###`)
- `astro.config.mjs:18-21` — `astro:env` schema declaration for `GEMINI_API_KEY` (app-runtime only, not relevant to the CI script path)
- `.nvmrc:1` — pinned Node version `22.14.0`
- `context/foundation/tasks-github.md:62-100` — existing `gh` CLI usage conventions (`--repo przemekban/flowfit`)

## Architecture Insights

- The repo has a clean separation: `scripts/review.ts` is a standalone script deliberately decoupled from the Astro app (no `astro:env` dependency), which is exactly what makes it portable into a CI job with zero modification — the CI work is purely a wrapper problem (diff in, secret in, JSON out, comment/label out), matching requirements.md's own framing ("CI work here is purely mechanical").
- This repo has no precedent yet for GitHub API interaction (comments, labels) from Actions — the composite action introduces that capability for the first time, so its design should be treated as establishing a new convention future workflows may reuse, not just a one-off.
- Secrets in this repo follow one flat naming convention across `.env.example`, `astro:env` schema, and (existing) GH Actions secrets (`SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN` in `ci.yml`) — `GEMINI_API_KEY` as a new repo secret fits this pattern exactly.

## Historical Context (from prior changes)

- `context/archive/2026-08-04-code-review-agent/plan-brief.md` and `plan.md` — the M5L2 plan that built the reviewer, with CI/CD wiring explicitly scoped out and named as follow-up work (i.e., this change).
- `context/foundation/code-review-w-erze-ai-standardy-dod-i-agent-w-pipeline.md:207-239` — background/rationale doc (Polish) that mirrors the same CI behavior spec now in `requirements.md` (PR comment, labels, required status check, retry-on-label), plus a Deep Dive section (~lines 667-681) raising unresolved concerns for team-scale use (no PR triage tiering, no cost-per-PR observability, no promptfoo eval/regression gate) — these are explicitly out of scope for this change per requirements.md's "Parked for later" section, but worth knowing they were already identified rather than novel gaps.
- `context/foundation/lessons.md` — no entries relevant to CI/GitHub Actions/automated review; all 3 existing lessons are Supabase/RLS/migration-specific and don't apply here.

## Related Research

None — this is the first research document for this change (`context/changes/ci-cd-code-review/`).

## Open Questions

1. **Label pre-creation**: should `.github/actions/ai-reviewer/` (or the workflow) create the `ai-cr:passed`/`ai-cr:failed`/`ai-cr:review` labels idempotently on first run (e.g., via `gh label create --force` or the GitHub API with "already exists" tolerance), or should label creation be a one-time manual/documented setup step before the workflow ever runs? Neither is specified in requirements.md.
2. **Rate limits under CI volume**: the M5L2 plan's rate-limit assumption was never validated beyond "occasional local runs." Every PR push/update plus every `ai-cr:review` retry will now call Gemini — worth a quick check of Gemini free-tier limits against expected PR volume before treating the check as a hard merge gate, since a rate-limit error would surface as a false "fail" rather than a true review failure.
3. **Branch protection activation**: requirements.md already flags this (not a gap in research, just a reminder) — the required-status-check enforcement is a manual GitHub UI step after the workflow's first successful run, same as the existing `ci` check; no automation for this exists or is expected to exist in this repo.
