---
bootstrapped_at: 2026-05-25T15:54:28Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: flowfit
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
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
```

### Why this stack

FlowFit is a solo-built, 3-week after-hours MVP targeting small scale with auth and AI-generated training plans as its two load-bearing features. The 10x Astro Starter is the recommended default for (web-app, js) and clears all four agent-friendly gates: typed (TypeScript + Zod end-to-end), convention-based (Astro file routing, Supabase schema conventions), popular in JS training data, and well-documented. Supabase covers both the auth FRs (FR-001 to FR-003) and the per-user data isolation guardrail via Row Level Security on PostgreSQL. The AI plan-generation feature (FR-006) integrates as an Astro API route calling the Anthropic SDK — no structural change to the starter required. Cloudflare Pages deployment is zero-config with this starter; GitHub Actions with auto-deploy-on-merge matches the solo shipping cadence. Bootstrapper confidence is first-class: scaffolding is expected to be smooth with occasional manual steps.

## Pre-scaffold verification

| Signal      | Value                                          | Severity | Notes                                              |
| ----------- | ---------------------------------------------- | -------- | -------------------------------------------------- |
| npm package | not run                                        | n/a      | cmd_template starts with `git clone`; npm check skipped |
| GitHub repo | przeprogramowani/10x-astro-starter pushed 2026-05-17 | fresh    | from card.docs_url via GitHub API                  |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (starter repo cloned without keeping upstream git history)
**Exit code**: 0 (git clone: 0; npm install: 0)
**Files moved**: 20 top-level items (directories: `.github`, `.husky`, `.vscode`, `node_modules`, `public`, `src`, `supabase`; files: `.env.example`, `.gitignore`, `.nvmrc`, `.prettierrc.json`, `astro.config.mjs`, `CLAUDE.md`, `components.json`, `eslint.config.js`, `package-lock.json`, `package.json`, `README.md`, `tsconfig.json`, `wrangler.jsonc`)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently (no .gitignore pre-existed in cwd)
**.bootstrap-scaffold cleanup**: deleted (via `cmd /c rd /s /q`)

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 9 MODERATE, 0 LOW
**Direct vs transitive**: HIGH 0/1 direct/total; MODERATE 2/9 direct/total (direct packages: `@astrojs/check`, `wrangler`)

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** v5.6.3–5.8.0
  - Advisory: GHSA-77vg-94rm-hx3p — "Svelte devalue: DoS via sparse array deserialization"
  - CVSS: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
  - CWE: CWE-770
  - Direct: no (transitive, pulled in by the dependency tree)
  - Fix available: yes (update to a version outside 5.6.3–5.8.0)

#### MODERATE findings

1. **@astrojs/check** >=0.9.3 — direct; via `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml`; fix: downgrade to `@astrojs/check@0.9.2` (semver major)
2. **wrangler** 3.108.0–4.93.0 — direct; via `miniflare` → `ws`; fix available
3. **@astrojs/language-server** >=2.14.0 — transitive; via `volar-service-yaml`
4. **@cloudflare/vite-plugin** <=0.0.0-fff677e35 or 0.0.7–1.37.2 — transitive; via `miniflare`, `wrangler`, `ws`
5. **miniflare** <=0.0.0-fff677e35 or 3.20250204.0–4.20260518.0 — transitive; via `ws`
6. **volar-service-yaml** <=0.0.70 — transitive; via `yaml-language-server`
7. **ws** 8.0.0–8.20.0 — transitive; "ws: Uninitialized memory disclosure" (CVSS 4.4)
8. **yaml** 2.0.0–2.8.2 — transitive; "Stack Overflow via deeply nested YAML collections" (CVSS 4.3)
9. **yaml-language-server** (range) — transitive; via `yaml`

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value               |
| ----------------------- | ------------------- |
| bootstrapper_confidence | first-class         |
| quality_override        | false               |
| path_taken              | standard            |
| self_check_answers      | null                |
| team_size               | solo                |
| deployment_target       | cloudflare-pages    |
| ci_provider             | github-actions      |
| ci_default_flow         | auto-deploy-on-merge|
| has_auth                | true                |
| has_payments            | false               |
| has_realtime            | false               |
| has_ai                  | true                |
| has_background_jobs     | false               |

These fields were read from the hand-off and logged here for audit-trail completeness. A future M1L4 skill ("Memory Architecture") will act on them (CLAUDE.md/AGENTS.md generation, CI/CD scaffolding, feature-flag–driven composition).

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep (none were created this run).
- Address audit findings per your project's risk tolerance — the HIGH finding in `devalue` is transitive and affects the dev toolchain (Astro's language server), not production runtime code. Run `npm audit fix` for auto-fixable MODERATEs; the `@astrojs/check` fix requires `--force` due to a semver major change.
