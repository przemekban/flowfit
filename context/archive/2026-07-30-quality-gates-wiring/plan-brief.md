# Quality-Gates Wiring — Plan Brief

> Full plan: `context/changes/quality-gates-wiring/plan.md`

## What & Why

`test-plan.md` §3 Phase 4 calls for locking unit+integration and critical-flow e2e into CI as **required merge gates**. The `ci` job already runs everything (lint, unit, integration, e2e, build) unconditionally, but `main` has zero branch protection today — nothing actually stops a merge or a direct push when that job is red. This change turns the existing pipeline into a real, enforced gate.

## Starting Point

`gh api repos/przemekban/flowfit/branches/main/protection` returns `404 Branch not protected`; no rulesets exist either. Recent CI runs are green and the project already works via PRs (#15, #16, #17), so enabling enforcement shouldn't break anything in flight. AGENTS.md and README.md both independently describe the CI pipeline inaccurately (wrong branch name `master`, and AGENTS.md falsely claims no test suite exists).

## Desired End State

`main` requires a pull request with an up-to-date, passing `ci` check before merge — including for the repo admin, with no approval count required. AGENTS.md and README.md accurately describe the pipeline and the gate. `test-plan.md`'s rollout is marked complete with a cookbook note for future reference.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Admin enforcement | No bypass (`enforce_admins: true`) | User confirmed a "required gate" should apply to everyone, including solo-maintainer direct pushes | Plan |
| Merge model | PR required, direct pushes blocked | GitHub's required-status-check setting alone doesn't block raw pushes — only a PR requirement does; user chose the real gate over convenience after this tradeoff was explained | Plan |
| Strict mode | Yes — branch must be up to date | Prevents merging a PR whose green run predates a since-landed change on `main` | Plan |
| Review requirement | None (0 required approvals) | Solo maintainer; GitHub blocks self-approval by default, so any approval count would lock the user out of their own merges | Plan |
| AGENTS.md fix | Full CI section rewrite | Removes a false claim ("no test suite") and documents the new gate in one pass | Plan |
| README.md fix | Also corrected (was outside change.md's original scope) | Same two staleness bugs (wrong branch, missing tests) existed independently; cheap to fix alongside AGENTS.md | Plan |

## Scope

**In scope:** GitHub branch protection config on `main`; AGENTS.md + README.md CI section rewrites; `test-plan.md` rollout close-out (§3, §5, §6, Freshness Ledger).

**Out of scope:** Changes to `.github/workflows/ci.yml` itself; splitting `ci` into multiple jobs; required-reviewer/CODEOWNERS approval; visual-diff/smoke-test gates (remain `optional` per §5).

## Architecture / Approach

Single external config change (GitHub branch protection via `gh api`) plus two doc rewrites plus one rollout-tracking doc update. No application code changes. The key technical nuance: `required_status_checks` alone only gates PR merges — blocking direct pushes requires the separate `required_pull_request_reviews` object (set to 0 required approvals) to be present in the same API call.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Branch protection enforcement | `main` requires `ci` to pass on an up-to-date PR; admin included | Wrong API payload silently produces a weaker (non-blocking) gate |
| 2. Documentation accuracy | AGENTS.md + README.md CI sections match reality | Low — pure doc edit |
| 3. Rollout status + cookbook sync | test-plan.md §3/§5/§6 closed out | Low — pure doc edit |

**Prerequisites:** `gh` CLI authenticated with admin rights on the repo (confirmed working during planning).
**Estimated effort:** ~1 session, 3 short phases.

## Open Risks & Assumptions

- Assumes the `gh` CLI session used for planning also has admin rights to write branch protection (only read access was exercised during planning — the PUT itself needs explicit confirmation at implementation time since it's a shared-infrastructure change).
- If a future change renames the `ci` job key or adds an explicit `name:` to it, the required-status-check context will silently stop matching and the gate will quietly stop blocking anything — flagged in the plan's Critical Implementation Details.

## Success Criteria (Summary)

- A PR against `main` cannot be merged while `ci` is red or the branch is behind `main`.
- A direct `git push` to `main` (including as admin) is rejected by GitHub.
- AGENTS.md and README.md no longer contain the false "no test suite" claim or the wrong `master` branch name.
