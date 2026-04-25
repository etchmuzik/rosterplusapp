# Deploying ROSTR+

**Push to `main` → Netlify deploys.** That's the whole flow. The
old manual `lftp` script still works as an emergency-rollback path
while Hostinger runs in parallel.

## Everyday flow

```bash
git add <files>
git commit -m "feat: …"
git push origin main
```

Done. Netlify picks up the push, runs `bash scripts/deploy-stamp.sh`
(rotates `sw.js` `CACHE_NAME`, stamps `window.ROSTR_VERSION`, appends
`?v=<sha>` to every `/assets/*` reference in HTML), then publishes.
Site goes live in ~30 seconds. CDN propagation finishes within a few
seconds of that.

Visitors on a stale service-worker cache see the new build on their
next navigation thanks to the `CACHE_NAME` rotation. Hard refresh
(Cmd+Shift+R) is never required for end users.

## What Netlify does on every push

In order:

1. **Pulls** `main` at the deploying SHA.
2. **Runs** `bash scripts/deploy-stamp.sh` (the build command in
   [`netlify.toml`](./netlify.toml)). The script writes the SHA into:
   - `sw.js` → `CACHE_NAME = 'rostr-<sha>'`
   - `assets/js/app.js` → `window.ROSTR_VERSION = '<sha>'` at the top
   - Every `<link>` / `<script>` reference to `/assets/*.{css,js}` in
     every HTML file → `?v=<sha>` query string
3. **Applies** headers + redirects from `netlify.toml`:
   - Strict CSP, HSTS, anti-clickjacking, Permissions-Policy
   - 1y immutable cache on `/assets/*`, no-cache on HTML / sw.js
   - `/404.html` served on any unmatched path
4. **Publishes** to the global CDN.

## CI gates (GitHub Actions)

Runs in parallel with the Netlify build, on every PR + every push to
`main`. See [`.github/workflows/ci.yml`](./.github/workflows/ci.yml):

- `node --check` on `app.js`, `error-logger.js`, `sw.js`
- HTML well-formed check (every `*.html` closes `</html>`)
- Playwright `@smoke`-tagged tests against a local static server
- Visual regression (8 pages × 2 viewports)
- Lighthouse — accessibility ≥0.90, SEO ≥0.95

A red CI run does **not** block the Netlify deploy — Netlify and
GitHub Actions are independent. If you push something that fails CI
but Netlify already published it, you have a few minutes to either:

- Push a fix-forward commit (auto-deploys), or
- Roll back via the Netlify dashboard (Deploys → click the previous
  good build → "Publish deploy")

## Rolling back

Two paths:

1. **Netlify dashboard** (preferred): Deploys → pick a previous
   green build → "Publish deploy". Live in ~5 seconds. Doesn't
   touch git history.
2. **Git revert + push**: standard `git revert <sha>` + push,
   triggers a fresh Netlify deploy.

## Custom domain

`rosterplus.io` is configured at the registrar to point at Netlify's
load balancer. SSL cert is provisioned + auto-renewed by Netlify (Let's
Encrypt). HSTS preload is enforced via the
[`netlify.toml`](./netlify.toml) headers block.

## Emergency manual deploy (Hostinger fallback)

While Hostinger runs in parallel as a hot standby, the legacy
[`scripts/deploy.sh`](./scripts/deploy.sh) still works:

```bash
npm run deploy
```

That uploads via FTP to Hostinger's filesystem. Useful only if
Netlify is down, or for the few weeks after migration before we cut
the Hostinger plan. Once Hostinger is decommissioned this section
goes away.

## Supabase edge functions

Edge functions (`supabase/functions/*/index.ts`) are NOT touched by
Netlify or the lftp script. They live on Supabase's infrastructure
and ship via:

- **Supabase MCP** — `deploy_edge_function` tool from a Claude session
- **Supabase CLI** — `supabase functions deploy <name>`

Migrations under `supabase/migrations/` apply via MCP
(`apply_migration`) or `supabase db push`. The repo files are mirrors
of what's live — they exist for history + diffing.

## Database

Schema lives in Supabase. The `supabase/migrations/` directory is the
source of truth for repo-level history; any schema change made from
Claude / the dashboard should be mirrored into this directory as a
timestamped `.sql` file so git stays honest.

See [`docs/BACKUP_RESTORE.md`](./docs/BACKUP_RESTORE.md) for backup
strategy + quarterly restore drill.

## Why this flow (vs. the old manual `lftp`)

The previous flow was `npm run deploy` from a developer's Mac. It
failed in two ways:

1. **Bus factor**: only people with `.env.deploy` and lftp installed
   could ship. Forgetting to deploy after pushing left GitHub `main`
   ahead of the live site indefinitely (the audit on 2026-04-25
   surfaced multiple commits still un-deployed).
2. **Hostinger billing lock**: when the previous auto-deploy GitHub
   Action existed, a billing lockout caused 10 days of silent failed
   deploys before anyone noticed.

Netlify fixes both:
- Push-to-deploy, no per-developer setup.
- Free tier is generous enough that we don't hit billing edges. Plan
  surfaces are visible from one dashboard, not buried in cPanel.

The lftp script stays as the rollback path until we're confident
Netlify is bulletproof for our workload.
