# Progress Indicators (FR-012 / S-05) — Plan Brief

> Full plan: `context/changes/progress-indicators/plan.md`
> Research: `context/changes/progress-indicators/research.md`

## What & Why

FR-012 (nice-to-have): show which exercises a user improved on compared to the most recent previous session containing that exercise. It's the last piece of the workout-logging → history arc, explicitly deferred when session-logging (S-03) shipped and flagged as the roadmap item most likely to slip if capacity runs short.

## Starting Point

History (`history.astro`) and the active session (`session/[workoutId].astro` + `SessionLogger`/`SetRow`) are both SSR-first with no client read API. The closest existing building block, `getLastLoggedSets`/`latest_workout_sets`, only fetches the single globally-latest raw set for pre-fill placeholders — it doesn't aggregate a session's best value and doesn't generalize to "the session before an arbitrary reference session," so it can't be reused.

## Desired End State

The newest history session (page 1 only) and the active session screen both show an inline "Improved" badge per exercise, comparing the best value logged this session against the best value from the most recent prior finished session — live on the active session screen, computed at page load for history.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| "Improved" metric | Best single-set weight (reps-tracked) / best duration (duration-tracked), selected by `tracking_type` | Matches PRD's schema intent and cleanly covers both tracking types without an ambiguous rep-normalization formula | Plan (user Q&A) |
| Tie handling | Strict `>` | User chose FR-012's literal "improved" wording over the PRD's looser "matched or exceeded" phrasing | Plan (user Q&A) |
| Duration-tracked scope | In scope, parallel metric | User chose full coverage over cutting scope | Plan (user Q&A) |
| Query shape | Single RPC with a window function | One round trip, matches existing multi-statement-function precedent | Plan (user Q&A) |
| Active-session update mode | Live, updates as sets are logged | Captures the "just beat your record" moment; requires lifting saved values into `SessionLogger` | Plan (user Q&A) |
| Badge UI | Inline pill, existing convention | Zero new dependencies, consistent with Completed/Abandoned badges | Plan (user Q&A) |
| No-prior-session display | Show nothing | Never a false positive; simplest, one fewer UI state | Plan (user Q&A) |
| History scope | Newest session only (page 1) | Avoids compounding RPC cost across a full page of history | Plan (user Q&A) |

## Scope

**In scope:** new RPC + integration test; pure comparison logic + unit tests; history badge (newest session only); active-session live badge (requires `SetRow`/`SessionLogger` state-lifting); e2e coverage for the live path.

**Out of scope:** badges on history pages beyond page 1; live-updating the *previous*-session baseline; a new shadcn `Badge` component; a "first-time exercise" indicator; volume- or 1RM-normalized comparison; any change to `getLastLoggedSets`/`latest_workout_sets`.

## Architecture / Approach

One Postgres RPC (`get_previous_exercise_bests`, `SECURITY INVOKER`, filtered by `auth.uid()` directly — no IDOR surface) returns, per exercise, the most recent prior finished session's aggregated best via a `ROW_NUMBER()` window function. A pure `computeImprovements` function (strict `>`, tracking-type-aware, null-safe) is the single source of truth for "improved," consumed identically by history's server-side render and the active session's client-side live aggregate.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database RPC | `get_previous_exercise_bests` migration + integration test | SQL-function-body logic can't be hermetically tested — must be an integration test against real Postgres |
| 2. Comparison logic & service layer | Pure `aggregateSessionBests`/`computeImprovements` + RPC wrapper, unit-tested | The weight_kg-on-duration-tracked-exercise edge case must key off `tracking_type`, not "which field is populated" |
| 3. History screen integration | Badge on newest session only, rendered once per exercise | The set list is flat, not grouped by exercise — dedup logic needed to avoid repeating the badge per set row |
| 4. Active session integration | Live badge via lifted `SetRow` → `SessionLogger` state | Real architecture change: `onSaved` is one-shot by design and can't double as the live-aggregation signal; e2e test needs its own isolated seeded workout to avoid the other specs' shared-session coupling |

**Prerequisites:** S-04 (workout-history) — done. No new dependencies.
**Estimated effort:** ~2-3 sessions across 4 phases (Phase 4 is the largest — a real client-state architecture change plus a new e2e fixture).

## Open Risks & Assumptions

- The RPC's ranking (`COALESCE(s.completed_at, s.started_at) DESC, s.id DESC`) assumes `completed_at`/`started_at`/`id` together give a deterministic ordering even without a uniqueness guarantee on timestamps alone — covered by the tiebreak on `id`.
- Abandoned sessions are included in the comparison pool alongside completed ones (matching how `getWorkoutSessionHistory` already treats "history"); if this reads as surprising in manual testing, it's a one-line `status IN (...)` change in the RPC, not a redesign.

## Success Criteria (Summary)

- The newest history session and the active session screen both show accurate, live-or-load-time "Improved" badges per the tracking-type-aware, strict-`>` rule.
- No false positives: first-time exercises, ties, and null-value cases never show a badge.
- All automated gates (lint, build, unit, integration, e2e) pass; manual click-through of both screens confirms live update, dedup, and pagination behavior.
