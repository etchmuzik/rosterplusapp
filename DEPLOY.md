# Deploying ROSTR+

Deployment is **manual** from your Mac. We traded the auto-deploy GitHub
Action (broke when billing locked and nobody noticed for 10 days) for a
one-command local flow that's visible and easy to diagnose.

## One-time setup

1. Install lftp:
   ```bash
   brew install lftp
   ```
2. Copy the env file and set the FTP password:
   ```bash
   cp .env.deploy.example .env.deploy
   # edit .env.deploy, set FTP_PASSWORD=…
   ```
   `.env.deploy` is gitignored so the password stays on your machine.
3. Install Playwright so pre-deploy smoke tests actually run:
   ```bash
   npm install
   npx playwright install chromium
   ```
   (The deploy script still works without this — it just skips the
   smoke-test gate with a warning.)

## Everyday flow

```bash
git add <files>
git commit -m "feat: …"
git push origin main
npm run deploy
```

That's it. Takes ~15 seconds to upload. The live site picks up changes
immediately; visitors on a stale service-worker cache may need one
hard refresh (Cmd+Shift+R) to see new JS / CSS.

## What `npm run deploy` does

In order:

1. **Pre-flight syntax checks** — `node --check` on app.js, error-logger.js, sw.js. HTML well-formed check (every file closes `</html>`). Any failure aborts before a single byte ships.
2. **Playwright smoke tests** — spins up `http-server` on :8090, runs every `@smoke`-tagged spec against it. Any failure aborts.
3. **Build stamps** — writes the current git sha into:
   - `sw.js` → `CACHE_NAME = 'rostr-<sha>'` (rotates the service-worker cache bucket; old clients refetch on next navigation)
   - `assets/js/app.js` → `window.ROSTR_VERSION = '<sha>'` (support triage can eyeball "what build is this user running")
   - Every `<link>` / `<script>` in every HTML file → `?v=<sha>` query string (cache-busts the 1-year-immutable `/assets/**` without orphan files)
4. **lftp upload** — pushes everything except `node_modules/`, `supabase/`, `scripts/`, `e2e/`, `.git/`, `.github/`, `.claude/`, env files, README. Serial uploads (parallel dropped files on Hostinger).
5. **Cleanup trap** — on exit (success, failure, or Ctrl-C) all stamped files are restored from `.deploy-bak` copies so local git stays clean.

## Flags

```bash
npm run deploy:dry      # preview what would transfer, no upload
npm run deploy:full     # re-upload every file (after a rollback)
npm run deploy -- --skip-checks   # emergency hotfix, skip syntax/smoke gates
```

## Supabase edge functions

Edge functions (`supabase/functions/*/index.ts`) are NOT touched by the
FTP deploy. They live on Supabase's infrastructure and are updated via:

- Supabase MCP (`deploy_edge_function` tool) — used from Claude sessions
- Supabase CLI: `supabase functions deploy <name>`

Migrations under `supabase/migrations/` are applied via MCP
(`apply_migration`) or pushed with `supabase db push`. The files in the
repo are mirrors of what's live — they exist for history + diffing.

## Database

Schema lives in Supabase. The `supabase/migrations/` directory is the
source of truth for repo-level history; any schema change made from
Claude / the dashboard should be mirrored into this directory as a
timestamped `.sql` file so git stays honest.

See [`docs/BACKUP_RESTORE.md`](./docs/BACKUP_RESTORE.md) for backup +
restore-drill procedures.

## Emergency rollback

If a bad deploy goes live:

```bash
git revert HEAD          # revert the offending commit
git push origin main
npm run deploy:full      # re-upload every file to guarantee consistency
```

Service worker users will get the rolled-back version on their next
navigation (CACHE_NAME rotates with the new deploy sha).

If the site is completely down (white screen, 500s):

1. Check `curl -sI https://rosterplus.io/` — any Hostinger error page?
2. Check Supabase dashboard for an outage
3. Check `public.client_errors` for fresh runtime errors
4. Worst case, re-upload the last-known-good commit:
   ```bash
   git checkout <last-good-sha>
   npm run deploy
   git checkout main
   ```

## CI (GitHub Actions)

On every push to `main` and every PR:

- `ci.yml` → syntax check → HTML well-formed → Playwright smoke → visual regression → sitemap freshness check
- On PRs only: Lighthouse CI with gates (accessibility ≥0.90, SEO ≥0.95 hard-fail; perf + best-practices warn-only)

CI runs against a freshly-started `http-server`, so it catches broken
local paths, missing files, and bundle regressions before you deploy.

## Visual baselines

Visual-regression baselines are Linux Chromium PNGs committed under
`e2e/tests/visual.spec.js-snapshots/`. Since macOS and Linux antialias
differently, you can't generate them locally. Use the manual
`Visual Baseline Refresh` workflow on GitHub Actions (Actions tab →
Run workflow) to regenerate + auto-commit after an intentional design
change.

## Plan ahead

- **When billing is settled**, the natural target is Netlify / Cloudflare Pages — push-to-deploy, no FTP, automatic asset hashing.
- For now: manual deploy from the laptop avoids a silent-failure single point of failure and keeps the deploy flow visible.
