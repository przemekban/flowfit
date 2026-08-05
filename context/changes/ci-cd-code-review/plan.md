# CI/CD Automated PR Code Review — Implementation Plan

## Overview

Wrap the existing local reviewer (`scripts/review.ts` + `scripts/review/schema.ts`, built in M5L2) in a GitHub Actions composite action and a thin consumer workflow, so every PR to `main` gets an automated 5-criteria review, a PR comment with the summary, a `ai-cr:passed`/`ai-cr:failed` label, and — once branch protection is turned on — a hard, merge-blocking required status check. No changes to the reviewer's prompt, schema, or logic; this is CI wiring only.

## Current State Analysis

- `scripts/review.ts` is a standalone Node/tsx script (decoupled from the Astro app, no `astro:env` dependency) that reads a full diff from stdin, calls Gemini via `ToolLoopAgent` + `Output.object({ schema: REVIEW_SCHEMA })`, and prints the resulting JSON to stdout. It exits 1 on missing `GEMINI_API_KEY`, empty stdin, or any thrown error — but exits **0** whenever it successfully produces a JSON review, _including_ `verdict: "fail"` (`scripts/review.ts:33-52`).
- `scripts/review/schema.ts` defines `REVIEW_SCHEMA` (5 scored criteria + `verdict` + `summary`) and `SYSTEM_PROMPT`, already aligned with `requirements.md`'s criteria — no further changes needed for this change.
- `package.json:16-17` — `npm run review` (stdin → tsx script) and `npm run review:sample` (fixture-diff variant) already exist.
- `.github/workflows/ci.yml` is the only workflow in the repo; no `.github/actions/` composite actions, no `actions/github-script`/octokit/`gh` CLI usage anywhere, no labels config. This change introduces all of that for the first time.
- `GEMINI_API_KEY` exists in `.env.example` and in `astro.config.mjs`'s `astro:env` schema (app-runtime only) — the CI path bypasses `astro:env` entirely and just needs the key injected via a new `secrets.GEMINI_API_KEY` repo secret into `process.env`.
- Repo is `przemekban/flowfit`, single-maintainer / same-repo-branches trust model (confirmed during planning) — no fork-PR support needed.

## Desired End State

Opening or updating a PR to `main` triggers `.github/workflows/review.yml`, which runs `.github/actions/ai-reviewer/` end to end: compute the diff against `main` (excluding lockfiles), run the existing reviewer, post a PR comment with `review.summary`, apply the matching `ai-cr:passed`/`ai-cr:failed` label, and fail the job (blocking merge once branch protection is enabled) when `verdict: "fail"`. Adding the `ai-cr:review` label to a PR triggers a fresh run and consumes (removes) the label. `workflow_dispatch` allows a manual run.

Verification: open a real PR against `main` with an intentional violation (e.g. a new API route missing `export const prerender = false`) and confirm a comment appears, `ai-cr:failed` is applied, and the job fails; then fix it and confirm `ai-cr:review` retriggers a passing run with `ai-cr:passed` and no `ai-cr:failed` label.

### Key Discoveries:

- `scripts/review.ts:46-47` prints the review JSON as the **last line of stdout** via `console.log(JSON.stringify(review, null, 2))` after any tool-loop step logging — the action must capture this reliably (see Phase 2 contract).
- `scripts/review.ts`'s own exit code does not encode `verdict` — a successful `fail` review is exit 0. The composite action, not the script, is responsible for turning `verdict: "fail"` into a failing step.
- `scripts/review/sample-diff.txt` confirms the script expects raw unified-diff text on stdin with no preprocessing, so the exclusion-filtered `git diff` output can be piped straight in.

## What We're NOT Doing

- No changes to `scripts/review.ts`, `scripts/review/schema.ts`, `SYSTEM_PROMPT`, or `REVIEW_SCHEMA`.
- No fork-PR support (`pull_request_target`, untrusted-checkout handling) — same-repo branches only, per the trust-model decision made during planning.
- No idempotent/automatic label creation in the workflow — labels are created manually (Phase 5), by user's explicit choice.
- No retry-with-backoff or fail-open behavior for Gemini rate limits/errors — fail closed, matching the "hard gate from day one" requirement; a stuck PR is unblocked via the `ai-cr:review` retry label.
- No comment-update-in-place logic — every run posts a new PR comment.
- No dedicated smoke-test workflow/job for the composite action itself.
- No business-alignment or architectural-fit review criteria, no plan-review (comparing PR against `context/changes/<id>/plan.md`) — parked per `requirements.md`.
- No automation for enabling the required-status-check branch protection setting — documented manual step, same as the existing `ci` check.

