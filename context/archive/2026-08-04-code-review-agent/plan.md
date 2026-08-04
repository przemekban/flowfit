# Code Review Agent (local script, M5L2) Implementation Plan

## Overview

Build a local, scripted code-review agent using Vercel AI SDK 6 (`ToolLoopAgent`) with the Google provider (`@ai-sdk/google`), reusing the project's existing free-tier Gemini access. The agent reads a git diff from stdin and returns a structured JSON review (five 1-10 criteria, a pass/fail verdict, and a Markdown summary).

## Current State Analysis

FlowFit has no code-review tooling today. It does have one established AI-integration pattern to follow: `src/lib/services/plan.ts:80-93` builds a zod schema, derives a JSON Schema via `z.toJSONSchema()`, and validates the model's structured output against the same zod schema before trusting it. `src/lib/ai/gemini.ts` shows the project's existing Gemini client wiring (`GEMINI_API_KEY` from `astro:env/server`).

`context/foundation/tech-stack.md` records decision ORQ-2: Anthropic's API was evaluated and explicitly rejected for FlowFit because the project requires a **$0 AI provider**; Google Gemini's free tier was chosen instead. This constraint, decided earlier in this conversation, is why this plan uses Vercel AI SDK + `@ai-sdk/google` rather than Claude Agent SDK, Codex SDK, Cursor SDK, or OpenRouter Agent SDK.

There's an existing `scripts/` directory (`scripts/check-quality.mjs`, `scripts/generate-seed.mjs`, etc.) for standalone dev tooling — the natural home for this script, outside `src/`. None of `ai`, `@ai-sdk/google`, or `tsx` are installed yet (`zod` already is, at `^4.4.3`).

## Desired End State

Running `git diff | npm run review` from the repo root prints a JSON object to stdout matching the review schema (five 1-10 scores, a `pass`/`fail` verdict, and a Markdown summary) for the piped diff, generated via Gemini through Vercel AI SDK's `ToolLoopAgent`. Running `npm run review:sample` runs the same script against a committed fixture diff, requiring no live `git diff` — this is the repeatable proof that the SDK, provider, and API key are wired correctly end to end.

### Key Discoveries:

- `src/lib/services/plan.ts:80-93` — the zod → `z.toJSONSchema()` → structured-output pattern this script reuses.
- `context/foundation/tech-stack.md:26-29` (ORQ-2) — the $0-AI-provider constraint driving the SDK/provider choice.
- `.env.example:3` — `GEMINI_API_KEY` is the project's existing env var name; per `README.md` / `AGENTS.md`, Node code reads `.env` (not `.dev.vars`, which is Cloudflare-only).
- `astro:env/server` (used in `src/lib/ai/gemini.ts:2`) is an Astro-runtime binding and is **not available** in a standalone `tsx` script — the script must read `process.env` directly.
- `scripts/` (e.g. `scripts/generate-seed.mjs`) is the established location for standalone dev-tooling scripts outside `src/`.
- `eslint.config.js` applies `strictTypeChecked` repo-wide via `projectService` — new `.ts` files under `scripts/` are linted the same as `src/`, and `no-console` is `"warn"`, not an error, so `console.log`/`console.error` in the script are fine.
- `tsconfig.json` has no `types` restriction, and `@types/node` is already resolved transitively (via `vite`/`vitest`), so no new `@types/node` dependency is needed.

## What We're NOT Doing

