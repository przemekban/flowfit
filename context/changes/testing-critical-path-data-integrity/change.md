---
change_id: testing-critical-path-data-integrity
title: Critical-path data integrity test rollout (Phase 2)
status: implementing
created: 2026-07-29
updated: 2026-07-29
archived_at: null
---

## Notes

Phase 2 of `context/foundation/test-plan.md` §3 Phased Rollout. Goal: prove the
north-star session-logging flow persists data and the service layer the team
trusts least (`profile.ts`/`plan.ts`) behaves correctly.

Covers Risks #3 and #5 from test-plan.md §2:

- **#3** — a logged set (reps/weight) appears to save in the UI but the
  autosave request fails silently, and the data is gone on reload or session
  resume.
- **#5** — a change to `profile.ts` or `plan.ts` regresses onboarding-profile
  persistence or plan-generation input mapping without anyone noticing.

Test types: unit + integration (per test-plan.md §3 row 2).