## Implementation Approach

Build outside-in within the action: diff computation first (Phase 1, independently testable via `workflow_dispatch`), then the reviewer invocation and verdict-to-exit-code translation (Phase 2), then the GitHub side-effects — comment and labels (Phase 3) — each of which depends on the previous phase's output. The consumer workflow (Phase 4) is added last since it's the thin wrapper that only makes sense once the action itself is complete. Repository activation (Phase 5) is manual/non-code and happens after Phase 4 is merged and has run at least once successfully.

## Critical Implementation Details

### Security model / trigger semantics

Same-repo-only means the plain `pull_request` event is sufficient — secrets are available normally, no `pull_request_target` or untrusted-checkout handling is needed. Do not add fork-PR handling; it's explicitly out of scope.

One residual GitHub Actions platform quirk to know about, not to engineer around: because `on.pull_request` can't filter the `labeled` trigger by label _name_ (only by event type), the job's `if` condition (Phase 4) must check `github.event.label.name == 'ai-cr:review'` at runtime. When a PR gets an unrelated label added (e.g. `documentation`), the job's `if` evaluates false and GitHub records that run's conclusion as "skipped" — and GitHub treats "skipped" as satisfying a required status check. In principle this means an unrelated label-add could supersede a genuine `ai-cr:failed` run's conclusion for the same commit. This is a known, low-severity GitHub Actions limitation, not a bug to fix here: given the same-repo/single-maintainer trust model already established, it's an accepted residual risk (documented in the plan brief), not a reason to add extra guarding logic.

### State sequencing: verdict vs. exit code

`npm run review` exits 0 for a successful `verdict: "fail"` result — only a crash/misconfiguration exits 1. Phase 2's step must explicitly parse the JSON output, check `.verdict`, and exit non-zero itself when it's `"fail"`. Without this, "fail closed" silently becomes "fail open" — the required check would report green on every review the model correctly flagged as failing.

### User experience spec: label clearing

When applying `ai-cr:passed`, the action must also remove `ai-cr:failed` if present (and vice versa), so a PR's label always reflects only the _latest_ review outcome — otherwise a PR that failed once and later passes after fixes ends up wearing both labels simultaneously, which is confusing on the PR list view.

## Phase 1: Composite action — diff computation

### Overview

Scaffold `.github/actions/ai-reviewer/action.yml` and compute the exclusion-filtered diff against `main`, detecting the empty-after-exclusion case for the auto-pass path used in later phases.

### Changes Required:

#### 1. Composite action scaffold + diff step

**File**: `.github/actions/ai-reviewer/action.yml`

**Intent**: Define the composite action's inputs (`github-token`, `gemini-api-key`), and a first step that computes the diff between `main` and the current ref, excluding `package-lock.json` and `skills-lock.json`, writing the result to a file (not a step output — diffs can exceed GitHub's step-output size limit) and exposing an `empty` boolean step output for downstream conditionals.

**Contract**: `runs: using: "composite"`, `steps:` list beginning with a `shell: bash` step. Diff computed with git pathspec exclusion magic:

```bash
git diff origin/main...HEAD -- . ':(exclude)package-lock.json' ':(exclude)skills-lock.json' > "$RUNNER_TEMP/pr.diff"
```

Step sets `empty=true|false` via `$GITHUB_OUTPUT` based on whether the resulting file is non-empty. The action assumes the calling workflow already ran `actions/checkout@v4` with `fetch-depth: 0` (per requirements.md) — checkout does not belong inside the action itself, to keep it a pure "given a checked-out repo" unit.

### Success Criteria:

#### Automated Verification:

- `action.yml` is valid composite-action YAML (no schema errors on push — GitHub validates on parse)

#### Manual Verification:

