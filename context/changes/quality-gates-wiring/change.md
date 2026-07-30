---
change_id: quality-gates-wiring
title: Lock unit, integration, and e2e tests into CI as required merge gates
status: implemented
created: 2026-07-30
updated: 2026-07-30
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

Test-plan.md §3 Phase 4 ("Quality-gates wiring"): unit+integration+e2e already
run unconditionally in `.github/workflows/ci.yml`'s single `ci` job, so a
failure already blocks the job. What's unverified: whether GitHub branch
protection on `main` actually requires the `ci` job (or specific steps) to
pass before merge is allowed — i.e. whether the gate is enforced, not just
present. AGENTS.md's CI section ("No automated test suite is configured")
is stale and should be corrected as part of this change.
