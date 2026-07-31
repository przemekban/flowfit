# Fix POST /api/plan DB Error Misclassification — Plan Brief

> Full plan: `context/changes/fix-plan-db-error-misclassification/plan.md`

## What & Why

`POST /api/plan` wraps a database read, a Gemini AI call, and validation in one `try/catch`, so a database failure (connection issue, missing table) gets misclassified as `ai_error`/502 — making DB outages look like Gemini outages in logs and to clients. This hides the real failure category from monitoring and debugging.

## Starting Point

`src/pages/api/plan.ts:37-48` catches all three steps together. `getCandidateExercises` (`src/lib/services/plan.ts:21-39`) already rethrows the raw Supabase error on failure. A working `db_error`/500 precedent already exists in the same file for the `save_generated_training_plan` RPC failure path (`plan.ts:55-71`).

## Desired End State

A `getCandidateExercises` failure returns `{ error: "db_error", message: "Failed to load exercises for your training plan" }` at HTTP 500, without ever reaching the Gemini call. Gemini/validation failures behave exactly as before (`ai_error`/502).

## Key Decisions Made

| Decision       | Choice                                             | Why (1 sentence)                                                                                          | Source |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------ |
| Scope of split | Isolate only the DB read (`getCandidateExercises`) | Matches the bug report exactly; Gemini call + validation stay together as today                           | Plan   |
| DB error shape | `db_error` / 500, generic message                  | Reuses the exact precedent already in this file (`plan.ts:71`) instead of inventing a new category/status | Plan   |

## Scope

**In scope:** Splitting the try/catch in `src/pages/api/plan.ts`; new regression test in `src/pages/api/plan.test.ts`.

**Out of scope:** Splitting `generateTrainingPlan` vs. `validatePlanAgainstCandidates` into separate categories; changes to `getCandidateExercises` itself; retry/circuit-breaker logic.

## Architecture / Approach

Add a dedicated `try/catch` around the `getCandidateExercises` call, ahead of the existing AI `try/catch`. On failure, log and return `db_error`/500 immediately. The AI `try/catch` shrinks to cover only `generateTrainingPlan` + `validatePlanAgainstCandidates`, unchanged in behavior.

## Phases at a Glance

| Phase                              | What it delivers                                                                             | Key risk                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Isolate DB error classification | `db_error`/500 for candidate-lookup failures; `ai_error`/502 unchanged for Gemini/validation | Low — single file, existing precedent, full mock-based test coverage |

**Prerequisites:** None — test infra and mock patterns already exist in `plan.test.ts`.
**Estimated effort:** Single short TDD cycle (~1 phase, 1 commit).

## Open Risks & Assumptions

- Assumes `PostgrestError`-shaped rejections from Supabase are representative enough to test with a plain `Error`/object mock (test mocks the service function directly, not the Supabase client, so exact error shape doesn't matter).

## Success Criteria (Summary)

- A DB read failure in `getCandidateExercises` now returns `db_error`/500, distinct from `ai_error`/502.
- Existing `ai_error`/502 behavior for Gemini/validation failures is unchanged (no regression).
