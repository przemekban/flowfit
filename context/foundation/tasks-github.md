# FlowFit — Task Management Reference

## System

GitHub Issues on `przemekban/flowfit`. Single milestone **MVP** groups all delivery items. No project board — the issue list is the backlog.

### Labels

| Label | Color | Meaning |
|---|---|---|
| `foundation` | amber | horizontal enabler; blocks one or more slices |
| `slice` | blue | vertical, user-visible feature |
| `blocked` | red | waiting on a prerequisite or open decision |
| `nice-to-have` | teal | may slip past MVP if capacity is tight |

---

## Issue → Roadmap mapping

| Issue | Roadmap ID | Change ID | Status |
|---|---|---|---|
| [#2](https://github.com/przemekban/flowfit/issues/2) | F-01 | `core-db-schema` | ready |
| [#3](https://github.com/przemekban/flowfit/issues/3) | S-01 | `onboarding-survey` | proposed |
| [#4](https://github.com/przemekban/flowfit/issues/4) | S-02 | `ai-plan-generation` | blocked |
| [#5](https://github.com/przemekban/flowfit/issues/5) | S-03 | `workout-session-logging` | proposed |
| [#6](https://github.com/przemekban/flowfit/issues/6) | S-04 | `workout-history` | proposed |
| [#7](https://github.com/przemekban/flowfit/issues/7) | S-05 | `progress-indicators` | proposed |
| [#8](https://github.com/przemekban/flowfit/issues/8) | ORQ-2 | — | open decision |
| [#9](https://github.com/przemekban/flowfit/issues/9) | OQ-001 | — | post-MVP |

Source of truth for roadmap detail: `context/foundation/roadmap.md`.

---

## Dependency chain

```
#2 F-01 (core-db-schema)
├── #3 S-01 (onboarding-survey)
│   └── #4 S-02 (ai-plan-generation)  ← also blocked on #8 ORQ-2
│       └── #5 S-03 (workout-session-logging)  ← north star
│           └── #6 S-04 (workout-history)
│               └── #7 S-05 (progress-indicators)  [nice-to-have]
│
#8 ORQ-2 (AI provider decision)  ──── blocks #4 S-02
#9 OQ-001 (profile reset)        ──── post-MVP, no blocking dependency
```

**Start here:** `#2 F-01` is the only item with no prerequisites.  
**North star:** `#5 S-03` (workout session logging) — the smallest end-to-end flow that proves the product hypothesis.

---

## Common gh recipes

All commands target `przemekban/flowfit`. Omit `--repo` if you have it set as the default remote.

### View

```bash
# List open issues
gh issue list --repo przemekban/flowfit

# List MVP milestone issues only
gh issue list --repo przemekban/flowfit --milestone MVP

# View a specific issue
gh issue view 2 --repo przemekban/flowfit

# View in browser
gh issue view 2 --repo przemekban/flowfit --web
```

### Start work

```bash
# Assign yourself and add a comment
gh issue edit 2 --repo przemekban/flowfit --add-assignee "@me"
gh issue comment 2 --repo przemekban/flowfit --body "Starting work on this."
```

### Update status via labels

```bash
# Mark as in progress (remove blocked label if present)
gh issue edit 4 --repo przemekban/flowfit --remove-label "blocked"

# Mark a decision as resolved
gh issue edit 8 --repo przemekban/flowfit --remove-label "blocked"
gh issue comment 8 --repo przemekban/flowfit --body "Decision: Anthropic SDK directly. Unblocks #4."
```

### Close

```bash
# Close as completed
gh issue close 2 --repo przemekban/flowfit --comment "Done. Migration applied, seed loaded."

# Close as not planned (post-MVP slip)
gh issue close 7 --repo przemekban/flowfit --reason "not planned" --comment "Slipping past MVP — capacity."
```

### Link issues (cross-reference)

GitHub auto-links issue numbers. In comments and PR descriptions, write `#2` and it becomes a clickable reference. To signal a hard dependency, use:

```
Blocked by #2.
Closes #5.
```

### Create a PR that closes an issue

```bash
gh pr create --repo przemekban/flowfit \
  --title "feat: core database schema and RLS" \
  --body "Closes #2." \
  --label "foundation"
```

### Milestone progress

```bash
# See open vs closed count for MVP
gh api repos/przemekban/flowfit/milestones/1 --jq '{open: .open_issues, closed: .closed_issues}'
```
