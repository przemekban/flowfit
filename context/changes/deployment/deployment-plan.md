# Deploy Plan: FlowFit → Cloudflare Workers (first deploy)

## Context

FlowFit is built on Astro 6 SSR + `@astrojs/cloudflare` v13, which already targets the Cloudflare Workers runtime. The platform decision is recorded in `context/foundation/infrastructure.md`. This is the first deploy — the goal is to get the app live with secrets wired and a working CI auto-deploy on merge to `main`.

Three pre-flight issues were found and fixed before deploying:
1. `wrangler.jsonc` carried the starter template name (`10x-astro-starter`) → renamed to `flowfit`
2. CI workflow targeted `master` but repo default branch is `main` → fixed to `main`
3. CI had no deploy step → added `deploy` job gated on push to `main`

---

## Step 1 — Create a Cloudflare Account

1. Go to **dash.cloudflare.com** → click **Sign Up**
2. Enter email + password → verify your email via the confirmation link
3. Skip the "Add a site" prompt (click **Skip** or navigate directly to the dashboard)
4. No credit card required. The free Workers tier covers 100K requests/day.

---

## Step 2 — Authenticate Wrangler

Wrangler is already installed as a dev dependency. Run:

```bash
! npx wrangler login
```

This opens a browser OAuth flow. Approve access, return to the terminal — it prints "Successfully logged in." The token is cached in `~/.wrangler/config/` and persists across sessions.

**Verify:**
```bash
! npx wrangler whoami
```
Should print your email and account name.

---

## Step 3 — Create a Supabase Cloud Project

FlowFit uses Supabase for authentication. The production Worker needs a cloud-hosted Supabase project — a local `npx supabase start` stack is not reachable from Cloudflare's edge.

### 3a — Create account and project

1. Go to **supabase.com** → **Start your project** → sign up with GitHub or email
2. Create a new **Organization** (e.g. "Personal" or "FlowFit")
3. Click **New project**:
   - **Name**: `flowfit`
   - **Database password**: generate a strong one and save it (needed if you ever connect to Postgres directly)
   - **Region**: closest to your users (e.g. `eu-central-1` for Poland)
   - **Plan**: Free
4. Click **Create new project** — provisioning takes ~2 minutes

### 3b — Get your credentials

Once the project is ready:

1. Go to **Settings → API** in the Supabase dashboard
2. Copy two values:
   - **Project URL** — looks like `https://xxxxxxxxxxx.supabase.co`
   - **anon / public key** — the long JWT string under "Project API keys"

### 3c — Email confirmation (optional)

By default Supabase requires users to confirm their email before signing in. To skip this during early testing:

1. Supabase dashboard → **Authentication → Providers → Email**
2. Toggle **"Confirm email"** off

Re-enable it before going fully public. When enabled, Supabase's built-in email service handles confirmation emails (free tier: ~3 emails/hour — sufficient for an MVP).

---

## Step 4 — Set Production Secrets in Cloudflare

With wrangler authenticated (Step 2) and Supabase credentials in hand (Step 3b), push the secrets to your Worker:

```bash
! npx wrangler secret put SUPABASE_URL
```
Paste the **Project URL** when prompted, then press Enter.

```bash
! npx wrangler secret put SUPABASE_KEY
```
Paste the **anon key** when prompted, then press Enter.

Secrets are stored encrypted in Cloudflare's vault and injected at request time. They never appear in `wrangler.jsonc` or source control.

**Verify:**
```bash
! npx wrangler secret list
```
Should show `SUPABASE_URL` and `SUPABASE_KEY` (values hidden).

---

## Step 5 — Build and Deploy

Tell the agent to run the build and deploy. The agent executes:

```bash
npm run build && npx wrangler deploy
```

The CLI prints the production URL on success, e.g.:
```
https://flowfit.<your-account-subdomain>.workers.dev
```

---

## Step 6 — Verify the Deploy

1. Open the workers.dev URL in a browser — confirm the homepage renders
2. Test auth at `/auth/signup` and `/auth/signin`
3. Confirm `/dashboard` redirects unauthenticated users to `/auth/signin`
4. Monitor errors during the initial window (keep open in a terminal):
   ```bash
   ! npx wrangler tail --status error
   ```
5. Bundle size check (free-tier 3 MB gzip cap):
   ```bash
   ! npx wrangler deploy --dry-run 2>&1 | grep -i "bundle\|size"
   ```

---

## Step 7 — GitHub Repository and CI Auto-Deploy

### 7a — Push to GitHub (if not done)

1. Go to **github.com** → **New repository** → name it `flowfit`, do **not** initialize with README
2. Push your local repo:
   ```bash
   git remote add origin https://github.com/<your-username>/flowfit.git
   git push -u origin main
   ```

### 7b — Create a scoped Cloudflare API token

CI needs a token to deploy with minimum required access:

1. Cloudflare dashboard → **My Profile** (top-right avatar) → **API Tokens**
2. Click **Create Token** → choose template **"Edit Cloudflare Workers"**
3. Under **Account Resources**: select your account
4. Under **Zone Resources**: leave as **All zones**
5. Click **Continue to summary** → **Create Token**
6. Copy the token — **it's shown only once**

### 7c — Add GitHub repository secrets

Go to your GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**. Add four secrets:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Scoped token from Step 7b |
| `CLOUDFLARE_ACCOUNT_ID` | Found in Cloudflare dashboard right sidebar under "Account ID" |
| `SUPABASE_URL` | Same Project URL from Step 3b |
| `SUPABASE_KEY` | Same anon key from Step 3b |

### 7d — Trigger the first CI run

Push the changes already made in this session:

```bash
git add wrangler.jsonc .github/workflows/ci.yml context/
git commit -m "chore: configure worker name, fix CI branch, add deploy job"
git push
```

Go to **GitHub → Actions** and watch the `CI` workflow. The `ci` job runs lint + build; the `deploy` job runs `wrangler deploy` after `ci` passes. Subsequent merges to `main` auto-deploy without manual intervention.

---

## Quick Reference

| Action | Command | Who |
|---|---|---|
| Login to Cloudflare | `npx wrangler login` | Human (browser OAuth) |
| Verify login | `npx wrangler whoami` | Human |
| Set a secret | `npx wrangler secret put <KEY>` | Human (interactive) |
| List secrets | `npx wrangler secret list` | Human |
| Build | `npm run build` | Agent |
| Deploy | `npx wrangler deploy` | Agent |
| Watch live errors | `npx wrangler tail --status error` | Human |
| Rollback | `npx wrangler rollback` | Agent |

---

## Risk Register

| Risk | Action |
|---|---|
| Free-tier 10ms CPU ceiling → silent 1101 errors | Monitor `wrangler tail --status error`; upgrade to Workers Standard ($5/mo) if any SSR route exceeds the limit |
| `astro:env/server` / `wrangler.jsonc` out of sync → silent `undefined` in prod | Both secrets must be set (Step 4) before deploy |
| `nodejs_compat_v2` active (compatibility_date 2026-05-08 ≥ 2024-09-23) | Do not advance `compatibility_date` without testing |
| CI token over-scoped | Scope token to `Workers Scripts: Edit` on `flowfit` only (Step 7b) |
| Pre-mortem: CPU + bundle + Node.js API gaps compound at month 3 | Test the full AI generation route in production before launch; upgrade to Workers Standard proactively |
