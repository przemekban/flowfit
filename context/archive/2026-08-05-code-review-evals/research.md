---
date: 2026-08-05T20:48:23+02:00
researcher: Claude (10x-research)
git_commit: d38fb76e5281f1e849941cd7ac768391231d153a
branch: main
repository: przemekban/flowfit
topic: "Eval matrix for scripts/review.ts — promptfoo fit vs OSS alternatives"
tags: [research, codebase, eval, promptfoo, scripts-review, ci-cd]
status: complete
last_updated: 2026-08-05
last_updated_by: Claude (10x-research)
---

# Research: Eval matrix for scripts/review.ts — promptfoo fit vs OSS alternatives

**Date**: 2026-08-05T20:48:23+02:00
**Researcher**: Claude (10x-research)
**Git Commit**: d38fb76e5281f1e849941cd7ac768391231d153a
**Branch**: main
**Repository**: przemekban/flowfit

## Research Question

Analyze the current state of `scripts/review.ts` and `scripts/review/schema.ts` in the context of potential eval introduction — reusability of prompts, importability of agent, etc. Promptfoo is the first pick for eval toolkit; if the tech stack aligns, go in that direction. Otherwise, analyze other OSS tools.

## Summary

`scripts/review.ts` is a small, self-contained CLI: it reads a diff on stdin, feeds it to a Vercel AI SDK `ToolLoopAgent` wired to `@ai-sdk/google`'s Gemini provider, and validates the structured output against a zod schema (`REVIEW_SCHEMA`) exported from `scripts/review/schema.ts`. The model (`gemini-3.1-flash-lite`) and criteria weighting are effectively hardcoded — there is no seam today for swapping models or running the same prompt across several of them. **Promptfoo is a workable fit.** Its `providers` array gives a native, zero-reimplementation model-comparison matrix, and it has an official GitHub Action for posting results to PRs — which matches the pattern this repo already uses (`.github/actions/ai-reviewer/action.yml` posts a `| Criterion | Score |` table). But reusing the _actual_ agent code and the zod schema is not automatic: it requires (a) a custom TypeScript `file://` provider that calls the existing `ToolLoopAgent`/`generate()` path, and (b) a custom `javascript` assertion that imports `REVIEW_SCHEMA` and maps its 5 scores + verdict into promptfoo's `GradingResult`. That wrapper burden is not unique to promptfoo — every alternative surveyed (evalite, vitest-evals, hand-rolled Vitest) requires the same kind of adapter, since none of them have native Vercel-AI-SDK or zod integration. The one promptfoo-specific friction point is a **Node version floor**: promptfoo requires Node `^20.20.0` or `>=22.22.0`, while this repo's `.nvmrc` pins `22.14.0` (below that floor) — CI is unaffected since its `setup-node` step requests generic `node-version: 22` (resolves to a current 22.x that satisfies promptfoo), but local `npm run`-style usage via nvm would need `.nvmrc` bumped.

**Recommendation**: proceed with promptfoo. It's aligned with the stack, has zero unit-test coverage today to protect, and its native matrix/CI-reporting story is the strongest of the options surveyed. Treat the custom provider + custom assertion as the real implementation work, and bump `.nvmrc` (or confirm CI's resolved Node version) as part of the change.

## Detailed Findings

### `scripts/review.ts` — current shape

