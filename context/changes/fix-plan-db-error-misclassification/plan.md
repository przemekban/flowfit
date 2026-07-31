# Fix POST /api/plan DB Error Misclassification Implementation Plan

## Overview

`POST /api/plan` currently wraps the database read (`getCandidateExercises`), the Gemini call (`generateTrainingPlan`), and validation (`validatePlanAgainstCandidates`) in a single `try/catch`. Any failure from any of the three — including a database connection error or a missing table — is classified as `ai_error` with HTTP 502. This makes database outages look like Gemini outages in logs and to API clients, hiding the real failure category from monitoring and debugging.

## Current State Analysis

- `src/pages/api/plan.ts:37-48` — one `try` block spans all three calls; the `catch` only distinguishes `PlanValidationError` (→ message from the error) from everything else (→ generic "Failed to generate training plan"), but both outcomes always respond `{ error: "ai_error" }` with status 502.
- `src/lib/services/plan.ts:21-39` — `getCandidateExercises` rethrows the raw Supabase `PostgrestError` unchanged on any query failure (connection issue, missing table, etc.).
- A working precedent for DB-specific error classification already exists in the same file: the `save_generated_training_plan` RPC failure path at `src/pages/api/plan.ts:55-71` returns `{ error: "db_error", message: "Failed to save your training plan" }` with status 500.
- `src/pages/api/plan.test.ts` already mocks `getCandidateExercises`, `generateTrainingPlan`, `validatePlanAgainstCandidates`, and the Supabase `rpc` call individually via `vi.mock`, so a test asserting on `getCandidateExercisesMock.mockRejectedValue(...)` fits the existing test structure without new scaffolding.

## Desired End State

When `getCandidateExercises` throws, `POST /api/plan` responds `{ error: "db_error", message: "Failed to load exercises for your training plan" }` with status 500, and does not call `generateTrainingPlan` or `validatePlanAgainstCandidates`. When `generateTrainingPlan` or `validatePlanAgainstCandidates` throws, behavior is unchanged from today (`ai_error`, 502, existing message logic).

### Key Discoveries:

- Existing `db_error`/500 precedent at `src/pages/api/plan.ts:71` — the fix reuses this exact category and status rather than inventing a new one.
- The scope is intentionally narrow: only `getCandidateExercises` moves out of the shared `try/catch`. `generateTrainingPlan` and `validatePlanAgainstCandidates` stay together under `ai_error`, matching current behavior for those two (validation vs. Gemini-call is still distinguished in the `console.error` `kind` field, not the HTTP response — unchanged).

## What We're NOT Doing

- Not splitting `generateTrainingPlan` and `validatePlanAgainstCandidates` into separate error categories — out of scope per the bug report, which is specifically about DB vs. AI conflation.
- Not changing `getCandidateExercises` itself in `src/lib/services/plan.ts` — it already throws a usable error; the fix is entirely in how `plan.ts` catches and classifies it.
- Not adding retry logic or circuit breaking for DB failures.

## Implementation Approach

Wrap the `getCandidateExercises` call in its own `try/catch` ahead of the existing AI `try/catch`, returning `db_error`/500 on failure. The AI `try/catch` shrinks to cover only `generateTrainingPlan` and `validatePlanAgainstCandidates`, preserving its current message/kind logic unchanged.

## Phase 1: Isolate DB error classification in POST /api/plan

### Overview

Split the single try/catch in the route handler into two, add a failing test first (RED), then the minimal handler change (GREEN).

### Changes Required:

#### 1. Route handler error classification

**File**: `src/pages/api/plan.ts`

**Intent**: Separate the database read from the AI generation/validation steps so a `getCandidateExercises` failure is classified and logged as a database error, not an AI error.

**Contract**: Introduce a `try/catch` around `const candidates = await getCandidateExercises(supabase, profile);` alone, which on catch logs via `console.error("Candidate exercise lookup failed", { userId, cause: err })` and returns `Response.json({ error: "db_error", message: "Failed to load exercises for your training plan" }, { status: 500 })`. The existing `try/catch` around `generateTrainingPlan` + `validatePlanAgainstCandidates` keeps its current body and behavior unchanged, operating on the `candidates` value produced by the new block.

#### 2. Test coverage

**File**: `src/pages/api/plan.test.ts`

**Intent**: Pin the new behavior with a regression test (added first, RED, per TDD) and confirm the existing AI-error test still passes unchanged (GREEN, no regression).

**Contract**: New `it` block — `getCandidateExercisesMock.mockRejectedValue(new Error("connection refused"))` (or an object shaped like a `PostgrestError`), then assert `response.status === 500` and body `{ error: "db_error", message: "Failed to load exercises for your training plan" }`, and that `generateTrainingPlanMock` was never called.

### Success Criteria:

#### Automated Verification:

- Unit/integration test passes: `npm run test -- plan.test.ts`
- Full unit test suite passes: `npm run test`
- Type checking passes via lint: `npm run lint`

#### Manual Verification:

- None — this is a pure backend error-classification fix with full test coverage via mocks; no user-facing UI to click through.

**Implementation Note**: After completing this phase and automated verification passes, pause here for manual confirmation before committing (per the project's phase-commit ritual), even though manual testing steps are empty for this phase.

---

## Testing Strategy

### Unit Tests:

- `getCandidateExercises` rejects → `db_error`/500, `generateTrainingPlan` never called.
- `generateTrainingPlan` rejects with `PlanValidationError` → `ai_error`/502 (existing test, must remain green — pins no-regression).

### Manual Testing Steps:

None required for this change.

## Performance Considerations

None — no new I/O, only reclassifying an existing error path.

## Migration Notes

None — no data model or schema change.

## References

- Existing `db_error` precedent: `src/pages/api/plan.ts:55-71`
- `getCandidateExercises` implementation: `src/lib/services/plan.ts:21-39`
- Existing test file and mock structure: `src/pages/api/plan.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Isolate DB error classification in POST /api/plan

#### Automated

- [x] 1.1 Unit/integration test passes: `npm run test -- plan.test.ts`
- [x] 1.2 Full unit test suite passes: `npm run test`
- [x] 1.3 Type checking passes via lint: `npm run lint`
