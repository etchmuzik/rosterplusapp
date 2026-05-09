# Deploying ROSTR+

**Push to `main` → GitHub Actions deploys to Hostinger via FTP.** That's
the design. There is currently a **billing lockout on the GitHub
Actions account** (see [Account billing](#account-billing) below)
which blocks the auto-deploy. Until that's resolved, use:

```bash
npm run ship
```

…from `web/`, which pushes `main` and then runs the FTP deploy
locally. Same end result, no humans-in-the-loop except yourself.

## Everyday flow (target state)

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

## Everyday flow (current state, while Actions is billing-locked)

```bash
git add <files>
git commit -m "feat: …"
git push origin main      # ← pre-push hook deploys to Hostinger first
```

A `pre-push` git hook (installed by `bash scripts/install-hooks.sh`,
see below) runs `bash scripts/deploy.sh --skip-checks` **before**
allowing the push to complete. If the deploy fails, the push is
aborted — `origin/main` cannot advance ahead of what's live.

The hook fires only on pushes to `main`. Feature branch pushes are
unaffected.

`npm run ship` is still wired as a no-hook fallback (commit fd6c8d3),
useful from machines that don't have the hook installed.

### One-time setup after cloning

```bash
cd web
bash scripts/install-hooks.sh
```

Copies `scripts/git-hooks/*` into `.git/hooks/`. Idempotent — re-run
after pulling a hook change. Required only on machines that will
deploy (need `web/.env.deploy` populated too).

### Bypassing the hook

When you legitimately need to push without deploying (Hostinger is
down, you're pushing a `docs/` change you'll deploy in a batch later,
etc.):

```bash
SKIP_DEPLOY_HOOK=1 git push origin main
# or
git push --no-verify origin main
```

Either form skips the deploy. Use sparingly — every bypass is an
opportunity for `main` to drift ahead of the live site.

## Account billing

GitHub Actions runs on this repo are currently failing with
`The job was not started because your account is locked due to a
billing issue`. Every push since 2026-04-29 has failed CI for the same
reason; this is what made the 2026-04-30 EPK incident possible (no
deploy, no test gate, no signal).

Fix:
1. Go to https://github.com/settings/billing
2. Resolve the outstanding charge or update the payment method
3. Re-run the latest workflow on the Actions tab

Once that's clear, every subsequent push deploys automatically and
`npm run ship` becomes redundant (delete `scripts/push.sh` then).

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
