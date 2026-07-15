---
change_id: ai-plan-generation
title: AI-generated weekly training plan and plan display screen
status: archived
created: 2026-07-10
updated: 2026-07-15
archived_at: 2026-07-15T15:14:40Z
---

## Notes

Corresponds to roadmap slice S-02 (GitHub issue #4), which was blocked on ORQ-2 (issue #8, now closed).

- FR-006: generate a personalized weekly training plan from the user's onboarding survey profile (see `onboarding-survey` change / `user_profiles` table).
- FR-005: profile from the survey is the input for plan generation.
- Provider decision (ORQ-2, closed 2026-07-10): call the Anthropic SDK directly (not OpenRouter), model `claude-sonnet-5`, using structured outputs (`output_config.format` json_schema) to constrain the weekly-plan JSON shape. See `context/foundation/tech-stack.md`.
- **ORQ-2 reopened and reversed (2026-07-10, same day):** Anthropic API is not free; user requires a $0 provider. Switched to the Google Gemini API free tier via `@google/genai`, using `responseJsonSchema` (built from the same Zod schema via `z.toJSONSchema()`) for structured output instead of Anthropic's `zodOutputFormat`/`messages.parse`. `ANTHROPIC_API_KEY` renamed to `GEMINI_API_KEY` throughout (`astro.config.mjs`, `.env.example`, `.dev.vars`). Model settled on `gemini-3.1-flash-lite` after testing. `tech-stack.md` and `plan.md` updated to match (see `tech-stack.md`'s ORQ-2 revision history and `research.md`'s Follow-up Research section).
- **Gemini index-mapping workaround:** Gemini's structured-output enforcement breaks on a large string enum/uuid nested inside a repeated array item, so the candidate exercise list is sent to the model with array indices instead of `exercise_id` UUIDs; the service maps indices back to real UUIDs post-parse and re-validates against the canonical schema. See `plan.md` Critical Implementation Details and `research.md` Follow-up Research for the full mechanism.
- Dependency: #2 F-01 (core-db-schema) and #3 S-01 (onboarding-survey) are both done.
