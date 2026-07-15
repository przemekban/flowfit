---
project: FlowFit
researched_at: 2026-05-25T00:00:00Z
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 SSR
  runtime: Cloudflare Workers (V8 isolate / workerd)
  adapter: "@astrojs/cloudflare v13"
  database: Supabase (external)
  ai: Anthropic SDK / OpenRouter (external)
---

## Recommendation

**Deploy on Cloudflare Workers.**

The stack is already built for Cloudflare Workers: `@astrojs/cloudflare` v13 is installed, `wrangler.jsonc` is in place, and the Astro dev server runs `workerd` locally for faithful production parity. No adapter swap is needed — deployment is a single `npx wrangler deploy`. The free tier covers 100K requests/day (~3M/month), well beyond any realistic MVP load, and five out of five agent-friendly criteria pass: full CLI operability via Wrangler 4, pure serverless V8 isolate model, `cloudflare.com/llms.txt` + markdown docs, deterministic one-command deploy with `wrangler rollback`, and 16+ official remote MCP servers (GA). The three cross-check lenses surfaced real risks — specifically the 10ms free-tier CPU ceiling and Node.js API gaps in `workerd` — which are captured in the risk register.

## Platform Comparison

Scored Pass (2) / Partial (1) / Fail (0) against the five agent-friendly criteria from `references/agent-friendly-criteria.md`.

| Platform | CLI-first | Managed/Serverless | Agent docs | Stable deploy API | MCP/Integration | Total |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **10** |
| Netlify | Partial | Pass | Pass | Pass | Pass | 9 |
| Render | Partial | Pass | Pass | Pass | Pass | 9 |
| Vercel | Pass | Pass | Pass | Pass | Partial | 9 |
| Railway | Partial | Partial | Pass | Pass | Partial | 7 |
| Fly.io | Partial | Partial | Partial | Pass | Partial | 6 |

**Scoring notes per criterion:**

- **CLI-first**: Netlify, Render, Railway, and Fly.io all score Partial because rollback requires the dashboard UI or REST API — no dedicated CLI rollback command exists on any of them. Cloudflare has `wrangler rollback [<VERSION_ID>]`. Vercel has `vercel rollback`.
- **Managed/Serverless**: Railway and Fly.io score Partial — they run persistent containers (closer to managed VMs than pure serverless), which introduces more operational surface (server binding, Dockerfile, PORT env, etc.).
- **Agent docs**: Fly.io scores Partial — no `llms.txt`, docs are GitHub markdown but not indexed; agents must traverse HTML or use `fly mcp`. All others publish `llms.txt` or `llms-full.txt`.
- **Stable deploy API**: All platforms pass. `wrangler deploy`, `netlify deploy --prod`, `render deploys create --wait`, `vercel --prod`, `railway up`, and `fly deploy` are all deterministic and GA.
- **MCP/Integration**: Vercel MCP is beta. Railway MCP is labeled "preview / work in progress." Fly.io `fly mcp launch` is undocumented in terms of stability. Cloudflare, Netlify, and Render each have GA official MCP servers.

**Interview answers applied:**
- No persistent connections needed → no serverless-only platform eliminated from contention.
- Cost vs DX: no strong preference → neutral weight; no tier penalized.
- No platform familiarity → no tie-breaking applied.
- Single region fine → no edge-native bonus awarded.
- External providers (Supabase + OpenRouter) → no co-location preference credit.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Zero adapter migration (already configured), $0 at MVP load (100K req/day free), 5/5 agent-friendly criteria, strongest MCP coverage of any platform (16+ official remote MCP servers, GA). Wrangler 4 is already installed in the project. Local dev runs the real `workerd` runtime, not a Node.js emulation. The only cost risk is the free tier's 10ms CPU ceiling — mitigated by upgrading to Workers Standard ($5/month) if SSR routes compute beyond simple `fetch()` calls.

#### 2. Netlify

Strong runner-up. Official MCP server (GA, launched 2025-06-03), `docs.netlify.com/llms.txt`, free tier allows 125K function invocations/month (adequate for MVP). Rollback is UI-only (no `netlify rollback` CLI command), which is the single Partial in the scoring. The decisive weakness for this stack: the **10-second function timeout on the free tier** is a real risk for the AI plan generation feature (Anthropic API calls may exceed 10 seconds for complex prompts). Would require either the paid plan (60-second timeout) or careful streaming architecture to stay within the free tier. Requires swapping `@astrojs/cloudflare` for `@astrojs/netlify`.

#### 3. Render

Solid third. Official MCP server (GA since August 2025), `render.com/docs/llms.txt` + `llms-full.txt`, per-page `.md` URL access. Persistent Node.js Web Service model eliminates cold starts on the $7/month Starter tier (free tier has a 15-minute idle timeout with ~60-second cold start). MCP cannot trigger new deploys (must use CLI or deploy hook for CI). Rollback is dashboard or REST API — no `render rollback` CLI command. Requires swapping `@astrojs/cloudflare` for `@astrojs/node`.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Free tier 10ms CPU ceiling will surface on compute-heavy SSR routes.** `fetch()` waits don't count toward CPU, but Zod validation, React 19 SSR rendering, and middleware execution do. A plan-display route that does non-trivial in-isolate work can silently return a Workers 1101 error. Moving to Workers Standard ($5/month) removes the ceiling, but developers routinely discover this after launch, not before.

