# Backup & Restore Runbook

Living document. Last drill: **2026-04-23** (pre-launch, 13 MB DB).

## What Supabase gives us for free

Project: `vgjmfpryobsuboukbemr` (region `eu-west-1`, Postgres 17.6).

Supabase Pro plan (the one we're on) includes:

- **Daily automated backups**, retained for **7 days**
- **Point-in-time recovery (PITR)** — NOT enabled by default; would need to be turned on in dashboard → Settings → Database → Point in Time Recovery. Currently we rely on the daily snapshot only.
- **Backup restores** are performed by Supabase support — not self-serve on Pro. Ticket turnaround is typically <4 hours during business hours.

This is fine for our scale today. **Once we pass ~100 bookings or one real revenue event, flip PITR on** (adds ~$100/mo but drops RPO from 24h to 2 min).

## What we add on top

Belt + suspenders — the daily auto-backup is Supabase's job, but we also keep a local rolling export so we're never fully dependent on a support ticket to recover.

### Weekly manual export (until we automate)

Run from any machine with `psql` + the service-role DB connection string:

```bash
# One-line dump — schema + data. ~13 MB uncompressed today, so it's instant.
pg_dump \
  "postgres://postgres.vgjmfpryobsuboukbemr:$SUPABASE_DB_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" \
  --no-owner --no-acl --schema=public --schema=auth \
  --file="rostr-$(date +%Y-%m-%d).sql"

# Optional: compress + encrypt
gzip "rostr-$(date +%Y-%m-%d).sql"
gpg --symmetric "rostr-$(date +%Y-%m-%d).sql.gz"
```

The result goes into `~/Backups/rostr/` on the owner's machine. Keep the last 8 weeks.

**Why schema=public + schema=auth only:** skipping `storage`, `realtime`, `_realtime` etc. saves the restore any foreign-key headaches against Supabase-internal schemas that the target project already has.

## Restore drill — dry-run checklist

Every quarter, prove the backup works by restoring into a throwaway branch. Never run a restore against the live project without confirming the drill worked first.

### 1. Create a Supabase branch

Branching doubles the DB into a preview environment for free — perfect disposable target.

```bash
# Via MCP / dashboard: Settings → Branches → Create branch "restore-drill-YYYY-MM-DD"
```

### 2. Restore the dump into the branch

```bash
# Replace BRANCH_HOST with the branch's pooler hostname from the dashboard.
psql "postgres://postgres.BRANCH_REF:$BRANCH_DB_PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" \
  --single-transaction \
  --file="rostr-YYYY-MM-DD.sql"
```

### 3. Verify row counts match what we expected

Run this against the branch and confirm every count matches the snapshot day:

```sql
SELECT
  (SELECT COUNT(*) FROM public.profiles) AS profiles,
  (SELECT COUNT(*) FROM public.artists) AS artists,
  (SELECT COUNT(*) FROM public.bookings) AS bookings,
  (SELECT COUNT(*) FROM public.reviews) AS reviews,
  (SELECT COUNT(*) FROM public.contracts) AS contracts,
  (SELECT COUNT(*) FROM public.payments) AS payments;
```

Current baseline (2026-04-23): **4 profiles, 14 artists, 0 bookings, 0 reviews, 0 contracts, 0 payments.** DB size 13 MB.

### 4. Spot-check an artist record

```sql
SELECT id, stage_name, verified, claimed_at FROM public.artists
 ORDER BY created_at DESC LIMIT 3;
```

Compare against what's visible on `/directory.html` today.

### 5. Delete the branch

```bash
# Dashboard → Branches → ⋯ → Delete. Branches cost money; kill when done.
```

## Actual-disaster playbook

If the live DB is corrupted or wiped:

1. **Stop the site** — push a Hostinger maintenance page (`index.html` → "We'll be back") so users can't write new data to a half-broken state.
2. **Open a P1 Supabase support ticket** — include project ref `vgjmfpryobsuboukbemr`, target restore timestamp (UTC), and a one-line description.
3. **Prepare the local export** — if we have a `rostr-YYYY-MM-DD.sql.gz` within RPO tolerance, gpg-decrypt it so it's ready.
4. **While Supabase works:** communicate on status.rosterplus.io → "restoring from backup". Even two lines of copy reassure users that we know, we have a plan, we're not ghosting.
5. **After restore lands:**
   - Re-run the health edge function: `curl https://rosterplus.io/functions/v1/health`
   - Hit `/status.html` in a browser and confirm cron + RPCs go green
   - Smoke-test a booking flow end-to-end (create → accept → contract)
   - Tell users on status page + send a post-mortem email to anyone affected

## Owner + escalation

- **Primary:** beyondtech.eg@gmail.com (site owner)
- **Secondary:** h.saied@outlook.com
- **Supabase support:** https://supabase.com/dashboard → "?" → Contact support (paid-tier priority)

## Open tasks (promote when we cross the threshold)

- [ ] Enable Point-in-Time Recovery when we pass **100 bookings** or first real payment received
- [ ] Automate the weekly dump via GitHub Action + upload to cold storage (R2 / B2) — target cost <$1/mo
- [ ] Replace encrypted local dumps with off-site storage that survives owner laptop loss
- [ ] Add a smoke-test step that restores yesterday's dump into a throwaway branch every Sunday and fails the deploy if row counts don't match within 1%
