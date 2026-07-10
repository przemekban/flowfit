---
starter_id: 10x-astro-starter
package_manager: npm
project_name: flowfit
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
---

## Why this stack

FlowFit is a solo-built, 3-week after-hours MVP targeting small scale with auth and AI-generated training plans as its two load-bearing features. The 10x Astro Starter is the recommended default for (web-app, js) and clears all four agent-friendly gates: typed (TypeScript + Zod end-to-end), convention-based (Astro file routing, Supabase schema conventions), popular in JS training data, and well-documented. Supabase covers both the auth FRs (FR-001 to FR-003) and the per-user data isolation guardrail via Row Level Security on PostgreSQL. The AI plan-generation feature (FR-006) integrates as an Astro API route calling the Google Gemini API directly via `@google/genai` — no structural change to the starter required. Model: Gemini 3.1 Flash Lite (`gemini-3.1-flash-lite`), using structured outputs (`responseJsonSchema`, built from the same Zod schema via `z.toJSONSchema()`) to constrain the weekly-plan response shape. Cloudflare Pages deployment is zero-config with this starter; GitHub Actions with auto-deploy-on-merge matches the solo shipping cadence. Bootstrapper confidence is first-class: scaffolding is expected to be smooth with occasional manual steps.

**ORQ-2 (provider/model decision) — revision history:**
1. **Original (closed):** Anthropic SDK direct (not OpenRouter), model `claude-sonnet-5`, structured outputs via `output_config.format` json_schema.
2. **Reversed same day (2026-07-10):** Anthropic's API is not free; the project requires a $0 AI provider. Evaluated Google Gemini (free tier), OpenRouter free models, Groq free tier, and Cloudflare Workers AI — chose **Google Gemini** for its genuinely free tier, generous rate limits, and strong structured-output enforcement (`responseJsonSchema`).
3. **Implementation note:** Gemini's structured-output enforcement breaks down on a large string enum/uuid field nested inside a repeated array item. The candidate exercise list is therefore sent to the model with a numeric array index instead of the `exercise_id` UUID directly; the service maps indices back to real UUIDs after parsing, then re-validates against the canonical (uuid-based) schema before persistence. See `context/changes/ai-plan-generation/plan.md` (Critical Implementation Details, Phase 3) for the full mechanism.