- Manually trigger `workflow_dispatch` (once Phase 4's workflow exists) against a branch with real changes and confirm the diff file is populated correctly, excluding lockfile-only hunks
- Confirm a PR touching only `package-lock.json` produces `empty=true`

---

## Phase 2: Composite action — run reviewer & verdict gate

### Overview

Feed PR title, description, and the Phase 1 diff into the unmodified `npm run review`, parse its JSON output, and translate `verdict: "fail"` into a failing step — the fix for the exit-code gap described in Critical Implementation Details.

### Changes Required:

#### 1. Reviewer invocation step

**File**: `.github/actions/ai-reviewer/action.yml`

**Intent**: When Phase 1's diff is non-empty, build a single combined text payload — PR title, PR description, then the diff — and pipe it into `npm run review` (so `scripts/review.ts` needs no changes), capturing stdout to a file. When the diff is empty, skip this step entirely (`if:` conditioned on Phase 1's `empty` output) — this is the auto-pass path.

**Contract**: `env: GEMINI_API_KEY: ${{ inputs.gemini-api-key }}`. Combined payload construction and invocation:

```bash
{ echo "PR Title: $PR_TITLE"; echo; echo "PR Description:"; echo "$PR_BODY"; echo; echo "git diff:"; cat "$RUNNER_TEMP/pr.diff"; } | npm run review > "$RUNNER_TEMP/review.json"
```

(`PR_TITLE`/`PR_BODY` sourced from `github.event.pull_request.title`/`.body`, passed in as env vars from the calling workflow step — `npm run review`'s own stdout wrapping means `review.json` must be parsed for the JSON object, not treated as raw JSON if the `npm run` banner is included; use `tsx scripts/review.ts` directly instead of `npm run review` to avoid npm's own log noise polluting stdout.)

#### 2. Verdict-to-exit-code translation

**File**: `.github/actions/ai-reviewer/action.yml`

**Intent**: Parse `$RUNNER_TEMP/review.json`, expose `verdict` and `summary` as step outputs for Phase 3, and fail this step (non-zero exit) when `verdict == "fail"` — after the outputs are set, so Phase 3's comment/label step still runs (composite action steps after a failed step are skipped by default, so this ordering matters: set outputs and post comment/label _before_ the intentional failure, or use `if: always()` on the downstream steps).