- Reads the full diff from stdin (`readStdin`, [scripts/review.ts:7-13](scripts/review.ts#L7-L13)).
- Builds a fresh `ToolLoopAgent` per call inside `reviewDiff()` ([scripts/review.ts:15-31](scripts/review.ts#L15-L31)): `model: google(GEMINI_MODEL)`, `instructions: SYSTEM_PROMPT`, `tools: {}`, `output: Output.object({ schema: REVIEW_SCHEMA })`, `stopWhen: isStepCount(2)`.
- `GEMINI_MODEL = "gemini-3.1-flash-lite"` is a **module-level constant** ([scripts/review.ts:5](scripts/review.ts#L5)) — not a parameter, env var, or CLI flag. This is the seam that would need to open up for any model-comparison eval to run the same code path against multiple models.
- API key comes from `process.env.GEMINI_API_KEY`, read directly in the top-level script body ([scripts/review.ts:40-44](scripts/review.ts#L40-L44)) — fine for a Node CLI script (this is not server request code subject to the `astro:env/server` rule, which governs the Astro app itself).
- Output is `console.log(JSON.stringify(review, null, 2))` ([scripts/review.ts:47](scripts/review.ts#L47)) — a single JSON object matching `REVIEW_SCHEMA`, already the shape any eval assertion would grade against.
- Both `reviewDiff()` and the module are straightforward to import: `reviewDiff` is a plain async function taking `(diff, apiKey)` and returning `Promise<Review>`. It is not currently exported, but the change would just need `export` added — no framework coupling, no top-level side effects beyond the `try { ... }` block at the bottom of the file, which runs the CLI flow unconditionally when the module loads. **Splitting the reusable `reviewDiff` function from the CLI entrypoint (or exporting it as-is) is the natural reuse seam for an eval provider.**

### `scripts/review/schema.ts` — current shape

- `SYSTEM_PROMPT` ([scripts/review/schema.ts:3-32](scripts/review/schema.ts#L3-L32)) is a single exported string array joined with `\n` — trivially reusable/importable as-is by any eval harness.
- `REVIEW_SCHEMA` ([scripts/review/schema.ts:37-65](scripts/review/schema.ts#L37-L65)) is a zod object: 5 numeric criteria (`implementationCorrectness`, `idiomaticity`, `complexity`, `testRiskCoverage`, `securitySafety`), a `verdict` enum (`pass`/`fail`), and a `summary` markdown string. A code comment ([scripts/review/schema.ts:34-36](scripts/review/schema.ts#L34-L36)) notes scores are plain `z.number()` (no `.min()/.max()`) because structured-output APIs commonly reject numeric range constraints — the 1-10 range is enforced only by prompt/description text, not the schema. **This matters for eval grading**: an eval assertion can't rely on schema-level range validation to catch an out-of-range score; it would need its own bounds check if that's a criterion worth grading.
- `Review` type is exported (`z.infer<typeof REVIEW_SCHEMA>`, [scripts/review/schema.ts:67](scripts/review/schema.ts#L67)) — directly importable for typing an eval provider's return value.
- `scripts/review/sample-diff.txt` is the only fixture that exists today, wired to `npm run review:sample` ([package.json:17](package.json#L17)). No other fixture diffs exist — an eval matrix would need a small set of representative diffs (e.g., one that violates RLS, one missing `prerender = false`, one clean pass) to be useful, none of which exist yet.

### Repo/CI context relevant to integration effort

- `package.json` ([package.json:1-84](package.json#L1-L84)): ESM (`"type": "module"`), `ai@^7.0.51`, `@ai-sdk/google@^4.0.33`, `zod@^4.4.3`, `vitest@^4.1.10` (already the test runner for unit + integration suites), `tsx@^4.23.5` (used to run `review.ts` directly, no separate build step). No eval framework present yet.
- `.nvmrc` pins Node `22.14.0`. Both `.github/workflows/ci.yml:19` and `.github/workflows/review.yml:19-21` use `actions/setup-node@v4` with `node-version: 22` (generic major version, not read from `.nvmrc`), which resolves to a current 22.x release in CI — satisfying promptfoo's `>=22.22.0` floor in CI even though local `.nvmrc` doesn't.
- `.github/workflows/review.yml` triggers the reviewer on PR `opened`/`reopened`/`labeled` (gated to the `ai-cr:review` label for `labeled`) and on `workflow_dispatch` ([.github/workflows/review.yml:3-11](.github/workflows/review.yml#L3-L11)), calling the composite action `./.github/actions/ai-reviewer`.
- `.github/actions/ai-reviewer/action.yml` computes the diff via `git diff origin/main...HEAD` excluding lockfiles ([.github/actions/ai-reviewer/action.yml:19](.github/actions/ai-reviewer/action.yml#L19)), pipes PR title/description/diff into `npx tsx scripts/review.ts` ([.github/actions/ai-reviewer/action.yml:32-41](.github/actions/ai-reviewer/action.yml#L32-L41)), parses the JSON with `jq` into a Markdown `| Criterion | Score |` table ([.github/actions/ai-reviewer/action.yml:62-77](.github/actions/ai-reviewer/action.yml#L62-L77)), fails the step on `verdict != pass` ([.github/actions/ai-reviewer/action.yml:86-88](.github/actions/ai-reviewer/action.yml#L86-L88)), and posts the comment + `ai-cr:passed`/`ai-cr:failed` labels via `gh` ([.github/actions/ai-reviewer/action.yml:105-144](.github/actions/ai-reviewer/action.yml#L105-L144)). This existing PR-comment pattern is exactly what promptfoo's own GitHub Action (or a `jq`-based step reading `results.json`) would slot into.
- No existing tests reference `scripts/review` anywhere in the repo (`review.test.ts`, `review.spec.ts`, or `tests/**` references) — a fully green field for whichever eval approach is chosen.

### Promptfoo fit assessment

- **Custom TypeScript providers**: supported via `file://` references implementing `ApiProvider` (`id` + `callApi(prompt, context, options)` returning `ProviderResponse`). This is the mechanism to wrap the existing `reviewDiff()`/`ToolLoopAgent` call so the eval exercises the real agent rather than a reimplementation. ([Promptfoo custom-provider docs](https://www.promptfoo.dev/docs/providers/custom-api/))
- **Structured/zod-shaped output scoring**: no native zod integration, but the `javascript` assertion type receives already-parsed JSON output and can return a `GradingResult` with `componentResults`/`namedScores` — enough to import `REVIEW_SCHEMA` directly and map the 5 criteria + verdict into per-field scores. ([Promptfoo assertions docs](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/))
- **Model comparison matrix**: native, first-class — a `providers` array runs every test case across every listed provider/model and renders a side-by-side matrix view. The same custom provider can be listed multiple times with different `config.model` values. ([Promptfoo configuration guide](https://www.promptfoo.dev/docs/configuration/guide/))
- **Setup effort**: `npm install promptfoo` or ad hoc `npx promptfoo@latest eval`; YAML config by default (`promptfooconfig.yaml`), test cases can be YAML/JSON/CSV/TS; results exportable as JSON/HTML/JUnit XML/CSV via `-o`. An official `promptfoo-action` GitHub Action posts results to PRs; alternatively, `results.json` can be parsed the same way `review.json` is parsed today. ([Promptfoo installation](https://www.promptfoo.dev/docs/installation/), [promptfoo-action](https://github.com/promptfoo/promptfoo-action), [CI/CD integration](https://www.promptfoo.dev/docs/integrations/ci-cd/))
- **Node version floor**: promptfoo requires Node `^20.20.0` or `>=22.22.0` per its npm package metadata — above this repo's `.nvmrc`-pinned `22.14.0` (Node 20 line's support window closed 2026-07-30, i.e. before today). CI's generic `node-version: 22` resolves above the floor; local dev via `.nvmrc`/nvm currently does not.
- **Known rough edges**: promptfoo's _built-in_ `google:` provider has open issues around structured-output parsing on Gemini "thinking" models and transient 503s ([issue #1876](https://github.com/promptfoo/promptfoo/issues/1876), [issue #7077](https://github.com/promptfoo/promptfoo/issues/7077)) — largely avoided by using a custom provider that calls `@ai-sdk/google` directly, the same as `review.ts` does today, rather than promptfoo's built-in Gemini provider.

### Alternative OSS eval tools surveyed

| Tool                                                                             | Language/runtime fit                             | Wraps existing agent?                             | Native model matrix?                          | Hosted/cloud required?                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Vercel AI SDK "evals" pattern**                                                | TS, first-party                                  | Yes (it _is_ the existing code)                   | No — you build the loop                       | No                                                                                           |
| **evalite** ([GitHub](https://github.com/mattpocock/evalite))                    | TS-native, Vitest-built                          | Yes, generic task-function wrapping               | Not a named built-in; straightforward to loop | No — local-first, MIT                                                                        |
| **getsentry/vitest-evals** ([GitHub](https://github.com/getsentry/vitest-evals)) | TS, Vitest extension, first-party AI SDK harness | Yes, `createHarness()` designed for custom agents | Not first-class; loop-able since it's Vitest  | No                                                                                           |
| **Hand-rolled Vitest + autoevals**                                               | TS, uses existing test runner                    | Yes, direct call                                  | You build it                                  | No (autoevals itself is local; some scorers default to calling `OPENAI_API_KEY`)             |
| **Braintrust OSS SDK**                                                           | TS, Apache-2.0 SDK                               | Yes                                               | Yes (platform feature)                        | Execution/reporting requires a Braintrust API key — not truly self-hosted without enterprise |
| **Inspect AI** (UK AISI)                                                         | Python-only core                                 | Would require reimplementing the agent in Python  | Yes (platform feature)                        | No, but disqualified by language mismatch                                                    |

Ranked shortlist if promptfoo were rejected: **evalite** (closest like-for-like local TS swap) → **vitest-evals** (best if first-party AI SDK harness support matters) → **hand-rolled Vitest + autoevals** (lowest new-dependency risk).

## Code References

- `scripts/review.ts:1-31` — agent construction (`ToolLoopAgent`, model constant, schema-typed output)
- `scripts/review.ts:33-52` — CLI entrypoint (stdin read, API key check, JSON stdout)
- `scripts/review/schema.ts:3-32` — `SYSTEM_PROMPT`
- `scripts/review/schema.ts:34-65` — `REVIEW_SCHEMA` (zod, unconstrained numeric ranges)
- `scripts/review/sample-diff.txt` — only existing fixture diff
- `package.json:16-17` — `review`/`review:sample` npm scripts (tsx-based, no build step)
- `.github/workflows/review.yml:1-32` — PR-review workflow trigger + Node setup
- `.github/actions/ai-reviewer/action.yml:26-89` — diff computation, reviewer invocation, verdict gate, scores-table comment body

## Architecture Insights

- The review pipeline is intentionally minimal and stateless — one function call per invocation, no persistence, no queue — which makes it cheap to wrap in an eval provider (no teardown/fixture-scoping concerns like the ones flagged for Supabase test fixtures in `context/foundation/lessons.md`).
- Model selection is currently a hardcoded constant rather than configuration, which is the single concrete code change (or an eval-harness-level override) needed regardless of which eval tool is chosen — an eval matrix needs _some_ seam to vary the model per run.
- The zod schema's deliberate lack of `.min()/.max()` on numeric fields (a documented workaround for structured-output API limits) means any eval assertion that wants to grade "is the score in range" has to hand-roll that check — no tool inspected here fixes this automatically.
- CI already has a working, repo-specific pattern for turning a JSON review result into a PR comment with a scores table ([.github/actions/ai-reviewer/action.yml:62-77](.github/actions/ai-reviewer/action.yml#L62-L77)) — an eval CI step can reuse this exact shape (parse `results.json` with `jq`, build a Markdown table) rather than adopting promptfoo's own GitHub Action, if consistency with the existing action is preferred over an off-the-shelf integration.

## Historical Context (from prior changes)

- `context/archive/2026-08-04-code-review-agent/plan-brief.md` — the change that originally introduced `scripts/review.ts`/`schema.ts`/`sample-diff.txt`. It chose the Vercel AI SDK + `@ai-sdk/google` (Gemini `gemini-3.1-flash-lite`) specifically due to a recorded **$0 AI-provider budget constraint**, and explicitly scoped unit tests for the script as **out of scope**. Any eval work inherits that zero-budget constraint — worth confirming whether it still holds before choosing which models to include in a comparison matrix (some Gemini tiers are free-tier eligible, others are not).
- `context/archive/2026-08-05-ci-cd-code-review/requirements.md` — the change that wired `scripts/review.ts` into CI via the `ai-reviewer` composite action; describes the diff/PR-title/body input contract that mirrors `schema.ts`.
- Commit `3bdc82b` (within the `ci-cd-code-review` change) added the `| Criterion | Score |` table to the PR comment in direct response to live feedback on PR #25 — i.e., the current comment format is a deliberate, recently-tuned UX choice, not incidental; an eval-driven CI comment should probably match or extend it rather than replace it wholesale.

## Related Research

- None — this is the first research artifact for `code-review-evals`.

## Open Questions

- Is the $0 AI-provider budget constraint from `2026-08-04-code-review-agent` still in force? It directly limits which models can be included in a comparison matrix (e.g., whether paid-tier Gemini/OpenAI/Anthropic models are usable at all, or only free-tier Gemini variants).
- Should the eval matrix run in CI (e.g., on a schedule or label trigger, posting a comparison table to a tracking issue/PR) or only be a local/manual developer tool? This affects whether the Node-version bump (`.nvmrc` → `>=22.22.0`) is required or optional.
- What diff fixtures are needed beyond `sample-diff.txt` to meaningfully differentiate models (e.g., a deliberate RLS violation, a missing `prerender = false`, a clean pass, a Next.js-directive violation)? None exist today.
- Should `reviewDiff()` in `scripts/review.ts` be exported/refactored to accept the model as a parameter as part of this change, or should the eval's custom provider duplicate just enough of the agent construction to vary the model without touching the production script?
