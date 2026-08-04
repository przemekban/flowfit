# Mom Test Validation Plan

## Input Idea

**Candidate**: Session Status Digest — an on-demand skill/command that reads
`context/changes/*/change.md` (status field), recent `git log`, and
`gh pr list` / `gh issue list`, and returns a short digest: what's in
progress, what shipped recently, what's next.

Source: `context/team/opportunity-map.md`, "Recommended First Candidate"
section. Proposed because the solo developer on FlowFit reports needing to
manually reconstruct project status every time they resume work (after a
break, or in the morning), and currently does this by asking the assistant
ad hoc.

**Note on method**: this is a solo-developer self-tool — the "customer" and
the builder are the same person. There is no third party to interview, so
the usual multi-respondent interview/survey format is adapted into a
self-directed diary study grounded in the developer's own timestamped
history (git log, change.md files) rather than recalled impressions.

## Hypotheses

- **User/role**: The solo developer themselves, in the "resuming work"
  moment — first thing in a session, or after a multi-day gap.
- **Friction**: Reconstructing "what was I doing, what's in flight, what's
  next" requires manual work each time — currently solved by asking the
  assistant.
- **Current workaround**: Ask the assistant ad hoc ("what were we working
  on"), which already reads roughly the same sources a digest would (change
  status, git log, GitHub state) when prompted to. The opportunity map itself
  says this "already sort of works."
- **Risky assumptions**:
  1. That this happens _every time_ work resumes, often enough to justify a
     dedicated tool rather than a one-line prompt.
  2. That the bottleneck is _aggregating the sources_, not something else
     (e.g., remembering _why_ a decision was made, not _what_ happened).
  3. That `change.md` status fields are a reliable source of truth to digest
     from.
  4. That `gh issue list` / `gh pr list` reliably contribute signal.
  5. That a saved skill/command meaningfully beats just typing the same
     ad-hoc question each time — i.e., that invocation friction (forgetting
     to ask, inconsistent phrasing/answers) is itself part of the pain, not
     just the aggregation step.
