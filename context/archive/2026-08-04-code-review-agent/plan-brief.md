# Code Review Agent (local script, M5L2) — Plan Brief

> Full plan: `context/changes/code-review-agent/plan.md`

## What & Why

Build a local, scripted code-review agent for FlowFit: it reads a git diff from stdin and returns a structured JSON review (five 1-10 criteria, a pass/fail verdict, a Markdown summary).

## Starting Point

FlowFit has no code-review tooling today, but it already has one AI-integration pattern this plan reuses: `src/lib/services/plan.ts` builds a zod schema, derives a JSON Schema from it, and validates structured model output against that same schema. The project also has a hard, already-recorded constraint (`tech-stack.md`, decision ORQ-2): AI usage must run on a **$0 provider** — Anthropic was evaluated and explicitly rejected for cost reasons, Google Gemini's free tier was chosen instead.

## Desired End State

`git diff | npm run review` prints a JSON review of the piped diff to stdout, generated via Gemini through Vercel AI SDK's `ToolLoopAgent`. `npm run review:sample` runs the same script against a committed fixture diff — a one-command, repeatable proof that the SDK, provider, and API key are correctly wired, with no live diff required.

## Key Decisions Made

| Decision            | Choice                                              | Why (1 sentence)                                                                                                                                                |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK category        | Vercel AI SDK 6 (build-your-own)                    | Claude/Codex/Cursor Agent SDKs all require a paid provider relationship, conflicting with the recorded $0-AI-provider constraint.                               |
| Model provider      | `@ai-sdk/google` (Gemini), not OpenRouter           | Reuses the free-tier Gemini access already configured for FlowFit's plan-generation feature instead of adding a third AI vendor.                                |
| Model               | `gemini-3.1-flash-lite`                             | Same model already used in `plan.ts` — no new cost/rate-limit surface to evaluate.                                                                              |
| Diff input          | stdin only                                          | Matches the lesson exactly; a file-path CLI argument is unnecessary scope for a first pass.                                                                     |
| System prompt scope | Generic (lesson's prompt, no `AGENTS.md` injection) | Keeps the review narrow and predictable for this step; project-convention-awareness is a natural fit for the M5L3 CI integration instead.                       |
| Verification        | Committed fixture diff + `npm run review:sample`    | Gives a repeatable, one-command proof of a working model connection — reusable later by CI in M5L3 — instead of a one-off manual test that can't be reproduced. |

## Scope

**In scope:**

- `scripts/review/schema.ts` (shared system prompt + zod schema)
- `scripts/review.ts` (stdin → `ToolLoopAgent` → JSON stdout)
- `scripts/review/sample-diff.txt` (verification fixture)
- `npm run review` / `npm run review:sample` script entries
- New deps: `ai`, `@ai-sdk/google`, `tsx`

**Out of scope:**

- CI/CD wiring, PR commenting, human-in-the-loop (M5L3)
- `AGENTS.md`/`CLAUDE.md` injection into the prompt
- File-path diff input, custom tools, cost tracking/`maxCost`
- Unit tests for the script (no other `scripts/*.mjs` has them either)
- Cloudflare Agents SDK deployment (Deep Dive material, not the practical task)

## Architecture / Approach

`scripts/review.ts` reads stdin, builds a `ToolLoopAgent` (model: `google("gemini-3.1-flash-lite")` via an explicitly-keyed `createGoogleGenerativeAI` instance, `tools: {}`, `stopWhen: stepCountIs(2)`), and validates its structured output against `REVIEW_SCHEMA` before printing JSON. The schema and prompt live in a separate module so the review contract has one source of truth, matching the pattern already used for plan generation.

## Phases at a Glance

| Phase                   | What it delivers                                                                    | Key risk                                                                                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. SDK integration      | Deps installed, schema module, working `npm run review` reading stdin               | `@ai-sdk/google`'s default API-key env var (`GOOGLE_GENERATIVE_AI_API_KEY`) doesn't match the project's `GEMINI_API_KEY` — must construct the provider explicitly, not rely on auto-detection |
| 2. Verification fixture | Committed sample diff + `npm run review:sample` proving a live, working Gemini call | None significant — this phase is confirmation, not new logic                                                                                                                                  |

**Prerequisites:** `GEMINI_API_KEY` set in local `.env` (already required by the existing plan-generation feature).
**Estimated effort:** ~1 session, 2 phases.

## Open Risks & Assumptions

- Assumes `ai` v6 and `@ai-sdk/google` have no peer-dependency conflict with the project's pinned `zod@^4.4.3` — if `npm install` surfaces a peer conflict, resolve it at install time rather than pre-pinning versions in the plan.
- Assumes `gemini-3.1-flash-lite`'s free-tier rate limits are sufficient for occasional local runs (already true for the existing plan-generation feature under the same constraint).

## Success Criteria (Summary)

- `npm run review:sample` reliably produces a valid, populated JSON review from a committed fixture — proof the SDK + provider + API key chain works end to end.
- `git diff | npm run review` reviews an arbitrary local diff the same way.
- Empty-stdin and missing-API-key cases fail with clear, actionable errors instead of opaque SDK exceptions.
