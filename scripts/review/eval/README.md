# Review agent eval

Compares `scripts/review.ts`'s PR-review agent (same `SYSTEM_PROMPT`/`REVIEW_SCHEMA`, same `reviewDiff()` production path) across a small Gemini-tier matrix, against the single reused `../sample-diff.txt` fixture. Run with `npm run review:eval`.

Requires `GEMINI_API_KEY` in `.env` (same as `npm run review`) and Node `>=22.22.0` (see `.nvmrc`) — `promptfoo`'s own floor.

This is a local/manual developer comparison tool only. It is intentionally not wired into CI (no workflow, no scheduled run, no PR comment) — that's out of scope for this change.
