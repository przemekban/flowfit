# promptfoo Eval Matrix for scripts/review.ts — Plan Brief

> Full plan: `context/changes/code-review-evals/plan.md`
> Research: `context/changes/code-review-evals/research.md`

## What & Why

Add a `promptfoo` eval that runs the existing PR-review agent's exact prompt/schema across 2-3 Gemini model tiers, so we can compare review quality across models without duplicating the prompt or the agent logic. Reuses the already-committed `scripts/review/sample-diff.txt` fixture (which has an intentional gap: an unvalidated discount-application path) as the sole test case, with an LLM-as-judge check that the review actually names the gap, plus a static check that the flawed diff gets `verdict: "fail"`.

## Starting Point

`scripts/review.ts` hardcodes `GEMINI_MODEL` as a module constant and isn't importable without triggering its CLI side effects (stdin read, `process.exit`) on module load. No eval framework, no `promptfoo` dependency, and no eval tests exist today. `sample-diff.txt` is the only fixture in the repo.

## Desired End State

`npm run review:eval` runs the same review prompt against 3 Gemini tiers, printing a side-by-side comparison table. Each model's result is checked against a static verdict assertion and an LLM-judge assertion. `scripts/review.ts`'s CLI behavior and CI's `ai-reviewer` action are untouched.

## Key Decisions Made

| Decision              | Choice                                                      | Why (1 sentence)                                                                                                                           | Source |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Model set             | Gemini family only, 3 tiers (`flash-lite`, `flash`, `pro`)  | Preserves the project's recorded $0 AI-provider budget constraint; one provider package, one API key.                                      | Plan   |
| LLM-judge model       | Same Gemini family, custom JS assertion                     | Stays within budget/single-provider setup; avoids a new OpenAI-key dependency that promptfoo's built-in `llm-rubric` would default to.     | Plan   |
| Production seam       | Export + parameterize `reviewDiff(diff, apiKey, model)`     | Eval exercises the real production code path (zero drift risk) instead of a duplicated agent-construction stub.                            | Plan   |
| CI scope              | Local/manual only — no workflow changes                     | Matches the change's stated goal (compare models); avoids new CI secrets and reporting design work.                                        | Plan   |
| Node version          | Bump `.nvmrc` to `22.22.0`                                  | Satisfies promptfoo's floor for local dev; CI already resolves above it via generic `node-version: 22`.                                    | Plan   |
| Assertion granularity | Verdict + LLM-judge only, no per-criterion score assertions | `REVIEW_SCHEMA` scores are deliberately unconstrained (no `.min()/.max()`); per-model score values are expected to vary even when correct. | Plan   |
| Test fixtures         | Reuse `sample-diff.txt` only, no new fixtures               | Explicit scope from the change request.                                                                                                    | Plan   |

## Scope

**In scope:**

- Export/parameterize `reviewDiff()`, guard its CLI entrypoint against import side effects
- `promptfoo` devDependency, custom TS provider, LLM-judge assertion, config
- `npm run review:eval` script, `.nvmrc` bump, short usage note

**Out of scope:**

- New diff fixtures beyond `sample-diff.txt`
- Cross-vendor models (OpenAI/Anthropic)
- CI wiring (workflow, schedule, PR-comment reporting)
- Per-criterion score assertions
- New unit tests for `scripts/review.ts`

## Architecture / Approach

A `scripts/review/eval/` directory holds the eval-specific files (provider, judge assertion, config), all importing from the production `scripts/review.ts`/`schema.ts` rather than reimplementing prompt or agent logic. The custom promptfoo provider calls the real `reviewDiff()` per model tier; a custom judge assertion (same Gemini family) grades gap-identification; a static assertion checks the verdict. Nothing here touches the CI-facing `ai-reviewer` composite action.

## Phases at a Glance

| Phase                       | What it delivers                                                                               | Key risk                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. Open the production seam | Exported/parameterized `reviewDiff`, guarded CLI entrypoint, `.nvmrc` bump                     | Guard logic must not break existing CLI/CI invocation (`ai-reviewer` action)               |
| 2. promptfoo eval matrix    | `promptfoo` dependency, custom provider, judge assertion, config wiring 3 models + 1 test case | Custom TS provider/assertion contracts are promptfoo-specific and easy to get subtly wrong |
| 3. Wire up and document     | `npm run review:eval` script, short usage note                                                 | None significant                                                                           |

**Prerequisites:** `GEMINI_API_KEY` in local `.env` (already required for `npm run review`); Node `>=22.22.0` locally after the `.nvmrc` bump.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Exact `promptfoo` custom-provider/assertion file-loading conventions (`file://` resolution, TS support) are taken from documentation cited in `research.md`, not yet live-verified in this repo — Phase 2's automated `promptfoo validate` step is the first real check.
- The `gemini-3.1-flash-lite`/`-flash`/`-pro` tier names follow the fictional Gemini 3.1 family naming already established elsewhere in this codebase (`src/lib/services/plan.ts`); no other tier names appear anywhere else in the repo to cross-check against.
- Judge quality (same-family model grading another same-family model) may share blind spots — flagged during questioning as an accepted tradeoff for staying in-budget.

## Success Criteria (Summary)

- `npm run review:eval` runs the same review prompt against 3 Gemini models and renders a comparison table.
- The known-flawed `sample-diff.txt` gets `verdict: "fail"` from every model, and the LLM-judge confirms each review's summary actually names the discount-validation gap (not just a lucky verdict).
- `npm run review`, `npm run review:sample`, and the CI `ai-reviewer` action behave exactly as before.
