# promptfoo Eval Matrix for scripts/review.ts — Implementation Plan

## Overview

Introduce a `promptfoo` eval that runs the existing PR-review agent's prompt (`SYSTEM_PROMPT` + `REVIEW_SCHEMA` from `scripts/review/schema.ts`) unmodified across 2-3 Gemini model tiers, reusing the already-committed `scripts/review/sample-diff.txt` fixture as the sole test case. The eval asserts, per model: (a) a static check that the known-flawed diff produces `verdict: "fail"`, and (b) an LLM-as-judge check that the review's summary actually names the diff's intentional gap, not just the right verdict for the wrong reason.

## Current State Analysis

`scripts/review.ts` builds a fresh `ToolLoopAgent` per invocation with a hardcoded `GEMINI_MODEL = "gemini-3.1-flash-lite"` constant ([scripts/review.ts:5](scripts/review.ts#L5)), reads a diff from stdin, and prints the validated `Review` JSON to stdout. `reviewDiff()` is not exported and the bottom of the file runs the CLI flow (stdin read → API key check → review → `console.log`/`process.exit`) unconditionally on module load — there is no seam today to vary the model or to import the review logic without also triggering the CLI side effects.

`scripts/review/sample-diff.txt` is the only fixture that exists: it adds `applyDiscountUnsafe()` (skips the `0-100` bounds check that the sibling `applyDiscount()` enforces) and wires it into `checkout.ts` with a user-controlled `discountPercent` — a real correctness/security gap a competent review should flag, most likely under `implementationCorrectness` or `securitySafety`, and which should drive `verdict: "fail"` per the system prompt's own zero-tolerance rule for security findings.

No eval framework, `promptfoo` dependency, or eval-related tests exist yet (confirmed via `research.md` and a fresh grep — `promptfoo` appears nowhere in `package.json`).

## Desired End State

`npm run review:eval` runs `promptfoo eval` against 3 Gemini tiers (`gemini-3.1-flash-lite`, `gemini-3.1-flash`, `gemini-3.1-pro`), all sharing the exact same `SYSTEM_PROMPT`/`REVIEW_SCHEMA` and calling the real `reviewDiff()` production function (not a reimplementation), against the single reused `sample-diff.txt` test case. Each model's result is asserted against a static `verdict === "fail"` check and an LLM-as-judge check (graded by the same Gemini family) that the review's summary names the discount-validation gap. Results render as promptfoo's side-by-side comparison table in the terminal. `scripts/review.ts`'s CLI behavior (`npm run review`, `npm run review:sample`, and the `ai-reviewer` composite action that shells out to it) is unchanged.

### Key Discoveries:

- `scripts/review.ts:33-52` — the CLI entrypoint runs unconditionally at module load (no `if (require.main...)`-equivalent guard); importing `reviewDiff` for the eval provider would otherwise also trigger a stdin read and `process.exit` as a side effect. **This must be guarded.**
- `scripts/review.ts:15-31` — `reviewDiff(diff, apiKey)` already returns `Promise<Review>` and is trivially parameterizable with a third `model` argument defaulting to the current constant, preserving every existing call site.
- `scripts/review/schema.ts:37-65` — `REVIEW_SCHEMA`'s scores are plain `z.number()` with no `.min()/.max()` (deliberate — structured-output APIs commonly reject numeric range constraints). No schema-level range check exists to lean on for score assertions; per the plan's questioning, the eval intentionally does not add per-criterion score assertions and only checks `verdict` + judge.
- `.github/actions/ai-reviewer/action.yml:26-41` — CI invokes `scripts/review.ts` via `npx tsx scripts/review.ts` as a CLI process, not an import — unaffected by exporting `reviewDiff` as long as the guarded CLI block still runs identically on direct execution.
- promptfoo requires Node `^20.20.0 || >=22.22.0`; `.nvmrc` currently pins `22.14.0`, below the floor. CI's `setup-node@v4` with generic `node-version: 22` already resolves above it, so only local/`.nvmrc`-based dev is affected.
- promptfoo auto-loads a `.env` file from the current working directory by default — the repo already has `.env` with `GEMINI_API_KEY` (per `.env.example`), matching the pattern `npm run review` already relies on via `tsx --env-file=.env`.

## What We're NOT Doing

- No new diff fixtures — `sample-diff.txt` is the only test case, per explicit scope.
- No cross-vendor models (OpenAI/Anthropic) — staying within the Gemini family to preserve the project's $0 AI-provider budget constraint.
- No CI wiring (no workflow, no scheduled run, no PR-comment integration) — `review:eval` is a local/manual developer command only.
- No per-criterion score assertions (e.g. asserting `securitySafety <= 2`) — only `verdict` and the LLM-judge gap check are asserted, since the schema's scores are intentionally unconstrained and per-model score values are expected to vary even when the verdict is correct.
- No new unit tests for `scripts/review.ts` itself — unit test coverage for this script was explicitly out of scope in the change that introduced it and remains out of scope here.
- No change to the `ai-reviewer` composite action, its inputs, or the PR-comment format.

## Implementation Approach

Keep the production script's public behavior identical; only widen `reviewDiff()`'s signature and guard its CLI side effects so it can be safely imported. Build the promptfoo integration as a self-contained `scripts/review/eval/` directory (provider, judge assertion, config) that imports from the production files rather than duplicating prompt/schema/agent logic — so the eval always exercises the real review path.

## Critical Implementation Details

### Timing & lifecycle

The bottom of `scripts/review.ts` currently runs its CLI flow (stdin read, API key check, `console.log`, `process.exit`) unconditionally whenever the module is loaded — including when `reviewDiff` is imported by the eval provider. This must be guarded so it only runs on direct execution, not on import. Because the dev environment is Windows, use the URL→path comparison rather than a raw string match (Windows path separators and `file://` prefixing make naive comparisons unreliable):

```ts
import { fileURLToPath } from "node:url";

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  // existing CLI try/catch block
}
```

## Phase 1: Open the production seam

### Overview

Make `reviewDiff()` importable and model-parameterizable without changing any existing CLI/CI behavior, and unblock local promptfoo usage on the pinned Node version.

### Changes Required:

#### 1. `scripts/review.ts` — export and parameterize `reviewDiff`

**Intent**: Allow the eval provider to call the exact production review path with a variable model, while every existing caller (the CLI block itself, the `ai-reviewer` action) keeps working unchanged.

**Contract**: `export async function reviewDiff(diff: string, apiKey: string, model: string = GEMINI_MODEL): Promise<Review>` — replace the internal `google(GEMINI_MODEL)` call with `google(model)`. Existing call site at the bottom of the file continues to call `reviewDiff(diff, apiKey)` (using the default), so its behavior is bit-for-bit unchanged.

#### 2. `scripts/review.ts` — guard the CLI entrypoint

**Intent**: Prevent the stdin-read/`process.exit` CLI flow from firing as a side effect when the module is imported by the eval provider.

**Contract**: Wrap the existing bottom-of-file `try { ... } catch { ... }` block in the `fileURLToPath(import.meta.url) === process.argv[1]` guard shown in Critical Implementation Details. No behavior change for `npm run review`, `npm run review:sample`, or the `ai-reviewer` composite action, all of which invoke the file directly via `tsx`.

#### 3. `.nvmrc` — bump Node floor

**Intent**: Let `npm run review:eval` work locally under the pinned `.nvmrc` version instead of silently requiring an out-of-band Node switch.

**Contract**: Change the pinned version from `22.14.0` to `22.22.0` (promptfoo's stated floor). No other file references `.nvmrc`'s exact value beyond CI's generic `node-version: 22`, which already resolves above this floor.

### Success Criteria:

#### Automated Verification:

- Lint (includes type-checked rules) passes: `npm run lint`
- Existing review scripts still run end-to-end unchanged: `npm run review:sample` (produces the same JSON shape as before)

#### Manual Verification:

- `node -v` after `nvm use` (or equivalent) reflects `22.22.0`+ and `npx promptfoo --version` resolves without a Node-engine error

---

## Phase 2: promptfoo eval matrix

### Overview

Add the promptfoo dependency and the eval-specific files: a custom provider wrapping `reviewDiff`, an LLM-as-judge assertion, and the config wiring 3 Gemini tiers against the single reused fixture.

### Changes Required:

#### 1. `package.json` — add `promptfoo` devDependency

**Intent**: Bring in the eval CLI/runtime.

**Contract**: `npm install -D promptfoo` (latest resolvable version at implementation time).

#### 2. `scripts/review/eval/provider.ts` — custom promptfoo provider

**Intent**: Let promptfoo drive the real `reviewDiff()` production function per model tier, instead of reimplementing agent construction.

**Contract**: Default-exports a class implementing promptfoo's `ApiProvider` interface — `id()` returning a label incorporating the configured model, and `callApi(prompt)` calling `reviewDiff(prompt, apiKey, model)` (model read from `options.config.model` passed via the promptfoo config's per-provider `config` block) and returning `{ output: review }`. `GEMINI_API_KEY` is read from `process.env`, same as the production script.

```ts
import { reviewDiff } from "../../review.ts";

export default class GeminiReviewProvider {
  private modelId: string;
  constructor(options: { config?: { model?: string } }) {
    this.modelId = options.config?.model ?? "gemini-3.1-flash-lite";
  }
  id() {
    return `gemini-review:${this.modelId}`;
  }
  async callApi(prompt: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    const review = await reviewDiff(prompt, apiKey, this.modelId);
    return { output: review };
  }
}
```

#### 3. `scripts/review/eval/gap-judge-assert.ts` — LLM-as-judge assertion

**Intent**: Verify each model's review doesn't just land on `verdict: "fail"` by chance — its `summary` must actually name the diff's known gap (the unvalidated `applyDiscountUnsafe` path allowing out-of-range/negative discount manipulation in `checkout.ts`).

**Contract**: Default-exports an async function matching promptfoo's `javascript` assertion signature `(output: Review, context) => Promise<GradingResult>`. Internally calls `generateObject` (from `ai`, via `@ai-sdk/google`, same Gemini family as the models under test) with a small schema `{ identifiesGap: z.boolean(), reasoning: z.string() }`, prompting it with the known gap description and `output.summary`, then maps the result to `{ pass: identifiesGap, score: identifiesGap ? 1 : 0, reason: reasoning }`.

#### 4. `scripts/review/eval/promptfooconfig.yaml` — eval matrix config

**Intent**: Wire 3 Gemini-tier provider entries, the single reused fixture as the only test case, and both assertions.

**Contract**: `providers` lists `file://provider.ts` three times with `label`/`config.model` set to `gemini-3.1-flash-lite`, `gemini-3.1-flash`, and `gemini-3.1-pro` respectively. `prompts` is `["{{diff}}"]` (the provider receives the rendered diff text directly as `prompt`). The single test's `vars.diff` loads via `file://../sample-diff.txt`. `tests[0].assert` has two entries: `{ type: javascript, value: "output.verdict === 'fail'" }` (the static assertion) and `{ type: javascript, value: file://gap-judge-assert.ts }` (the LLM-judge assertion).

### Success Criteria:

#### Automated Verification:

- Lint passes on the new TS files: `npm run lint`
- YAML config is well-formed and providers/tests resolve: `npx promptfoo validate -c scripts/review/eval/promptfooconfig.yaml`

#### Manual Verification:

- `npx promptfoo eval -c scripts/review/eval/promptfooconfig.yaml` runs successfully against all 3 models with a live `GEMINI_API_KEY`, without provider/assertion errors
- The static verdict assertion reports pass for every model (the diff is unambiguously flawed)
- The LLM-judge assertion's per-model reasoning is inspected manually to confirm it's actually grading gap-identification and not trivially passing/failing

---

## Phase 3: Wire up and document

### Overview

Expose the eval as a first-class npm script and leave a short trail for the next developer who runs it.

### Changes Required:

#### 1. `package.json` — add `review:eval` script

**Intent**: Standard entrypoint matching the existing `review`/`review:sample` script naming.

**Contract**: `"review:eval": "promptfoo eval -c scripts/review/eval/promptfooconfig.yaml"` (relies on promptfoo's default `.env` auto-load from cwd for `GEMINI_API_KEY`, matching how `review`/`review:sample` already source it).

#### 2. `scripts/review/eval/README.md` (or a short header comment) — usage note

**Intent**: Record the Node-version requirement and that this is a local/manual comparison tool, not part of CI, so a future reader doesn't wonder why it's absent from `ci.yml`.

**Contract**: 3-5 lines: what the eval compares, that it requires `GEMINI_API_KEY` in `.env`, and that it's intentionally not wired into CI (per this change's scope).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes with the new script present
- `npm run review:eval` is invocable (`npm run review:eval -- --help` style smoke check, or a dry run if promptfoo supports one)

#### Manual Verification:

- `npm run review:eval` produces the same comparison table as running the `npx promptfoo eval` command directly in Phase 2
- A teammate unfamiliar with the change can read the short usage note and understand what the command does and why it isn't in CI

---

## Testing Strategy

### Unit Tests:

- None added — matches the existing (explicit, prior-change) decision to leave `scripts/review.ts` without unit test coverage; the promptfoo eval itself is the test harness for this code path.

### Integration Tests:

- Not applicable — no new Supabase/API surface introduced.

### Manual Testing Steps:

1. Run `npm run review:eval` locally with `GEMINI_API_KEY` set in `.env`.
2. Confirm the terminal output shows a 3-column (one per model) comparison table for the single `sample-diff.txt` test case.
3. Confirm the static `verdict === 'fail'` assertion passes for all 3 models.
4. Read each model's LLM-judge reasoning and the underlying `review.summary` to sanity-check the judge is grading gap-identification correctly (not a rubber stamp).
5. Confirm `npm run review` and `npm run review:sample` still behave exactly as before (unchanged JSON output, same exit behavior).

## Performance Considerations

None — this is a manual/local developer tool making at most 6 live model calls (3 review calls + 3 judge calls) per run, well within the existing free-tier usage pattern already established for `gemini-3.1-flash-lite`.

## Migration Notes

Not applicable — no persisted data or schema involved.

## References

- Related research: `context/changes/code-review-evals/research.md`
- Existing agent construction: `scripts/review.ts:15-31`
- Existing schema/prompt: `scripts/review/schema.ts`
- Existing fixture (reused as-is): `scripts/review/sample-diff.txt`
- CI review pipeline (unaffected by this change): `.github/actions/ai-reviewer/action.yml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Open the production seam

#### Automated

- [ ] 1.1 Lint (includes type-checked rules) passes: `npm run lint`
- [ ] 1.2 Existing review scripts still run end-to-end unchanged: `npm run review:sample`

#### Manual

- [ ] 1.3 `node -v` reflects `22.22.0`+ and `npx promptfoo --version` resolves without a Node-engine error

### Phase 2: promptfoo eval matrix

#### Automated

- [ ] 2.1 Lint passes on the new TS files: `npm run lint`
- [ ] 2.2 YAML config is well-formed and providers/tests resolve: `npx promptfoo validate -c scripts/review/eval/promptfooconfig.yaml`

#### Manual

- [ ] 2.3 `npx promptfoo eval -c scripts/review/eval/promptfooconfig.yaml` runs successfully against all 3 models
- [ ] 2.4 The static verdict assertion reports pass for every model
- [ ] 2.5 The LLM-judge assertion's per-model reasoning is manually confirmed to be grading gap-identification correctly

### Phase 3: Wire up and document

#### Automated

- [ ] 3.1 `npm run lint` passes with the new script present
- [ ] 3.2 `npm run review:eval` is invocable

#### Manual

- [ ] 3.3 `npm run review:eval` produces the same comparison table as the direct `npx promptfoo eval` command
- [ ] 3.4 A teammate unfamiliar with the change can understand the command's purpose and CI-exclusion from the usage note
