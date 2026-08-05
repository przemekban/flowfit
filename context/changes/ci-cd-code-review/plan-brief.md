# CI/CD Automated PR Code Review — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Wrap the existing M5L2 reviewer (`scripts/review.ts`, Gemini + `Output.object`) in a GitHub Actions composite action and consumer workflow, so every PR to `main` gets an automated review with a PR comment, a `ai-cr:passed`/`ai-cr:failed` label, and a hard, merge-blocking required status check. CI/CD wiring was deliberately scoped out of M5L2 as this exact follow-up change — the reviewer's prompt, schema, and logic are untouched.

## Starting Point

`scripts/review.ts` + `scripts/review/schema.ts` already work standalone: pipe a diff to stdin, get a JSON review out, non-zero exit only on real errors. Nothing GitHub-API-shaped exists yet in this repo — no `.github/actions/`, no PR-comment/labeling precedent, no labels config. This change builds all of that from scratch.

## Desired End State

Every PR to `main` automatically gets a review comment and a pass/fail label within minutes of opening or pushing. A failing `securitySafety` score blocks merge until fixed or a legitimate override is made. Adding the `ai-cr:review` label re-triggers a review on demand (e.g. after a Gemini rate-limit blip) and removes itself once consumed.

## Key Decisions Made

| Decision                       | Choice                                                                               | Why (1 sentence)                                                                                                   | Source |
| ------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ------ |
| PR trigger model               | Plain `pull_request` event, same-repo branches only                                  | Solo/trusted-maintainer repo — no fork PRs, so no need for risky `pull_request_target` untrusted-checkout handling | Plan   |
| Label creation                 | Manual (`gh label create`, Phase 5)                                                  | User's explicit choice over idempotent in-workflow creation                                                        | Plan   |
| Retry mechanism                | `ai-cr:review` label, consumed (removed) after triggering                            | Clean, reusable trigger signal; avoids ambiguous "still pending" state                                             | Plan   |
| Failure handling               | Fail closed on any Gemini/script error                                               | Matches "hard gate from day one"; script already exits 1 on real errors, no extra logic                            | Plan   |
| Action/workflow split          | Composite action does diff+run+comment+label; workflow is just checkout/setup/invoke | Matches requirements.md's explicit "thin, readable workflow" goal                                                  | Plan   |
| Empty diff (lockfile-only PRs) | Auto-pass, skip the Gemini call entirely                                             | Matches the stated "no review value" rationale for the exclusions                                                  | Plan   |
| Comment behavior on retry      | Always post a new comment                                                            | Simplicity over comment-thread tidiness; explicit user choice                                                      | Plan   |
| Composite-action testing       | No dedicated smoke test                                                              | Manual verification per phase is the integration test; explicit user choice                                        | Plan   |

## Scope

**In scope:** composite action (`.github/actions/ai-reviewer/`), consumer workflow (`.github/workflows/review.yml`), PR comment + label side-effects, `ai-cr:review` retry trigger, `workflow_dispatch`, manual repo activation steps (labels, secret, branch protection).

**Out of scope:** any change to the reviewer's prompt/schema/logic, fork-PR support, automatic label creation, rate-limit retry/backoff, comment-update-in-place, dedicated action smoke tests, business-alignment/architectural-fit criteria, plan-vs-PR comparison review.

## Architecture / Approach

`review.yml` (triggers: `pull_request` opened/synchronize/reopened/labeled + `workflow_dispatch`) does standard setup — checkout with `fetch-depth: 0`, setup-node, `npm ci` — then calls `.github/actions/ai-reviewer/`, which does everything review-specific: compute the exclusion-filtered diff, feed PR title+description+diff into the unmodified `npm run review`, parse the JSON, translate `verdict: fail` into a failing step (the script's own exit code doesn't encode verdict — this translation is the one non-obvious piece), then post a comment and apply/clear labels via `gh` CLI.

## Phases at a Glance

| Phase                      | What it delivers                                                               | Key risk                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1. Diff computation        | Exclusion-filtered `git diff` + empty-diff detection                           | Git pathspec exclude syntax is easy to get subtly wrong                         |
| 2. Reviewer & verdict gate | Combined title/body/diff → `npm run review` → verdict-to-exit-code translation | Missing the exit-code translation silently turns "fail closed" into "fail open" |
| 3. Comment & labels        | PR comment + label apply/clear + retry-label consumption                       | `gh` CLI auth/permissions scoping                                               |
| 4. Consumer workflow       | `review.yml` wiring it all together                                            | Labeled-event trigger filtering (see Open Risks)                                |
| 5. Repo activation         | Labels, `GEMINI_API_KEY` secret, branch protection                             | Purely manual — easy to forget a step                                           |

**Prerequisites:** none blocking — all groundwork (reviewer, schema) already merged in M5L2.
**Estimated effort:** ~1 session across 5 phases; Phase 5 is a few manual commands/clicks, not code.

## Open Risks & Assumptions

- **Gemini rate limits under real CI volume** were never load-tested beyond "occasional local runs" (carried over from M5L2). A rate-limit hit will fail-closed and block a merge until someone retries via `ai-cr:review` — worth watching after the first few real PRs.
- **GitHub Actions "skipped checks satisfy required checks" quirk**: an unrelated label added to a PR fires the `labeled` trigger, and the job's runtime `if` filter (label ≠ `ai-cr:review`) makes that run report as "skipped" — which GitHub treats as passing for required-check purposes. In principle this could supersede a genuine `ai-cr:failed` conclusion on the same commit. Accepted as a low-severity residual risk given the same-repo/single-maintainer trust model; not engineered around, to avoid adding complexity requirements.md calls "purely mechanical."
- **Branch protection activation is manual** and easy to forget (already flagged in requirements.md) — Phase 5 makes this explicit, but there's no automated check that it actually happened.

## Success Criteria (Summary)

- Every PR to `main` gets a comment + label within one workflow run, with no changes needed to `scripts/review.ts`/`schema.ts`.
- A PR with a real `securitySafety` violation is blocked from merging once branch protection is enabled; fixing it and using `ai-cr:review` unblocks it.
- A lockfile-only PR passes automatically without ever calling Gemini.