2. **Node.js API gaps in `workerd` create silent runtime failures.** `nodejs_compat` polyfills a subset of Node.js internals. The Anthropic SDK uses Node.js streams (`Readable`) for streaming responses — the `workerd` polyfill implements this differently from Node.js in concurrent-read scenarios. Failures are intermittent, appear only under real load, and produce cryptic stack traces that don't identify the missing API.

3. **3MB gzip bundle size ceiling (free tier) is reachable.** Astro 6 SSR output + React 19 + Anthropic SDK + Supabase client, compressed, can approach 3MB. Exceeding it hard-fails the deploy with no partial fallback. Code-splitting via dynamic `import()` is limited in the Workers module system — not all strategies that work in Node.js translate to V8 isolates.

4. **No persistent log storage without Logpush.** `wrangler tail` streams logs in real time but stores nothing. Production errors at off-hours leave no trace. Cloudflare's Logpush service (routes logs to R2/S3/Splunk) requires a paid plan and additional configuration. On the free tier, debugging production incidents relies entirely on `wrangler tail` being open when the failure occurs.

5. **Hard vendor lock-in to the V8 isolate runtime.** The `@astrojs/cloudflare` adapter, `astro:env/server` binding pattern, and `wrangler.jsonc` are all Cloudflare-specific. Any future platform migration requires full adapter swap, env re-wiring, and end-to-end retesting. Invisible switching costs compound as features are added.

### Pre-Mortem — How This Could Fail

The team shipped FlowFit on Cloudflare Workers. For the first two weeks, things looked fine — auth worked, the dashboard loaded fast, static assets were instant. Then "Generate Plan" started returning blank pages for some users. No error appeared in the Cloudflare dashboard; just a cryptic 1101 code in the network tab. Local `workerd` dev worked fine because the development environment ran with a generous compatibility date and uncapped CPU.

In production, on the free tier's 10ms CPU budget, the plan generation route — calling the Anthropic SDK, parsing the streaming JSON response with Zod, then rendering the full plan via Astro SSR — exceeded the CPU limit on the first AI call. Moving to Workers Standard ($5/month) fixed that, but exposed a second problem: the Anthropic SDK's streaming response handler used a Node.js `Readable` stream API that the `nodejs_compat` polyfill implemented incorrectly under concurrent reads. The failure was intermittent and appeared only under real request load, not in dev.

By month three, new features had pushed the bundle past the 3MB gzip limit. The deploy hard-failed with a Wrangler error. Attempting to code-split didn't work the way it does in Node.js — the Workers module system resolved dynamic imports at build time. Extracting the AI logic into a separate Worker became necessary, adding routing complexity the MVP architecture hadn't anticipated.

The root failure: the team assumed "it works in local workerd" meant "it works in production Workers" without testing the specific runtime constraints — CPU limits, Node.js API compatibility, and bundle size — before launch.

### Unknown Unknowns

- **`astro:env/server` and `wrangler.jsonc` bindings must be kept in sync manually.** If the Astro env schema declares a variable that isn't listed as `[vars]` or a secret in `wrangler.jsonc`, the app receives `undefined` at runtime — no startup error, no warning. `.dev.vars` (used locally) is independent of production bindings, making this a common "works in dev, breaks in prod" failure.

- **`nodejs_compat_v2` activates automatically on compatibility dates ≥ 2024-09-23.** A recent `compatibility_date` in `wrangler.jsonc` silently activates v2 polyfill behavior, which changes how several Node.js built-ins work. Libraries tested against the v1 polyfill can break without warning.

- **CI GitHub Actions token must be scoped, not account-level.** The `CLOUDFLARE_API_TOKEN` for CI must be scoped to `Workers Scripts: Edit` for the specific Worker. An account-level token either fails with confusing permission errors or grants unintended write access to other projects.

- **`wrangler tail` sessions are preempted silently.** Two simultaneous `wrangler tail` sessions on the same Worker cause one to drop without warning — useful to know when a dev and a CI system are both monitoring the same Worker.

- **128MB memory per isolate is a hard kill, not a soft limit.** Unlike a Node.js server that degrades gracefully under memory pressure, a Workers isolate that exceeds 128MB is terminated immediately. React 19 SSR + Anthropic SDK + Supabase client in a single isolate can approach this as the application grows.

## Operational Story