**Contract**: A step output `verdict` (`pass`/`fail`) and `summary` (raw markdown string, needs safe multiline handling via `$GITHUB_OUTPUT`'s heredoc delimiter syntax). The empty-diff path (Phase 1) sets `verdict=pass` and a fixed summary directly, bypassing this step.

### Success Criteria:

#### Automated Verification:

- N/A — no unit-testable logic outside real Actions runtime; validated manually per below

#### Manual Verification:

- Trigger a run against a diff with an intentional `securitySafety` violation (e.g. a hard-coded secret) and confirm the step fails with `verdict=fail` in its output
- Trigger a run against a clean diff and confirm the step succeeds with `verdict=pass`
- Confirm PR title/description text actually reaches the model (spot-check `review.summary` references content only present in the description, not the diff)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Composite action — PR comment & labels

### Overview

Post `review.summary` as a new PR comment and apply the matching `ai-cr:passed`/`ai-cr:failed` label (clearing the opposite one), consuming (removing) the `ai-cr:review` retry label when present — using `gh` CLI, matching the only existing `gh` usage convention in this repo (`context/foundation/tasks-github.md`).

### Changes Required:

#### 1. Comment step

**File**: `.github/actions/ai-reviewer/action.yml`

**Intent**: Post a new PR comment containing `review.summary` (from Phase 2's output, or the fixed auto-pass summary from Phase 1's empty-diff path). Always posts fresh — no find-and-update logic.

**Contract**: `gh pr comment "$PR_NUMBER" --body "$SUMMARY"`, authenticated via `GITHUB_TOKEN` env var sourced from `inputs.github-token`. Runs with `if: always()` so it executes even though Phase 2's verdict-gate step may have intentionally failed.

#### 2. Label step

**File**: `.github/actions/ai-reviewer/action.yml`

**Intent**: Apply `ai-cr:passed` (and remove `ai-cr:failed` if present) on a passing verdict, or the reverse on a failing verdict. If the triggering event was a `labeled` event with `ai-cr:review`, remove that label too (consume-and-remove).

**Contract**: `gh pr edit "$PR_NUMBER" --add-label "ai-cr:$VERDICT_LABEL" --remove-label "ai-cr:$OPPOSITE_LABEL"`, plus a conditional `gh pr edit "$PR_NUMBER" --remove-label "ai-cr:review"` gated on `github.event.action == 'labeled' && github.event.label.name == 'ai-cr:review'`. Runs with `if: always()`, same reasoning as the comment step.

### Success Criteria:

#### Automated Verification:

- N/A — GitHub-side-effect logic, validated manually

#### Manual Verification:

- Confirm a new PR comment appears with the exact `review.summary` content
- Confirm the correct label is applied and the opposite one removed on a verdict flip (fail → fix → pass)
- Add the `ai-cr:review` label to a PR manually and confirm it's removed automatically after the retry run completes

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Consumer workflow (`review.yml`)

### Overview

The thin, readable workflow that triggers the action: standard repo setup (checkout, setup-node, npm ci) plus the trigger/permission/secret wiring the action depends on.

### Changes Required:

#### 1. Workflow file

**File**: `.github/workflows/review.yml`

**Intent**: Trigger on `pull_request` (`types: [opened, synchronize, reopened, labeled]`, `branches: [main]`) and `workflow_dispatch`. Gate the job so only relevant events run the review (always for opened/synchronize/reopened/workflow_dispatch; only when `label.name == 'ai-cr:review'` for `labeled` events — see Critical Implementation Details for the accepted residual risk here). Mirror `ci.yml`'s existing `actions/checkout@v4` (with `fetch-depth: 0`, required by Phase 1) + `actions/setup-node@v4` (node 22, npm cache) + `npm ci` steps, then invoke `.github/actions/ai-reviewer/` with `github-token: ${{ github.token }}` and `gemini-api-key: ${{ secrets.GEMINI_API_KEY }}`.

**Contract**: Job name `ai-code-review` (this becomes the required-status-check context name in Phase 5). `permissions: pull-requests: write` (comment + label operations both live under this scope for `gh pr` subcommands). Job-level `if`:

```yaml
if: github.event_name != 'pull_request' || github.event.action != 'labeled' || github.event.label.name == 'ai-cr:review'
```

`PR_TITLE`/`PR_BODY` passed to the action invocation step as env vars from `github.event.pull_request.title`/`.body` (only present on `pull_request` events — `workflow_dispatch` runs won't have PR context to comment/label against, so the comment/label steps inside the action should also tolerate a missing `PR_NUMBER` by skipping gracefully, e.g. `if: github.event.pull_request.number != ''`-style guards already implicit in the action's `if: always()` steps reading an empty `PR_NUMBER`).

### Success Criteria:

#### Automated Verification:

- Workflow file passes GitHub's own YAML validation on push (workflow appears correctly in the Actions tab, no "invalid workflow file" error)
- Existing `npm run lint` / `npm run test` continue to pass unaffected (no source files touched)

#### Manual Verification:

- Open a real PR to `main`; confirm the `ai-code-review` job appears in the PR's checks list and completes (pass or fail matching the diff's actual content)
- Push an additional commit to the same PR (`synchronize`) and confirm a fresh run fires
- Manually run via `workflow_dispatch` from the Actions tab and confirm it completes without a PR context error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Repository activation (manual, non-code)

### Overview

One-time repo configuration that has to happen for the workflow to function and to become a real merge gate — labels, secret, and branch protection. Documented here as exact steps/commands since these were explicitly chosen as manual (not automated) during planning.

### Changes Required:

#### 1. Create labels

**Intent**: Create the three labels the workflow applies/consumes, since label creation was explicitly chosen as a manual step rather than idempotent in-workflow creation.

**Contract**: Run once, before the workflow's first PR run:

```bash
gh label create "ai-cr:passed" --color 2ea44f --description "AI code review: passed" --repo przemekban/flowfit
gh label create "ai-cr:failed" --color d73a4a --description "AI code review: failed" --repo przemekban/flowfit
gh label create "ai-cr:review" --color 0e8a16 --description "Trigger an AI code review retry" --repo przemekban/flowfit
```

#### 2. Add `GEMINI_API_KEY` repo secret