- **Evidence already present** (pulled directly from the repo, not assumed):
  - `git log` over the last ~10 days shows near-daily commits with
    descriptive Conventional Commits messages (`feat:`, `fix:`, `test:`,
    `chore(archive):`, phase-labelled rollout commits). This already reads
    as a fairly legible status trail on its own — arguably git log alone is
    already close to "what shipped recently."
  - Checked the one currently-active change folder,
    `context/changes/fix-plan-db-error-misclassification/change.md`: its
    `status` field reads `implemented`, but the corresponding PR (#21)
    already merged 3 days ago and the change was never archived. Per
    AGENTS.md, the workflow requires archiving _before_ opening the PR — this
    one slipped. **This is a concrete, present-tense example of the exact
    kind of drift a status-field-based digest would inherit**: the source of
    truth it would read from is already stale in a real, current case.
  - `gh issue list --state open` and `gh pr list --state open` both return
    empty right now — the roadmap backlog was fully closed as of 2026-07-30.
    So on any given day right now, the GitHub-derived third of the digest
    contributes nothing. The candidate's value is time-variable: it's richer
    when there's a backlog in flight, near-empty when there isn't (as now).
  - No existing log of how many times, or how long, manual reconstruction
    actually took recently — the pain is asserted ("I needed to ask what we
    were working on") but not measured yet.

## Critique

The opportunity map's own "existing / default response" column already
concedes the workaround "already sort of works" — that's the tell that this
idea needs real validation, not rubber-stamping, and the map is right to
route it through `/10x-mom-test` before building.

Three places this could be a solution in search of a problem:

1. **Solution/problem conflation**: the actual friction described is "I don't
   remember state." The proposed fix is "aggregate three data sources into a
   digest." Those aren't the same thing unless aggregation is genuinely the
   slow part. If the real cost is deciding what to prioritize next (a
   judgment call), a digest that lists facts doesn't remove that step — it
   just pre-fetches the inputs to it.
2. **A one-line prompt vs. a dedicated tool**: this conversation is itself a
   working instance of the ad hoc path — Claude read `change.md`, git log,
   and `gh` state on request. Building a skill only pays for itself if the ad
   hoc version is failing in some specific way (inconsistent answers, forgets
   a source, requires several follow-up prompts) — not merely because typing
   a question feels like effort. That failure mode isn't demonstrated yet.
3. **Fixing the wrong layer**: the concrete staleness found above (an
   `implemented`-but-unarchived change three days after merge) is a _process_
   gap — the archive-before-PR step got skipped — not a _visibility_ gap. A
   digest would surface that drift but wouldn't prevent it. If this kind of
   drift is the actual annoyance, tightening the workflow (e.g., a
   pre-PR-open check, or a `10x-archive` reminder in the PR template) fixes
   the cause; a status reader would only ever describe the symptom.

What would prove the problem isn't (yet) worth building for: if a 1-2 week
self-tracked diary shows resuming work is infrequent (a few times a week or
less), each reconstruction takes under a couple of minutes, and asking the
assistant ad hoc has never produced a wrong or incomplete answer. What would
count as strong evidence to proceed: the diary shows frequent (near-daily)
resumption moments, each taking real minutes, or documents at least one
concrete incident where stale/missing status caused wasted work (e.g.,
re-doing something already done, or missing that a PR was still open).

## Interview Guide (self-directed diary, adapted for a solo user)

Since there's no second party, run this as a structured self-log for the
next 10-14 working sessions instead of a live interview. At the _start_ of
each session, before doing anything else, answer:

1. What time did I start this session, and how long was the gap since the
   last one (same day / overnight / multi-day)?
2. Before touching any tool, what do I _think_ I was in the middle of?
3. Did I open `change.md`, run `git log`, check GitHub, or ask the assistant
   to find out for real? Which, in what order?
4. How long did it take, in minutes, from opening the terminal/editor to
   feeling confident about "what's in progress / what's next"?
5. Was the answer I got correct and complete on the first pass, or did I
   have to double back (missed an open PR, forgot a change was already
   archived, etc.)?
6. If I asked the assistant: did its answer match what `change.md` / `git
log` / `gh` actually said, or did it need a correction?
7. Did anything about _this_ session's start cost me real time or cause a
   mistake (duplicated work, re-litigating a decision already made)? Or was
   it just mildly annoying?
8. Would a pre-built digest have changed anything about this specific
   session's start, or would I have asked the same question either way?

Follow-up prompts for interesting answers:

- If step 5 turns up a wrong/incomplete answer more than once: what
  specifically was missing — a stale `change.md` status, an issue the
  digest wouldn't have caught, or something outside all three sources
  entirely (e.g., "why" context)?
- If a session start ever causes a real mistake: what would have had to be
  different for the mistake not to happen — visibility, or a process
  guardrail (like enforcing archive-before-PR)?

## Survey (diary rollup, adapted for n=1)

Since there is no population to survey, treat this as a rollup of the diary
above after 10-14 sessions, self-scored:

1. Out of the sessions logged, how many started with genuine uncertainty
   about status? (count / total)
2. Median and max minutes spent reconstructing status per session.
3. How many times did the ad hoc assistant answer need a correction or a
   follow-up question to be complete?
4. How many times (if any) did stale/missing status cause rework or a wrong
   decision, vs. just mild friction?
5. How many of the logged sessions had an empty GitHub backlog (no open
   issues/PRs) at the time — i.e., how often would the `gh`-derived third of
   a digest have contributed nothing?
6. Open: describe the single worst instance from the log, in your own
   words — what actually went wrong, if anything.

## Decision Criteria

- **Proceed** if: the diary shows status-reconstruction friction in at least
  ~60% of logged sessions, taking a median of several minutes or more, AND at
  least one documented instance of real rework/wasted effort (not just mild
  annoyance) caused by not knowing current status.
- **Narrow scope** if: friction is real but infrequent (roughly weekly) and
  cheap (a minute or two, no rework) — in that case, don't build a skill;
  instead save the ad hoc prompt as a reusable prompt template/snippet and
  re-evaluate after another cycle.
- **Do not build yet** if: the ad hoc "ask the assistant" path consistently
  gives correct, complete answers in under a minute, or if reconstructing
  status genuinely happens less than weekly.
- **Try existing tool/process first** if: the diary's failures trace back to
  process drift (stale `change.md` status, skipped archive-before-PR step)
  rather than missing aggregation — fix that gap directly (e.g., a
  pre-PR-open check that blocks opening a PR while status is
  `implemented`-but-unarchived) before building a reader that would only
  ever describe the same drift after the fact.

## Decision Outcome (2026-08-03)

**Do not build.** Without running the full diary, the developer's own honest
read of the friction was "raczej lekka irytacja" (rather a mild irritation)
— which matches the "Do not build yet" threshold above (ad hoc already
resolves it acceptably; no documented rework/mistake, just occasional
annoyance). Session Status Digest is deprioritized. Revisit only if a
concrete incident surfaces later (e.g., a real instance of duplicated work
or a missed open PR caused by not knowing status).

Next: validate the next candidate from `context/team/opportunity-map.md`
("PR review checklist" or "CI-failure diagnostics") via `/10x-mom-test`
before building either.

---

# Mom Test Validation Plan — Candidate 2: PR Review Checklist

## Input Idea

**Candidate**: "Solo PR review has no second pass with a fixed checklist
before merge" — a script/skill step that runs a review checklist (derived
from AGENTS.md hard rules + project conventions) against the diff and posts
findings as a PR comment via `gh`, read-only, no auto-fix. `/10x-impl-review`
already exists but is manual, ad hoc, and not tied to a fixed rule set or
triggered automatically at the PR moment.

Source: `context/team/opportunity-map.md`, Map row 1.

## Hypotheses

- **User/role**: The solo developer, at the moment of opening a PR.
- **Friction**: No forced second pass against a fixed rule set before
  merging — review quality depends on remembering to run it and on manual
  attention.
- **Current workaround**: Run `/10x-impl-review` manually, ad hoc, when
  remembered.
- **Risky assumptions**:
  1. That `/10x-impl-review` is actually skipped often enough, in practice,
     for automation to matter.
  2. That the bugs/incidents that have happened would have been caught by
     _this specific_ checklist (AGENTS.md hard rules), rather than being a
     different category of bug entirely.
  3. That posting findings as a PR comment (vs. the current in-session
     review) changes the outcome, rather than just changing where the
     output appears.
- **Evidence already present** (from repo history, not assumed):
  - `context/foundation/lessons.md` already exists as a running, fixed rule
    set, explicitly wired into the workflow: its header states it is
    "re-read at start by ... `/10x-impl-review`." So a "fixed checklist" is
    not a gap — one already exists and is already the input to impl-review.
  - `/10x-impl-review` is demonstrably **already used and already catches
    things pre-merge** in at least three past changes, each followed by a
    same-PR fixup commit: `aee148f review(core-db-schema): impl review
fixes`, `db4be66 fix(onboarding-survey): apply impl-review triage
fixes`, `e1f8ded fix(ai-plan-generation): apply impl-review triage
fixes`. This is direct evidence the _manual_ path already works when
    invoked — the ad hoc step isn't failing to catch things when it runs.
  - **One real, costly incident exists**, and it's recorded in
    `lessons.md`: a migration wrote RLS policies but no matching `GRANT`,
    which "caused FlowFit's `/dashboard` and `/onboarding` to 500 for every
    logged-in user in production." This is a genuine production outage, not
    mild irritation — a materially different cost profile than the digest
    candidate. It is now `lessons.md` rule #1, tagged "Applies to: plan,
    implement, impl-review" — i.e., the mechanism to catch it going forward
    already exists in the manual workflow.
  - **One clear counter-example** for the "checklist from AGENTS.md hard
    rules" framing specifically: `80201de fix: isolate DB error
classification in POST /api/plan (#21)` was a real bug that escaped
    review and required its own follow-up change 3 days after the original
    feature merged. But this bug (a `try/catch` misclassifying a DB error as
    an AI error) is a _business-logic correctness_ bug — it doesn't
    correspond to any AGENTS.md hard rule (RLS, `prerender`, `astro:env`,
    `cn()`, `PROTECTED_ROUTES`, migration naming). A checklist built strictly
    from AGENTS.md's hard rules would not have caught it. This is a category
    mismatch worth naming explicitly: the proposed checklist's scope
    (AGENTS.md hard rules) is narrower than "all bugs that escape review,"
    and the most recent escaped bug falls outside that scope.

## Critique

Unlike the status-digest candidate, this one has a real, non-hypothetical
cost event behind it (the RLS/GRANT production outage) — so "is there real
pain" is less in question here. The open question is narrower and sharper:
**is the gap "no checklist exists" (it doesn't — `lessons.md` +
`/10x-impl-review` already form one), or is the gap "the checklist isn't
run reliably / consistently" (a discipline/triggering problem, which
automation _would_ address)?**

Two things to watch for:

1. **Solving a solved problem vs. solving a triggering problem**: if the
   real gap is that impl-review sometimes gets skipped or run
   superficially under time pressure, the fix is forcing/reminding
   invocation at the PR moment — which is exactly what's proposed. But if
   the three historical "impl-review triage fixes" commits show it's
   _already_ run consistently as part of the standard change workflow
   (research → plan → implement → **impl-review** → archive → PR), then
   automating "post as PR comment" mostly changes formatting/location of an
   output that's already being produced and acted on — lower-value than it
   first appears.
2. **Scope mismatch**: the most recent real escaped bug (#21, DB error
   misclassification) would not have been caught by an AGENTS.md-hard-rules
   checklist. If the goal is "catch what actually escapes to production,"
   the evidence points more toward broader test coverage / correctness
   review than toward automating the _existing_ hard-rules checklist. Don't
   let the RLS/GRANT incident (which _would_ fit this checklist) justify
   building for the #21-shaped gap (which wouldn't).

What would prove this isn't worth building yet: if reviewing the last
5-10 changes shows `/10x-impl-review` was run every time before PR
(i.e., discipline isn't actually the gap), and the only bug that ever
escaped past it (#21) is outside the hard-rules checklist's scope anyway —
in which case automating the _existing_ manual step buys little, and the
real lesson is "broaden correctness testing," a different (and already
partially addressed — see the recent `testing-*` change folders) track.
What would count as strong evidence to proceed: finding a change in the
history where impl-review was _not_ run (or was run but its findings were
ignored/not acted on) before a PR that later needed a fix for something the
checklist _would_ have caught.

## Interview Guide (self-directed diary, adapted for a solo user)

Run this retrospectively over the last 10-12 merged PRs (cheap — it's
just reading `git log` and `context/archive/*/plan.md` for each), then
prospectively for the next 5-6:

1. For each of the last 10-12 merged PRs: was `/10x-impl-review` actually
   run before the PR was opened? (Check `context/archive/<id>/plan.md` or
   commit messages for "impl review"/"impl-review" mentions.)
2. Of the ones where it _was_ run: did it produce findings, and were they
   fixed before or after merge?
3. Of the ones where it was _not_ run (if any): did any bug later surface in
   that code, and would this specific checklist (AGENTS.md hard rules) have
   caught it, or was it a different kind of bug entirely?
4. For the RLS/GRANT incident specifically: was impl-review run on that
   migration's change before it shipped? If yes, why didn't it catch it (was
   the rule not in `lessons.md` yet at that time)? If no, that's the
   sharpest data point in favor of automation.
5. For the #21 DB-error-misclassification bug: same question — was
   impl-review run on the original change, and if so, is this class of bug
   even in scope for a hard-rules checklist?
6. Going forward (next 5-6 PRs): does opening a PR ever happen _without_
   first thinking "should I run impl-review", or is it already a fixed step
   in the mental/actual workflow?
7. If impl-review is skipped even once in the next 5-6 PRs: what was the
   reason (forgot, time pressure, felt obviously safe)? Would a PR-comment
   nudge have changed that?
8. Does posting findings as a `gh` PR comment (vs. seeing them inline in the
   current session) change anything about whether they get acted on, or is
   it purely cosmetic?

## Survey (diary rollup, adapted for n=1)

1. Out of the last 10-12 merged PRs, in how many was `/10x-impl-review`
   actually run before merge? (count / total)
2. Of those, how many produced at least one finding that was fixed
   pre-merge?
3. How many _escaped_ bugs (found after merge) existed in that window, and
   for each: in-scope for an AGENTS.md-hard-rules checklist, or not?
4. Best guess: what fraction of a typical PR's real risk is covered by
   AGENTS.md hard rules (RLS, prerender, secrets, protected routes) vs.
   business-logic correctness that no fixed checklist would catch?
5. Open: describe the RLS/GRANT incident's timeline in one or two
   sentences — was impl-review run before that migration shipped?

## Decision Criteria

- **Proceed** if: the retrospective shows `/10x-impl-review` was skipped (not
  run) at least once before a PR that later needed a fix for something the
  checklist _would_ have caught — i.e., the gap is demonstrably a
  triggering/discipline problem, not a checklist-existence problem.
- **Narrow scope** if: impl-review is run consistently already, but its
  output sometimes sits unacted-on until late in the session — in that
  case, just make posting-as-PR-comment a lightweight last step of the
  _existing_ `/10x-impl-review` invocation (no new triggering/automation),
  rather than building a separate always-on gate.
- **Do not build yet** if: the retrospective shows impl-review already runs
  every time as a fixed step in the change workflow, and the one real
  incident (RLS/GRANT) predates the rule existing in `lessons.md` at all
  (i.e., it was a "the rule didn't exist yet" problem, already fixed by
  adding the rule) rather than a "the rule existed but wasn't checked"
  problem.
- **Try existing tool/process first** if: the evidence points toward the
  real gap being test/correctness coverage (per the #21 bug) rather than
  hard-rule compliance — in which case, invest in the existing
  `testing-*` rollout-phase track (already underway per recent archive
  folders) instead of a new checklist-automation tool.

### Follow-up fact (confirmed 2026-08-03)

The developer confirmed `/10x-impl-review` is _not_ always run — it's a
manual, discretionary step. That's a real, confirmed data point in favor of
the "Proceed" criterion above (the gap is genuinely a triggering/discipline
problem, not just a hypothetical one). Worth revisiting concretely later,
but the developer redirected to a related, distinct idea before this was
pursued further (see Candidate 3 below).

---

# Mom Test Validation Plan — Candidate 3: Independent "Second Pair of Eyes" PR Review

## Input Idea

While discussing Candidate 2, the developer raised a related but distinct
idea: not a task-specific hard-rules checklist, but a **general,
independent review of a finished PR** — as if a different programmer were
reading the diff cold, checking things like convention compliance, syntax,
and compatibility. Prompted by seeing VS's "Review changes with Copilot"
button. The developer was explicit: _"Nie mam pełnego obrazu dla tego
punktu"_ (no full picture yet) — this is a genuinely underspecified idea,
not a firm proposal.

## Hypotheses

- **User/role**: The solo developer, at the PR-ready moment, lacking a real
  second reviewer.
- **Suspected friction**: No fresh, independent eyes on a finished diff
  before merge — everything is reviewed by the same session/context that
  wrote it.
- **Current workaround**: None tried yet for this specific shape of review.
- **Proposed solution**: Some form of automated "independent reviewer" pass
  — exact shape undefined (general conventions/syntax/compatibility check,
  not task-specific).
- **Risky assumptions**:
  1. That this problem needs _building_ anything at all.
  2. That "no second pair of eyes" is costing something concrete, rather
     than being background solo-dev unease.
- **Evidence already present** (clarifying answers just given):
  - **The developer has never used the already-built-in `/code-review`
    command** (or `/code-review ultra`, the multi-agent cloud variant) on
    this repo. This is a zero-cost, already-available tool that does
    close to exactly what's being described — an independent read of a
    diff, distinct from the task-specific `/10x-impl-review`.
  - **There is no specific recent incident driving this** — the developer's
    own framing was "a more general worry about lacking a second pair of
    eyes," not a remembered PR that went wrong for a convention/syntax/
    compatibility reason. The VS Copilot button was the trigger for the
    idea, not a project pain point.

## Critique

This is the weakest-evidence candidate of the three discussed today, by the
developer's own account: no specific incident, no prior attempt at the
existing tool that already covers this ground, and an explicit
acknowledgment of not having a full picture. That combination — general
unease plus an untried, zero-cost existing solution — is close to a textbook
"try the existing tool before considering building anything" case. Building
a new independent-review mechanism before even running `/code-review` once
would be solving a problem that might already be solved.

The one legitimate distinction worth preserving: `/10x-impl-review` reviews
_against this project's specific plan and rules_ (task-shaped), while
`/code-review` reviews _the diff generically_ (reviewer-shaped) — these are
different lenses, and it's plausible both have a place. But that's a reason
to _try_ `/code-review` next, not to design something new yet.

## Decision Criteria

- **Proceed** (design something new) if: after running `/code-review` (and
  optionally `/code-review ultra`) on the next 3-5 real PRs, it either (a)
  reliably misses a class of issue the developer cares about, or (b) the
  output format/workflow friction (e.g., where results land, how they're
  acted on) is itself the blocker — concrete enough to name.
- **Narrow scope** if: `/code-review` mostly works but only for specific
  issue types (e.g., style vs. logic) — narrow any future work to the gap,
  not a full rebuild.
- **Do not build yet** if: `/code-review` on a handful of real PRs already
  gives a satisfying "second pair of eyes" feeling with no notable gap.
- **Try existing tool/process first**: this is the default recommendation
  right now — run `/code-review` on the next PR (this repo already has one
  in flight potential candidates) before speccing anything further. Zero
  build cost, already answers most of what was described.

### Follow-up: automation research + conclusion (2026-08-03)

Researched whether `/code-review` can run automatically on a PR event.
Confirmed two real, supported mechanisms:

1. **Anthropic-managed "Code Review" integration** — auto-triggers on PR
   open/push/`@claude review` comment, posts inline PR comments, never
   blocks merge. Requires a **Team/Enterprise plan** and costs **~$15-25 per
   review**, billed separately — likely not a fit for a solo developer on a
   standard plan.
2. **Self-hosted GitHub Actions + `claude-code-action`** — a `pull_request`
   workflow that invokes `/code-review` (or `/code-review ultra`), billed
   per-token against the developer's own API key. Cheaper, more solo-dev
   appropriate, but is real setup work (GitHub App install, `ANTHROPIC_API_KEY`
   secret, workflow file).

**Conclusion / recommended direction**: don't build either automation path
yet. First, manually run `/code-review` on the next 3-5 real PRs (zero cost,
zero setup) to get a real signal on whether it catches anything the
developer cares about (per the Decision Criteria above). _If_ that signal is
positive, the preferred next step — raised in discussion — is not the paid
managed integration, but a lightweight **Claude Code hook**: a `PreToolUse`
hook on `gh pr create` that blocks the PR-open call until `/code-review` has
been run in-session. This directly targets the exact failure mode already
confirmed for Candidate 2 (a discretionary "remember to run it" step gets
skipped under pressure) rather than relying on an instruction in
AGENTS.md/CLAUDE.md, which is soft and equally skippable. This project
already has precedent for this pattern (`dc30b65 feat(hooks): wire agent
PostToolUse hook and Git pre-commit test gate`).

Caveat: a `gh pr create` hook only covers PRs opened by the agent inside a
Claude Code session — it would not catch a PR opened manually via the
GitHub web UI. Acceptable given the developer's actual workflow (PRs are
opened via the 10xDevs change workflow, through the agent), but worth
naming explicitly.

**Not yet implemented** — deferred until the manual `/code-review` trial
produces a real signal; if pursued, route through the `update-config` skill
to add the hook in `.claude/settings.json`.

---

# Mom Test Validation Plan — Candidate 4: CI-Failure Diagnostics

## Input Idea

**Candidate**: "CI failures block work until manually noticed; diagnosing
them means re-deriving context" — an on-demand "what broke CI" check that
fetches the latest run (`gh run view`) and surfaces the failing step + log
excerpt, no auto-fix.

Source: `context/team/opportunity-map.md`, Map row 2.

## Hypotheses

- **User/role**: The solo developer, after pushing/merging, when CI does
  something unexpected.
- **Friction**: No proactive surfacing of failures; discovering and
  diagnosing them requires manually going to check status + logs and
  reconstructing what broke.
- **Current workaround**: GitHub's default email/web notification; manual
  `gh run view` / web UI when something seems off.
- **Risky assumptions**:
  1. That failures actually go unnoticed for meaningful periods (vs. being
     caught immediately since the developer is right there opening the PR).
  2. That the cost is in _finding the log_, rather than in the _reasoning_
     needed to root-cause the failure (which a log excerpt alone doesn't
     replace).
  3. That the relevant failure surface is generic "CI on my current
     branch" (as scoped in the map) rather than something narrower.

## Evidence (pulled directly from `gh run list`/`gh run view`, not assumed)

This is the best-evidenced candidate of the four on the map — real,
quantified CI history, not inference from commit messages:

- **60 total CI runs, 9 failures (15%)** — a real, non-trivial failure rate.
- **Most PR-branch failures are caught and fixed fast**, because the
  developer is actively in-session on that branch:
  - `hooks-and-triggers` PR: failed 2026-07-30T18:39:31Z → fixed
    2026-07-30T18:42:09Z (**~3 min**).
  - `feature/workout-history` PR: failed twice (20:04, 20:19) → fixed
    20:36:09 same day (**within ~32 min**).
  - `main` push 2026-07-15T15:11:54Z (a real, non-trivial root cause — an
    `astro-eslint-parser` bug interacting with
    `@typescript-eslint/no-misused-promises`) → fixed 15:40:16Z
    (**~29 min**), commit `eab84fd`. Diagnosing _this one_ took real
    reasoning (parser internals, ESLint version constraints) that a log
    excerpt alone wouldn't fully resolve — but it was still caught same-day.
  - **These fast turnarounds are evidence _against_ assumption 1** for the
    PR-branch case: failures there are not "blocking work until manually
    noticed" — they're noticed almost immediately, because merging is the
    very next thing the developer does.
- **But one real incident matches the friction description exactly, and
  it's worse than the map's framing implies**: on 2026-07-24T19:42:36Z, a
  push to `main` triggered a CI run where the **`ci` job passed** (lint,
  tests, build all green) but the **`deploy` job failed** —
  `supabase db push` rejected the run with "Found local migration files to
  be inserted before the last migration on remote database" (a migration
  timestamp collision from parallel/worktree work). Because `ci` stayed
  green, PRs kept merging normally — **production simply stopped receiving
  new code, silently, for ~66 hours**, until `fix(migrations): correct
out-of-order timestamp on workout session logging migration` landed on
  2026-07-27T13:38:14Z. A second `main` push in between
  (2026-07-26T11:49:47Z, docs-only) also failed the same way, meaning the
  developer pushed to `main` at least once _during_ the outage without
  registering that deploy was broken.
- A second, more ambiguous gap exists from 2026-07-09 to 2026-07-15 (also a
  `main`-push failure to a `main`-push failure), but predates branch
  protection (added 2026-07-30) — less conclusive since pushes weren't
  gated on green CI yet at that point.

## Critique

Unlike Candidates 1-3, this one has **hard, quantified evidence of a real,
multi-day, costly incident** — not a vague sense of friction. But the
evidence also reshapes the candidate's scope in an important way:

1. **The map's framing ("current branch CI") doesn't match where the real
   damage happened.** PR/feature-branch CI failures are already
   self-resolving fast (developer is right there). The one incident that
   actually cost real time was a **`deploy`-job failure on `main`, invisible
   because the `ci` job — the thing branch protection and PR review both
   watch — stayed green.** A tool scoped to "check my current branch's
   latest run" would mostly duplicate what already works; a tool scoped to
   "is `main` actually deployed / did the last push to `main` fully
   succeed, including `deploy`" would have caught the one incident that
   actually mattered.
2. **On-demand doesn't fully solve the demonstrated case.** The map
   proposes an on-demand check (deliberately deferring proactive/scheduled
   checks as "a later, separate step"). But the ~66-hour outage happened
   precisely because nobody thought to _ask_ — an on-demand tool only helps
   if invoked, and the developer already pushed once _during_ the outage
   without checking. This doesn't invalidate building an on-demand version
   first (cheap, useful baseline), but it does mean the honest read of the
   evidence points toward the proactive/scheduled version being the part
   that actually would have prevented the real incident — worth not
   over-deferring that step.
3. **Log-excerpt-only has mixed sufficiency.** For the migration-ordering
   incident, the log excerpt is fully self-explanatory ("Found local
   migration files to be inserted before the last migration... Rerun with
   --include-all") — a log-tail tool would have made this trivial to spot.
   For the eslint-parser incident, the raw error (`nullThrows: Expected
node to have a parent`) is far less self-explanatory and needed real
   investigation beyond the log. So "surface failing step + log excerpt" is
   sufficient for some failure classes and only a starting point for others
   — reasonable to still build, just don't expect it to fully replace
   diagnostic reasoning.

## Decision Criteria

- **Proceed**, but **narrow the scope from "current branch" to "did the
  last push to `main` fully succeed, `ci` and `deploy` both"** — this is
  where the one real, costly, multi-day incident actually occurred, and
  where GitHub's default notifications (as configured today) evidently
  didn't surface the problem in time.
- **Include a proactive/scheduled check sooner than "later, separate
  step"** if a repeat of the ~66-hour pattern would be costly again (it
  would — same class of risk exists any time a worktree/parallel-branch
  migration timestamp collides). An on-demand-only tool is a reasonable
  first cut, but the strongest single change here is closer to "notice
  when `main`'s deploy job fails" than "let me ask about my current
  branch."
- **Narrow scope to on-demand only** if the developer is comfortable
  manually checking `main`'s deploy status right after every merge (cheap
  habit) rather than building any automation — in which case the tool is
  just a faster/more convenient version of `gh run view`.
- **Do not build** — not supported by the evidence; this is the strongest
  case for building of the four candidates reviewed today.
