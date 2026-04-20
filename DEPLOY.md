# Deploying ROSTR+

Deployment is **manual**, triggered from your Mac. It replaced the GitHub
Actions workflow (which broke when the GitHub account billing locked).

## First-time setup (once per machine)

1. Install lftp:
   ```bash
   brew install lftp
   ```
2. Copy the example env file and fill in the FTP password:
   ```bash
   cp .env.deploy.example .env.deploy
   # then edit .env.deploy and set FTP_PASSWORD=...
   ```
   `.env.deploy` is gitignored — the password never leaves your machine.

## Everyday flow

After committing + pushing to `main`, run:

```bash
npm run deploy
```

That mirrors the repo to `ftp://72.60.93.208/` (Hostinger), skipping
`.git`, `node_modules`, `supabase/`, `scripts/`, `.env*`, etc.

Takes ~15s on a decent connection. The live site picks up changes immediately;
visitors on the old service-worker cache may need a hard refresh.

## Flags

```bash
npm run deploy:dry    # preview what would transfer, no uploads
npm run deploy:full   # re-upload every file (useful after a rollback)
```

## Emergency restore

If a bad deploy goes out:

```bash
git revert HEAD       # revert the offending commit
npm run deploy        # push the reverted tree
```

## Why not auto-deploy anymore?

The previous `.github/workflows/deploy.yml` used GitHub Actions to FTP
on every push to `main`. When GitHub billing locked, every deploy silently
failed and the live site drifted 10 days behind `main`.

Manual deploy from the laptop avoids that single point of failure. A future
move to Netlify or Cloudflare Pages (push → CDN) would remove the manual
step entirely, but that's a DNS change and can wait.
