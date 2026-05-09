# Deploying ROSTR+

**Push to `main` → GitHub Actions deploys to Hostinger via FTP.** That's
the whole flow. No human runs anything by hand.

## Everyday flow

```bash
git add <files>
git commit -m "feat: …"
git push origin main
```

Done. The `deploy` job in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
fires automatically. It runs **after** the `checks` job is green —
broken JS, missing `</html>`, or a failing `@smoke` Playwright test
fails CI before any FTP traffic happens.

Live in ~3 minutes (Playwright suite is the slowest step). CDN
propagation takes a few additional seconds.

## What the deploy job does

1. **Checkout** at the deploying SHA.
2. **Install** `lftp`.
3. **Stamp** the build via `bash scripts/deploy-stamp.sh`:
   - `sw.js` → `CACHE_NAME = 'rostr-<sha>'`
   - `assets/js/app.js` → `window.ROSTR_VERSION = '<sha>'` at the top
   - Every `<link>` / `<script>` reference to `/assets/*.{css,js}` in
     every HTML file → `?v=<sha>` query string
4. **Build the file list** (same exclusions as
   [`scripts/deploy.sh`](./scripts/deploy.sh) — no `node_modules/`,
   `.git/`, `scripts/`, `supabase/`, `e2e/`, `docs/`, test artifacts).
5. **Upload** every file to Hostinger via per-file `lftp put -O`. We
   don't use `mirror --reverse` because Hostinger's FTP server returns
   Arabic-locale timestamps that confuse lftp's diffing logic.
6. **Verify** the live homepage shows the just-deployed
   `ROSTR_VERSION = '<sha>'`. Mismatch logs a warning (Hostinger's
   edge cache can lag a couple of minutes); upload itself has already
   succeeded by this point.

## Required GitHub Actions secrets

Settings → Secrets and variables → Actions → Repository secrets:

| Secret | Value | Notes |
|---|---|---|
| `FTP_HOST` | Hostinger FTP host | Same as `web/.env.deploy` |
| `FTP_USER` | FTP user | Same |
| `FTP_PASSWORD` | FTP password | Same |
| `FTP_REMOTE_DIR` | `/` | Maps to public_html on Hostinger |

These mirror `web/.env.deploy` (which is gitignored). Any rotation
happens in **both** places — registry + GitHub secrets.

## CI gates (run before deploy)

The `checks` job in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
runs on every push and PR:

- `node --check` on `app.js`, `error-logger.js`, `sw.js`
- HTML well-formed check (every `*.html` closes `</html>`)
- Playwright `@smoke`-tagged tests against a local static server

The `visual` job (pixel-diff snapshots) and `lighthouse` job (PR-only)
run in parallel. Only `checks` gates `deploy`.

## Rolling back

Three paths, fastest first:

1. **Re-run the previous green deploy**: GitHub Actions → workflow run
   on the last good commit → "Re-run all jobs". The deploy job
   re-stamps and re-uploads. Live in ~3 minutes.
2. **Git revert + push**: `git revert <sha> && git push origin main`
   triggers a fresh deploy of the reverted state. Standard,
   git-native, audit-trailed.
3. **Manual emergency** (CI broken, GitHub down): from a dev machine
   with `web/.env.deploy` populated:
   ```bash
   cd web
   bash scripts/deploy.sh --skip-checks
   ```
   Same lftp logic the CI runs, just from your terminal.

## Custom domain

`rosterplus.io` DNS is at Hostinger's nameservers
(`{aurora,nebula}.dns-parking.com`). Apex points at Hostinger's CDN
edge IPs. SSL cert is provisioned and auto-renewed by Hostinger.

When the eventual Netlify cutover happens, this whole document
shrinks to "Push to main → Netlify deploys" and the GitHub Actions
deploy job becomes redundant — kill it then, not before.

## Concurrency

The `deploy` job is gated by a `concurrency: deploy-hostinger` group.
Two pushes that land back-to-back **serialize** — the second waits
for the first to finish, then runs against the latest commit. We
never run two FTP uploads in parallel against the same target.

## Supabase edge functions

Edge functions (`supabase/functions/*/index.ts`) are NOT touched by
this workflow. They ship separately:

- **Supabase MCP** — `deploy_edge_function` tool from a Claude session
- **Supabase CLI** — `supabase functions deploy <name>`

Migrations under `supabase/migrations/` apply via MCP
(`apply_migration`) or `supabase db push`. The repo files are mirrors
of what's live — they exist for history + diffing parity.

## Database

Schema lives in Supabase. `supabase/migrations/` is the source of
truth for repo-level history; any schema change made from Claude or
the Supabase dashboard should be mirrored into this directory as a
timestamped `.sql` file so git stays honest.

See [`docs/BACKUP_RESTORE.md`](./docs/BACKUP_RESTORE.md) for the
backup strategy and quarterly restore drill.

## Why this flow

Before this workflow existed, deploys were `npm run deploy` from a
developer's Mac. That failed twice:

1. **Bus factor**: only people with `.env.deploy` and lftp could
   ship. Forgetting to deploy after pushing left `main` ahead of the
   live site indefinitely. The 2026-04-30 EPK incident — five days of
   committed-but-undeployed fixes that ended in a "page not working"
   bug report — is the reference example.
2. **Pre-deploy gates skipped**: a fix in a hurry skipped tests; the
   live site picked up the regression.

GitHub Actions fixes both: push-to-deploy, no per-developer setup,
and the same `checks` job that runs on every PR also gates the live
deploy. The lftp script stays as the rollback path.
