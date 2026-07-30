# Quality-Gates Wiring (Rollout Phase 4) Implementation Plan

## Overview

`test-plan.md` §3 Phase 4 calls for locking unit+integration and critical-flow e2e into CI as **required merge gates**. The `ci` job in `.github/workflows/ci.yml` already runs lint, `npm run test`, `npm run test:integration`, `npm run test:e2e`, and `npm run build` unconditionally — a failure already fails the job. What's missing is enforcement: `main` has **zero branch protection today**, so nothing stops a merge (or a direct push) when that job is red. This change configures GitHub branch protection to make the `ci` job an actual required status check, and corrects two docs that describe the CI pipeline inaccurately.

## Current State Analysis

- `gh api repos/przemekban/flowfit/branches/main/protection` → `404 Branch not protected`. `gh api repos/przemekban/flowfit/rulesets` → `[]`. There is no enforcement mechanism of any kind on `main` today.
- The repo is public (`gh repo view` → `visibility: PUBLIC`), so classic required-status-check branch protection is available on GitHub's free tier — no plan/billing blocker.
- Recent CI runs on `main` are green (`gh run list` — last 5 all `success`), and recent history is PR-based (#15, #16, #17 in git log), so enabling enforcement shouldn't retroactively break anything in flight.
- AGENTS.md's CI section and README.md's CI section are each independently stale: both say the workflow runs on push/PR to `` `master` `` (actual: `main`), and AGENTS.md additionally claims "No automated test suite is configured" (false — three test layers already run every time).

### Key Discoveries:

- `.github/workflows/ci.yml:13` — the job's key is `ci` with no explicit `name:` override, so the GitHub check-run/status-check context GitHub reports for it is literally the string `"ci"`. That is the exact context branch protection must reference.
- `.github/workflows/ci.yml:53-81` — the `deploy` job only runs on `push` to `main` after `ci` succeeds (`if: github.event_name == 'push' && github.ref == 'refs/heads/main'`); it never runs on a PR, so it cannot be used as a required PR status check and shouldn't be added as one.
- GitHub's required-status-checks setting only gates the **merge button on a PR**. It does not, by itself, block a direct `git push` to a protected branch. Blocking direct pushes requires the separate `required_pull_request_reviews` object to be present (it can require **0** approvals) — that's what actually turns on "Require a pull request before merging." This distinction is the crux of the decision the user confirmed: PR required, 0 approvals, enforced for admins too.
- `test-plan.md` §5 (lines 112-120) is the rollout's authoritative list of what "required" should mean for each gate; §3 Phase 4 (line 81) is the row this change closes out.

## Desired End State

- `main`'s branch protection requires the `ci` status check to pass, on an up-to-date branch, before a PR can merge; direct pushes to `main` (including by the repo admin) are blocked; no approving review count is required.
- AGENTS.md and README.md CI sections accurately describe the full pipeline (lint → unit → integration → e2e → build) and the enforced gate.
- `test-plan.md` §3 Phase 4 is marked `complete`, §5's gates table reflects real enforcement, and §6 gains a short cookbook note documenting the branch-protection config for future reference.

**Verification**: `gh api repos/przemekban/flowfit/branches/main/protection` returns the expected settings (Phase 1); the three doc files read accurately (Phases 2-3); a live PR shows the `ci` check as required and blocking (Phase 1 manual).

## What We're NOT Doing

- Not splitting the `ci` job into multiple jobs/workflows for granular per-layer status checks — the single-job design already fails atomically, matching §5's "the gate is the whole pipeline" framing. No change to `.github/workflows/ci.yml` itself.
- Not adding a required-reviewer/CODEOWNERS approval gate — solo maintainer today; revisit if a collaborator joins (captured in the §6.7 cookbook note added by this change).
- Not adding a pre-prod smoke test, deterministic visual diff, or multimodal visual review gate — those remain `optional` per §5 and are out of this rollout's scope.
- Not retroactively fixing the stale `context/changes/...` link in test-plan.md's Phase 3 row (it now points to an archived path) — pre-existing inconsistency from the archiving step, unrelated to this change.

## Implementation Approach

Phase 1 makes the actual GitHub-side change (branch protection is external, shared-infrastructure state — apply it deliberately and verify it stuck before moving on). Phases 2-3 are pure doc edits that depend on Phase 1 being real, so the docs describe what's actually enforced rather than what's merely intended.

## Critical Implementation Details

**API mechanics — PR requirement is a separate field from status checks.** Setting only `required_status_checks` + `enforce_admins` does **not** block a direct push to `main` — it only gates PR merges. To get the "no direct push" behavior the user chose, `required_pull_request_reviews` must be present in the PUT payload (with `required_approving_review_count: 0` to avoid requiring an actual approval). Omitting this object entirely would silently produce the weaker "check runs but doesn't gate" behavior that was explicitly rejected during planning.

**Naming coupling.** The required check context is the literal job key `ci` from `.github/workflows/ci.yml:13`. If a future change renames the job key or adds an explicit `name:` override, the check GitHub reports will change and the required-status-check rule will stop matching — silently reopening the gate (PRs would show no required check at all, not a failing one). Anyone touching that job's identity later needs to update branch protection in the same change.

## Phase 1: Branch protection enforcement

### Overview

Configure GitHub branch protection on `main` so the `ci` job is a required, strict, PR-only merge gate enforced for everyone including admins, with no approval count required.

### Changes Required:

#### 1. `main` branch protection (GitHub repo settings, not a repo file)

**Intent**: Turn the already-passing `ci` job into an actually-enforced merge gate, per the six decisions confirmed during planning (enforce for admins, PR required, strict, 0 approvals, applies to `main` only).

**Contract**: `PUT /repos/przemekban/flowfit/branches/main/protection` via `gh api`, with this body:

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [{ "context": "ci" }]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false
}
```

Apply with: `gh api --method PUT repos/przemekban/flowfit/branches/main/protection --input <(echo '<json above>')` (or a temp JSON file, since this shell is PowerShell — write the JSON to a scratch file and pass it via `--input path/to/file.json`). This is a shared-infrastructure change (GitHub repo settings) — confirm with the user immediately before running it, even though the exact payload was agreed during planning.

### Success Criteria:

#### Automated Verification:

- `gh api repos/przemekban/flowfit/branches/main/protection` returns HTTP 200 (not 404)
- Response JSON satisfies: `.required_status_checks.strict == true`, `.required_status_checks.checks[].context` contains `"ci"`, `.enforce_admins.enabled == true`, `.required_pull_request_reviews.required_approving_review_count == 0`, `.restrictions == null`, `.allow_force_pushes.enabled == false`, `.allow_deletions.enabled == false`

#### Manual Verification:

- In GitHub → repo Settings → Branches → the `main` protection rule, visually confirm: "Require a pull request before merging" checked (0 approvals), "Require status checks to pass" checked with `ci` listed, "Require branches to be up to date before merging" checked, "Do not allow bypassing the above settings" checked (admin enforcement), force-push/deletion left unchecked
- On the currently open PR (or the next PR opened against `main`), confirm the merge button shows `ci` as a required check and stays disabled until it reports success

---

## Phase 2: Documentation accuracy

### Overview

Rewrite AGENTS.md's and README.md's CI sections so they describe the real pipeline and the newly enforced gate, removing the false "no automated test suite" claim and the wrong `master` branch name from both files.

### Changes Required:

#### 1. AGENTS.md CI section

**File**: `AGENTS.md`

**Intent**: Replace the stale paragraph (wrong branch name, false "no test suite" claim, missing test/Supabase steps) with an accurate one that also documents the new branch-protection gate from Phase 1.

**Contract**: Replace the `## CI` section body. New text: "GitHub Actions (`.github/workflows/ci.yml`) runs on push and PR to `main`: `npm ci` → `astro sync` → `npm run lint` → `npm run test` (unit) → `npm run test:integration` (against a local Supabase instance) → `npm run test:e2e` (Playwright) → `npm run build`. The `ci` job is a required branch-protection status check on `main` — merging requires an up-to-date PR with a passing `ci` run; direct pushes to `main` are blocked, including for admins. A separate `deploy` job runs after `ci` succeeds on push to `main`."