- CI/CD integration, PR commenting, or human-in-the-loop review flow (that's M5L3).
- Injecting `AGENTS.md`/`CLAUDE.md` into the review system prompt — the prompt stays generic, matching the lesson's own "podstawowy prompt" scope for this step.
- Accepting a diff via a file-path CLI argument — stdin only (`git diff | ...`), matching the lesson exactly.
- Custom tools for the agent (`tools: {}`), cost/budget tracking (`totalUsage`, `onStepFinish` telemetry), or a hard cost cap (`maxCost`/custom `StopCondition`) — out of scope for this first local pass.
- Unit tests for the script itself — no other file in `scripts/*.mjs` has unit test coverage; this follows the same convention.
- Deploying this as a Cloudflare Agent (Durable Object) — the lesson's Deep Dive section, not part of the practical task.

## Implementation Approach

Reuse the project's established zod-schema-as-single-source-of-truth pattern, but swap the provider: instead of `@google/genai` called directly, use Vercel AI SDK 6's `ToolLoopAgent` with the `@ai-sdk/google` provider. The system prompt and zod schema live in one shared module (`scripts/review/schema.ts`), matching the lesson's `common/review-schema.ts` split. The main script (`scripts/review.ts`) only handles stdin reading, agent invocation, and output — no business logic beyond that.

## Critical Implementation Details

**API key env var mismatch.** `@ai-sdk/google`'s default export (`google`) reads its API key from `GOOGLE_GENERATIVE_AI_API_KEY` by convention — but the project's existing key is named `GEMINI_API_KEY` (`.env.example:3`, already used by `src/lib/ai/gemini.ts`). To reuse the existing key without introducing a second, duplicate env var, the script must construct the provider explicitly via `createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })` rather than importing the default `google` instance that relies on env auto-detection.

**Running outside the Astro runtime.** Because this script runs via `tsx`, not inside Astro's server context, `astro:env/server` is unavailable — the API key must come from `process.env.GEMINI_API_KEY`, populated by passing `--env-file=.env` to `tsx` (Node 20.6+; project pins Node 22.14.0 via `.nvmrc`, so this flag is supported) rather than relying on Astro's env schema.

## Phase 1: SDK integration

### Overview

Install the Vercel AI SDK + Google provider, add the shared review schema module, and wire the main review script plus its npm entry point.

### Changes Required:

#### 0. Tooling setup (no file diff)

**Intent**: Per the lesson's task instructions, install the Vercel AI SDK skill for accurate API usage guidance while implementing this phase.

**Contract**: Run `npx skills add vercel/ai` before writing `scripts/review.ts`. This adds a Claude Code skill under `.claude/skills/` — it is dev tooling, not shipped application behavior.

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the Vercel AI SDK, the Google provider, and a TypeScript script runner.

**Contract**: `dependencies` gains `ai` and `@ai-sdk/google`; `devDependencies` gains `tsx`. `zod` is already present and does not need to change. Add an npm script `"review": "tsx --env-file=.env scripts/review.ts"`.

#### 2. Shared review schema

**File**: `scripts/review/schema.ts`

**Intent**: Single source of truth for the reviewer's system prompt and output contract, mirroring `src/lib/services/plan.ts`'s zod-schema-as-source-of-truth pattern.

**Contract**: Exports `SYSTEM_PROMPT` (the five-criteria reviewer instructions from the lesson: poprawność implementacji, idiomatyczność, złożoność, pokrycie testami względem ryzyka, bezpieczeństwo, plus a binding pass/fail verdict and a 2-3 sentence Markdown summary), `REVIEW_SCHEMA` (a `z.object` with five `z.number().describe(...)` score fields each documenting the 1-10 scale in its description, a `verdict: z.enum(["pass", "fail"])`, and a `summary: z.string()`), and `type Review = z.infer<typeof REVIEW_SCHEMA>`.

#### 3. Review script

**File**: `scripts/review.ts`

**Intent**: Read a diff from stdin, send it to Gemini via `ToolLoopAgent`, and print the validated structured review as JSON to stdout.

**Contract**: Reads all of stdin into a string before proceeding (fail fast with a clear error message if stdin is empty — e.g., no diff was piped in). Constructs the Google provider via `createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })` (see Critical Implementation Details) and throws a clear error before calling the API if `GEMINI_API_KEY` is unset. Builds a `ToolLoopAgent` with `model: google("gemini-3.1-flash-lite")` (same model already used in `src/lib/services/plan.ts:12`), `instructions: SYSTEM_PROMPT`, `tools: {}`, `output: Output.object({ schema: REVIEW_SCHEMA })`, and `stopWhen: stepCountIs(2)`. Calls `reviewer.generate({ prompt: ... })` with the diff embedded in the prompt, then `console.log(JSON.stringify(output, null, 2))`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes on `scripts/review.ts` and `scripts/review/schema.ts`

#### Manual Verification:

- Piping empty stdin (e.g. `echo | npm run review` where the diff resolves to an empty string) produces a clear, immediate error message rather than a hang or an opaque SDK stack trace

---

## Phase 2: Verification fixture

### Overview

Add a committed, repeatable fixture so anyone (including a future CI step in M5L3) can prove the agent talks to Gemini successfully without needing a live `git diff`.

### Changes Required:

#### 1. Sample diff fixture

**File**: `scripts/review/sample-diff.txt`

**Intent**: A small, realistic unified diff to exercise the reviewer end-to-end — ideally one with an obvious gap (e.g., a new function with no accompanying test) so the review output is visibly meaningful rather than a trivial pass.

**Contract**: Valid unified diff format (`git diff` output shape), self-contained, no dependency on actual repo file state.

#### 2. Sample npm script

**File**: `package.json`

**Intent**: One-command reproduction of the verification run.

**Contract**: Add `"review:sample": "tsx --env-file=.env scripts/review.ts < scripts/review/sample-diff.txt"`.

### Success Criteria:

#### Automated Verification:

- `npm run review:sample` exits with code 0 and prints a JSON object to stdout

#### Manual Verification:

- The printed JSON has all five score fields populated with numbers roughly in the 1-10 range, a `verdict` of `pass` or `fail`, and a non-empty `summary` — confirming the model actually reviewed the fixture diff rather than returning a malformed or empty response

---

## Testing Strategy

### Unit Tests:

- None — this script follows the existing `scripts/*.mjs` convention of no unit test coverage for standalone dev tooling.

### Integration Tests:

- N/A (no CI wiring in this change; see "What We're NOT Doing").

### Manual Testing Steps:

1. Run `npm run review:sample` and confirm valid structured JSON output.
2. Make a small local edit, run `git diff | npm run review`, and confirm the output reflects that specific diff (not a cached/stale response).
3. Temporarily unset `GEMINI_API_KEY` and confirm the script fails with a clear, actionable error rather than a raw SDK exception.

## Performance Considerations

None beyond what the lesson already covers — `stepCountIs(2)` bounds the agent to at most two turns, keeping latency and token usage predictable for a single-diff review.

## Migration Notes

N/A — net-new script, no existing data or behavior to migrate.

## References

- Existing structured-output pattern: `src/lib/services/plan.ts:69-131`
- Existing Gemini client wiring: `src/lib/ai/gemini.ts`
- $0 AI provider constraint: `context/foundation/tech-stack.md:26-29`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: SDK integration

#### Automated

- [x] 1.1 npm run lint passes on scripts/review.ts and scripts/review/schema.ts — a324d3b

#### Manual

- [x] 1.2 Empty stdin produces a clear error message, not a hang or opaque stack trace — a324d3b

### Phase 2: Verification fixture

#### Automated

- [x] 2.1 npm run review:sample exits 0 and prints a JSON object to stdout — 6aa4e1a

#### Manual

- [x] 2.2 Printed JSON has five in-range scores, a pass/fail verdict, and a non-empty summary — 6aa4e1a
