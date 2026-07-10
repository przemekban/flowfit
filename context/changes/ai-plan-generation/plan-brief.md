# AI-Generated Weekly Training Plan — Plan Brief

> Full plan: `context/changes/ai-plan-generation/plan.md`
> Research: `context/changes/ai-plan-generation/research.md`

## What & Why

Generate a personalized weekly training plan from the user's onboarding survey profile using the Google Gemini API (`gemini-3.1-flash-lite`, structured outputs), and display it on `/dashboard`. This is FR-006, the core value proposition — without it there is no product beyond a survey form.

> **Note (2026-07-10):** originally implemented against the Anthropic API per ORQ-2; reversed same-day to Google Gemini (free tier) since Anthropic's API is not free. See `plan.md` and `context/foundation/tech-stack.md` (ORQ-2 revision history) for the full pivot.

## Starting Point

Schema is fully ready (`user_profiles`, `exercises` with 814 seeded rows, `workouts`, `workout_exercises`, `user_plan`, `workout_sessions`, all RLS-protected). Provider/model/structured-output mechanism were decided in ORQ-2 (later reversed to Gemini, see note above). Nothing else is wired: no AI SDK dependency, no AI-provider env declaration, no fetch-based API pattern anywhere in the app (every existing route is form POST → redirect), and `/dashboard` is a static placeholder.

## Desired End State

A user who finishes onboarding lands on `/dashboard`, sees staged progress messages for the ~5-20s the AI call takes, and then sees their plan: `sessions_per_week` workouts, each with 4-8 exercises matched to their equipment and experience level, showing sets/reps or sets/duration per exercise. No regenerate action exists in MVP — the plan just appears and stays.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Exercise candidate feed | Filter by equipment + difficulty before prompting | Keeps the prompt small and guarantees every option the model can pick is actually usable | Plan |
| Output guardrails | App-enforced bounds in the Zod schema (4-8 exercises/workout, 2-5 sets, 5-20 reps or 15-180s) | Protects against degenerate-but-schema-valid output | Plan |
| Generation trigger | Auto-fire on first dashboard visit, no button | Matches the survey → dashboard flow with zero extra friction | Plan |
| Loading UX | Staged progress messages (client-side timed) | Satisfies the >2s continuous-feedback NFR without building a skeleton for a screen that doesn't exist yet | Plan |
| Regeneration | None in MVP — one-time only | Matches PRD Non-Goals / OQ-001 (profile & plan changes deferred to V2) | Plan |
| Workout labeling | Sequential rotation labels ("Workout 1", "Workout 2", …) | Matches the actual rotation data model, not a calendar | Plan / Research |
| Error handling | Distinct AI-error vs. DB-error server logging, one generic retry UI for the user | Debuggable in logs without over-building bespoke UI (no error tracking tool exists yet) | Plan |
| Cloudflare CPU risk | Stay on free tier; push heavy work into the DB-side RPC, not the Worker isolate | No new spend commitment; addresses the CPU ceiling's actual cause | Plan |
| Persistence | Single atomic RPC (`save_generated_training_plan`) via `SECURITY INVOKER`, archives old + inserts new | Guarantees no partial-write state; RLS still gates every write, no privilege escalation | Research |
| Provider/model | Google Gemini API direct (`@google/genai`), `gemini-3.1-flash-lite`, non-streaming structured outputs | ORQ-2 reversed same-day: Anthropic isn't free, project needs a $0 provider; Gemini has the best free tier + structured-output support of the free options evaluated | Research |
| Candidate referencing | Model references exercises by array index, not `exercise_id` UUID; service maps index → UUID after parsing | Gemini's structured-output enforcement breaks on a large string enum/uuid nested inside a repeated array item (empirically verified) | Research |

## Scope

**In scope:** Google Gemini SDK integration, candidate exercise filtering, Zod-schema-guarded generation (with index-based candidate mapping), atomic DB persistence via RPC, dashboard branching UI, staged-progress generator island, plan display component, error/retry handling.

**Out of scope:** Regeneration, profile editing, streaming responses, Cloudflare tier upgrade, workout template browsing, skeleton-loading UI.

## Architecture / Approach

Server-authoritative: `POST /api/plan` does all AI calling, validation, and persistence; the client island only triggers the request and shows progress/error state, then reloads the page on success so the plan renders through the normal server-side path. All shape guarantees (workout count, exercise bounds, referential integrity, tracking-type consistency) are enforced before any DB write; the write itself is one atomic Postgres RPC so a failure can never leave a half-replaced plan.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Environment & Dependencies | `@google/genai`, `GEMINI_API_KEY` wired through `astro:env/server` | Secret missing in a deploy target breaks generation silently |
| 2. Database: Save RPC | Atomic archive-old/insert-new transactional function | Getting the jsonb-loop insert logic and RLS interaction wrong |
| 3. Plan Generation Service | Candidate query, dynamic Zod schemas, prompt, Gemini call (index-based candidate mapping), two-pass validation | AI output that's schema-valid but referentially wrong (hallucinated exercise IDs, mismatched tracking type) |
| 4. API Route | `POST /api/plan` wiring service + RPC with typed error responses | Cloudflare CPU ceiling / silent 1101 on this exact route |
| 5. Dashboard Integration & UI | Dashboard branching, generator island, plan display | Duplicate POST on re-render; loading UX not satisfying the >2s NFR |

**Prerequisites:** F-01 (core-db-schema) and S-01 (onboarding-survey) — both done. `GEMINI_API_KEY` obtained from Google AI Studio (free) before Phase 1.
**Estimated effort:** ~3-5 sessions across 5 phases (solo, after-hours MVP pace).

## Open Risks & Assumptions

- Cloudflare free-tier 10ms CPU ceiling is unmitigated by design (deliberate choice, not an oversight) — if 1101 errors appear in production, the follow-up is a Workers Standard upgrade, tracked outside this plan.
- Assumes the model reliably respects "select only from the provided candidate list" — the two-pass validation in Phase 3 is the safety net if it doesn't, at the cost of a user-visible retry.
- No automated test suite exists in this repo; correctness relies on Zod validation plus the manual verification steps in each phase.

## Success Criteria (Summary)

- A first-time user sees a plan generated and displayed on `/dashboard` without manual refresh, with visible progress feedback throughout.
- Every generated exercise belongs to the candidate set and matches the user's equipment/experience level, with reps/duration fields consistent with each exercise's `tracking_type`.
- A failed generation is recoverable via retry without losing onboarding progress or leaving the DB in a partial state.