#### 2. README.md CI section

**File**: `README.md`

**Intent**: Same staleness fix (branch name, missing test steps) plus documenting the enforced gate, matching AGENTS.md's accuracy.

**Contract**: Replace the `## CI` section body. New text: "GitHub Actions (`.github/workflows/ci.yml`) runs lint, the full test suite (unit, integration, e2e), and build on every push and PR to `main`. The `ci` job is a required status check — merging into `main` requires a pull request with an up-to-date, passing `ci` run (no direct pushes). Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets in GitHub for the build step."

### Success Criteria:

#### Automated Verification:

- `rg -i "no automated test suite" AGENTS.md` returns no matches
- `rg '`master`' AGENTS.md README.md` returns no matches
- `npm run format` reports no pending changes on `AGENTS.md` or `README.md` (stays Prettier-clean)

#### Manual Verification:

- Read both updated CI sections end-to-end; confirm they match what Phase 1 actually configured (branch name, pipeline order, PR/enforcement wording)

---

## Phase 3: Rollout status + cookbook sync

### Overview

Close out the rollout in `test-plan.md`: mark §3 Phase 4 complete, update §5's gates table to reflect real enforcement, add a §6 cookbook note capturing the branch-protection config for future reference, and bump the Freshness Ledger.

### Changes Required:

