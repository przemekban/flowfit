---
change_id: ai-plan-generation
title: AI-generated weekly training plan and plan display screen
status: planned
created: 2026-07-10
updated: 2026-07-10
archived_at: null
---

## Notes

Corresponds to roadmap slice S-02 (GitHub issue #4), which was blocked on ORQ-2 (issue #8, now closed).

- FR-006: generate a personalized weekly training plan from the user's onboarding survey profile (see `onboarding-survey` change / `user_profiles` table).
- FR-005: profile from the survey is the input for plan generation.
- Provider decision (ORQ-2, closed 2026-07-10): call the Anthropic SDK directly (not OpenRouter), model `claude-sonnet-5`, using structured outputs (`output_config.format` json_schema) to constrain the weekly-plan JSON shape. See `context/foundation/tech-stack.md`.
- Dependency: #2 F-01 (core-db-schema) and #3 S-01 (onboarding-survey) are both done.