**Intent**: Make the key available to the workflow via `secrets.GEMINI_API_KEY`, matching the existing secret-naming convention (`SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDFLARE_*` in `ci.yml`).

**Contract**: `gh secret set GEMINI_API_KEY --repo przemekban/flowfit` (value from the local `.env`), or via GitHub repo Settings → Secrets and variables → Actions.

#### 3. Enable required status check

**Intent**: After Phase 4's workflow has run successfully at least once on a PR (so `ai-code-review` appears as a known check context), turn on branch protection enforcement — same manual step already required for the existing `ci` check, per `AGENTS.md`.

**Contract**: GitHub repo Settings → Branches → branch protection rule for `main` → add `ai-code-review` to "Require status checks to pass before merging."

### Success Criteria:

#### Automated Verification:

- N/A — repository configuration, not code

#### Manual Verification:

- `gh label list --repo przemekban/flowfit` shows all three `ai-cr:*` labels
- A PR opened after this phase shows the AI review comment, correct label, and (once branch protection is enabled) merging is actually blocked when `ai-code-review` fails

---

## Testing Strategy

### Unit Tests:

- None — no application code is touched; `scripts/review.ts`/`schema.ts` are unmodified and already covered by M5L2's own scope.

### Integration Tests:

- None automated (per the "no dedicated smoke test" decision) — Phase 2/3/4's manual verification steps serve as the end-to-end integration check, run against real PRs.

### Manual Testing Steps:

1. Open a PR with an intentional `securitySafety` violation (e.g. a leaked-looking token string) → confirm comment, `ai-cr:failed`, job failure.
2. Push a fix to the same PR → confirm a new run, new comment, `ai-cr:passed`, `ai-cr:failed` removed.
3. Add `ai-cr:review` to a passing PR → confirm a fresh run triggers and the label is removed afterward.
4. Open a PR touching only `package-lock.json` → confirm auto-pass path (no Gemini call, immediate `ai-cr:passed`).
5. Run `workflow_dispatch` manually → confirm it completes without erroring on missing PR context.

## Performance Considerations

None beyond the already-flagged open risk: Gemini free-tier rate limits under real CI volume (every push + every retry) were never load-tested — see Open Risks in the plan brief.

## Migration Notes

Not applicable — new workflow, no existing data or behavior to migrate.

## References

- Related research: `context/changes/ci-cd-code-review/research.md`
- Reviewer engine: `scripts/review.ts`, `scripts/review/schema.ts`
- Pattern to mirror: `.github/workflows/ci.yml:16-21` (checkout/setup-node/npm ci)
- Prior M5L2 plan (CI explicitly deferred from there to here): `context/archive/2026-08-04-code-review-agent/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Composite action — diff computation

#### Automated

- [x] 1.1 `action.yml` is valid composite-action YAML

#### Manual

- [ ] 1.2 Diff file correctly excludes lockfile-only hunks
- [ ] 1.3 Lockfile-only PR produces `empty=true`

### Phase 2: Composite action — run reviewer & verdict gate

#### Manual

- [ ] 2.1 Intentional violation diff produces `verdict=fail` and a failing step
- [ ] 2.2 Clean diff produces `verdict=pass` and a succeeding step
- [ ] 2.3 PR title/description content reaches the model (visible in `review.summary`)

### Phase 3: Composite action — PR comment & labels

#### Manual

- [ ] 3.1 New PR comment appears with exact `review.summary` content
- [ ] 3.2 Correct label applied and opposite label removed on verdict flip
- [ ] 3.3 `ai-cr:review` label removed automatically after retry run

### Phase 4: Consumer workflow (`review.yml`)

#### Automated

- [x] 4.1 Workflow file passes GitHub's YAML validation
- [x] 4.2 `npm run lint` / `npm run test` unaffected

#### Manual

- [ ] 4.3 `ai-code-review` job appears and completes on a real PR
- [ ] 4.4 New commit to PR triggers a fresh run
- [ ] 4.5 `workflow_dispatch` completes without a PR-context error

### Phase 5: Repository activation (manual, non-code)

#### Manual

- [ ] 5.1 All three `ai-cr:*` labels exist (`gh label list`)
- [ ] 5.2 Post-activation PR shows comment + label, and merge is blocked on `ai-code-review` failure