- **Preview deploys**: Cloudflare Pages (used alongside Workers for static assets) automatically creates preview URLs for each branch push via GitHub integration. For the Workers SSR path, use `wrangler deploy --env staging` or a separate `wrangler.jsonc` environment block to target a staging Worker. Preview Workers are not password-protected by default; add Cloudflare Access (Zero Trust) to gate them if needed.
- **Secrets**: Set with `npx wrangler secret put <KEY>` (one per call, interactive prompt for value). Secrets are stored encrypted in Cloudflare's vault, injected into the Worker at request time. They are declared in `wrangler.jsonc` under `[vars]` for non-secret values; secrets never appear in plaintext in config. To rotate: `wrangler secret put <KEY>` again — the new value activates on the next deploy.
- **Rollback**: `npx wrangler rollback [<VERSION_ID>]` reverts to a prior deployment version. Without `VERSION_ID`, reverts to the immediately previous deployment. Time-to-revert is typically under 30 seconds (global propagation). Database migrations performed alongside the rolled-back deployment do NOT roll back automatically — Supabase migrations must be reversed manually via a down migration if schema-breaking.
- **Approval**: Agents may run `wrangler deploy`, `wrangler secret put`, `wrangler tail`, and `wrangler rollback` unattended. Human-only operations: creating or deleting Workers projects in the dashboard, rotating the Cloudflare API token, modifying DNS/routing, and any billing tier changes.
- **Logs**: `npx wrangler tail [WORKER_NAME]` streams live request and error logs. Filter by `--status error` to see only failures. For persistent log storage, configure Logpush in the Cloudflare dashboard to forward logs to R2 or an external sink (requires paid plan). Without Logpush, log history is ephemeral — only available while the `tail` session is active.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Free tier 10ms CPU ceiling causes silent 1101 errors on SSR routes | Devil's advocate | High | High | Test with `wrangler deploy --dry-run` + load test before launch; upgrade to Workers Standard ($5/mo) immediately if any SSR route does non-trivial computation |
| Anthropic SDK streaming uses Node.js Readable streams; `workerd` polyfill may diverge | Devil's advocate | Medium | High | Test streaming plan generation end-to-end in production Workers (not just local workerd); fall back to non-streaming if needed |
| Bundle size approaches 3MB gzip limit on free tier as features are added | Devil's advocate | Medium | Medium | Run `wrangler deploy --dry-run` in CI to track bundle size; move to Workers Standard (10MB cap) at first warning |
| `wrangler tail` ephemeral — production errors leave no trace without Logpush | Devil's advocate | High | Medium | Set up Cloudflare Logpush to R2 at first sign of production issues; keep a terminal with `wrangler tail --status error` open during initial launch |
| `astro:env/server` and `wrangler.jsonc` bindings out of sync causes silent `undefined` in production | Unknown unknowns | Medium | High | Add a startup validation that reads all declared env keys and throws if any are `undefined`; cross-check `.dev.vars` against `wrangler.jsonc` before each deploy |
| `nodejs_compat_v2` activates silently on new compatibility dates, breaking v1-tested libraries | Unknown unknowns | Low | Medium | Pin `compatibility_date` in `wrangler.jsonc` and only advance it after testing the full suite in staging |
| CI API token scoping grants more production access than intended | Unknown unknowns | Low | High | Use `wrangler token create --permissions "Workers Scripts:Edit"` scoped to the specific project; store in GitHub Secrets, not in code |
| Platform lock-in makes future migration expensive as adapter-specific code accumulates | Devil's advocate | Medium | Low (MVP) | Acceptable for MVP; document the Cloudflare-specific patterns in AGENTS.md so a future migration is scoped correctly |
| Pre-mortem: free tier CPU + bundle + Node.js API gaps compound into a multi-week debugging crisis at month 3 | Pre-mortem | Low | High | Upgrade to Workers Standard proactively; test the full AI generation route in production before launch week |

## Getting Started

1. **Authenticate with Cloudflare:**
   ```bash
   npx wrangler login
   ```
   This opens a browser OAuth flow. The token is cached in `~/.wrangler/config/`.

2. **Verify the local dev server (already configured):**
   ```bash
   npm run dev
   ```
   Astro 6 + `@astrojs/cloudflare` v13 starts `workerd` directly — no separate Wrangler command needed. Confirm the app loads at `http://localhost:4321`.

3. **Set production secrets before first deploy:**
   ```bash
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   npx wrangler secret put GEMINI_API_KEY
   ```
   Enter values interactively when prompted. These are injected into the Worker at request time; they do not appear in `wrangler.jsonc`. `GEMINI_API_KEY` (added 2026-07-15, for the `ai-plan-generation` feature) is optional at build time — the app degrades to a clean `502` if unset — but is required for `/api/plan` to actually generate plans in production. Verify what's currently set with `npx wrangler secret list` (names only, no values).

4. **Deploy to production:**
   ```bash
   npm run build && npx wrangler deploy
   ```
   The build step compiles Astro SSR output; `wrangler deploy` uploads the bundle and activates it globally. The CLI prints the production URL on success.

5. **Tail live logs after launch:**
   ```bash
   npx wrangler tail --status error
   ```
   Streams only error-level events. Run `npx wrangler tail` (no filter) for all request logs. Keep a session open during the first deployment window.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (GitHub Actions wiring for `wrangler deploy`)
- Production-scale architecture (multi-region, Durable Objects HA, D1 read replication)
- Cloudflare Access / Zero Trust setup for preview environment gating
