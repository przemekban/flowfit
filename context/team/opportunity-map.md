# Opportunity Map

## Context

- **Project / context**: FlowFit (Astro/Cloudflare), solo developer, using the 10xDevs AI toolkit change workflow (`context/changes/<id>/` → plan → implement → archive → PR), GitHub Issues mapped to roadmap slices, GitHub Actions CI with required status checks, branch protection on `main`.
- **Data constraint**: mock/local/read-only/non-sensitive — all four signals operate on the developer's own repo metadata (git, GitHub Issues/PRs, CI logs, `context/` files), never customer or production data.
- **Date**: 2026-08-03

## Map

| Signal                                                                                                                                                                                                             | Existing / default response                                                                                                                                                    | Thin complement                                                                                                                                                          | First useful version                                                                                                                                                                                                                                                                                                                                                                                                                                 | Data risk             | Direction if valuable                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| Solo PR review has no second pass with a fixed checklist before merge                                                                                                                                              | `/10x-impl-review` exists but is manual, ad hoc, and not tied to a fixed rule set or the PR moment                                                                             | A written review checklist (from AGENTS.md hard rules + project conventions) run automatically right before/at PR open                                                   | Script/skill step that runs the review checklist against the diff and posts findings as a PR comment via `gh` — read-only, no auto-fix                                                                                                                                                                                                                                                                                                               | local / non-sensitive | Internal tool → Review / CI gate                                                              |
| CI failures block work until manually noticed; diagnosing them means re-deriving context                                                                                                                           | GitHub's default email/web notification on failed runs; no proactive push, no auto-diagnosis                                                                                   | On-demand check that fetches the latest run for the current branch (`gh run view`) and surfaces the failing step + log excerpt                                           | Skill/command: "what broke CI" → failing step + log tail, no auto-fix                                                                                                                                                                                                                                                                                                                                                                                | local / non-sensitive | Internal tool → Async/remote work (later); auto-fix is a separate, riskier track              |
| Merged **local** branches accumulate after PR merge (remote side already auto-deletes via GitHub; local never gets pruned); happens across projects with different base-branch names (`main`, `master`, `develop`) | GitHub's "Automatically delete head branches" only cleans the remote side — nothing prunes local branches, and no single hardcoded branch name (e.g. `main`) covers every repo | Global git alias that detects the repo's actual base branch (`origin/HEAD`, falling back to `main`/`master`/`develop`) and deletes local branches already merged into it | **Implemented** — `git cleanup-branches` global alias running `~/.gitscripts/cleanup-branches.sh`: `fetch --prune`, then deletes local branches whose upstream is `[gone]` (remote deleted after merge — safe signal regardless of squash/rebase merge) or that are literal ancestors of the detected base branch, skipping the current and base branch. First real run caught a squash-merged branch that a naive `--merged` check missed entirely. | local / non-sensitive | Done — resolved directly as a global git alias (2026-08-03), no dedicated tool needed         |
| Resuming work requires manually reconstructing status: what was done, what's in progress, what's next                                                                                                              | Ad hoc — asking the assistant "what were we working on" each time, no persistent aggregation                                                                                   | On-demand digest reading `context/changes/*/change.md` status fields + recent `git log` + open PRs/issues via `gh`                                                       | Skill/command: "status" → in-progress changes, recent commits, open PRs, next candidate — read-only                                                                                                                                                                                                                                                                                                                                                  | local / non-sensitive | Internal tool → could grow into Async/remote work if a proactive daily digest is wanted later |

## Recommended First Candidate

```text
Candidate:
Session Status Digest

Reads:
- context/changes/*/change.md (status field: draft/planned/implementing/implemented/archived)
- git log (recent commits on current branch vs. main)
- gh pr list / gh issue list (open PRs, roadmap issues in progress)

Returns:
A short on-demand digest: what's in progress (by change status), what shipped recently
(commits/merged PRs since last check), and what's next (oldest open roadmap issue not
yet started).

Does not do:
- No scheduling / cron / proactive push notification (that's a later, separate step)
- No write access — pure read/aggregate of existing sources
- Does not replace context/foundation/roadmap.md as the source of truth, only summarizes it

Data risk:
local/non-sensitive — reads only this repo's own git history, GitHub metadata, and
context/ files.

Direction if it proves valuable:
Internal tool (a skill/command). If used daily and the read step becomes annoying to
trigger by hand, it can grow into Async/remote work (scheduled daily digest).
```

## Why This Candidate

Of the four signals, this one repeats most reliably (every time work resumes, not just
per-PR or per-CI-failure), combines the most sources (change status + git + GitHub), has
the clearest articulated pain today ("I needed to ask what we were working on"), and is
the cheapest to validate — it's a pure read/aggregate over data that already exists, with
no risk of a bad automated edit. PR review and CI-failure diagnostics are close seconds
and share infrastructure with this one (both need `gh` CLI reads), so they're natural
follow-ups rather than competitors. Branch cleanup isn't a build candidate at all — it's
solved by an existing GitHub setting.

## Next Direction If Valuable

Chosen path: **validate first** — `/10x-mom-test` to pressure-test whether the "reconstructing
status" pain is real and frequent enough to justify a dedicated skill/command (vs. just asking
the assistant each time, which already sort of works). If it survives that, feed it into
`/10x-shape` → `/10x-prd` → `/10x-roadmap` as a small internal-tool slice.

PR review and CI-failure diagnostics remain on the map as secondary candidates for a future
round, once the status digest either proves out or is deprioritized.