#### 1. `test-plan.md` §3 Phase 4 row

**File**: `context/foundation/test-plan.md`

**Intent**: Record that this rollout phase shipped.

**Contract**: In the §3 table (line 81), change the Phase 4 row's Status cell from `not started` to `complete` and the Change folder cell from `—` to `` `context/changes/quality-gates-wiring/` ``.

#### 2. `test-plan.md` §5 Quality Gates table

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the now-inaccurate "already wired" / "required after §3 Phase 1" language with the real enforcement mechanism now that branch protection exists.

**Contract**: In the §5 table (lines 112-120), update the "Required?" cell for the `lint + typecheck`, `unit + integration`, and `e2e on critical flows` rows to: `required — enforced via ``main`` branch protection (§3 Phase 4)`.

#### 3. `test-plan.md` §6 cookbook note

**File**: `context/foundation/test-plan.md`

**Intent**: Give a future contributor (or rollout `--refresh`) a pointer to how the gate is configured without re-deriving it.

**Contract**: Add a new `### 6.7 Configuring/verifying the branch-protection gate` subsection under §6, referencing: the required check context name (`ci`, tied to the job key in `.github/workflows/ci.yml:13`), the verification command (`gh api repos/przemekban/flowfit/branches/main/protection`), and this change's `plan.md` Phase 1 for the full config payload if the rule ever needs to be recreated.

#### 4. Freshness Ledger

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that §5 changed today.

**Contract**: Update the "Strategy (§1–§5) last reviewed" line in §8 to today's date.

### Success Criteria:

#### Automated Verification:

- `rg '^\| 4 ' context/foundation/test-plan.md` — the Phase 4 row shows `complete` in the Status column
- `rg '6\.7' context/foundation/test-plan.md` — the new cookbook subsection heading is present
- `npm run format` reports no pending changes on `context/foundation/test-plan.md`

#### Manual Verification:

- Read the updated §5 table and §6.7 note; confirm the wording accurately matches the branch-protection config actually applied in Phase 1

---

## Testing Strategy

This change has no application code and therefore no unit/integration/e2e tests of its own. "Testing" here means verifying the GitHub-side configuration and doc accuracy, covered by each phase's Automated/Manual Verification above — most importantly Phase 1's live check against `gh api .../protection` and a real PR's merge-button behavior.

## Performance Considerations

None — no runtime code changes.

## Migration Notes

None — no data, no schema changes. The change is additive GitHub repo configuration; it can be reverted by deleting the branch protection rule (`gh api --method DELETE repos/przemekban/flowfit/branches/main/protection`) if it ever needs to be rolled back.

## References

- Rollout definition: `context/foundation/test-plan.md` §3 (line 81), §5 (lines 112-120)
- Prior phase's closing-sync pattern: `context/archive/2026-07-30-testing-ai-generation-safety-net-and-route-guard/plan.md` (Cookbook + rollout status sync step)
- CI workflow: `.github/workflows/ci.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Branch protection enforcement

#### Automated

- [x] 1.1 `gh api .../branches/main/protection` returns 200 with expected settings — 773cdc5

#### Manual

- [x] 1.2 GitHub Settings → Branches rule visually matches intended config — 773cdc5
- [x] 1.3 Live PR shows `ci` as a required, blocking check — 773cdc5

### Phase 2: Documentation accuracy

#### Automated

- [x] 2.1 No "no automated test suite" string remains in AGENTS.md — 773cdc5
- [x] 2.2 No stale `` `master` `` reference remains in AGENTS.md or README.md — 773cdc5
- [x] 2.3 `npm run format` clean on both files — 773cdc5

#### Manual

- [x] 2.4 Both CI sections read accurately end-to-end — 773cdc5

### Phase 3: Rollout status + cookbook sync

#### Automated

- [x] 3.1 Phase 4 row in test-plan.md §3 shows `complete` — 773cdc5
- [x] 3.2 §6.7 cookbook subsection present — 773cdc5
- [x] 3.3 `npm run format` clean on test-plan.md — 773cdc5

#### Manual

- [x] 3.4 §5 table and §6.7 note match the real Phase 1 config — 773cdc5
