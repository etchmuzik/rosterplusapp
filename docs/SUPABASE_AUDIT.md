# Supabase Audit — 2026-04-24

Full A-to-Z audit of the live Supabase project `vgjmfpryobsuboukbemr`
("roster new"). Every section below was produced by probing the live
project via MCP, not by reading repo files.

## 1. Project snapshot

| | |
|---|---|
| Ref | `vgjmfpryobsuboukbemr` |
| Name | roster new |
| Region | `eu-west-1` |
| Postgres | 17.6.1.104 (GA release channel) |
| Status | `ACTIVE_HEALTHY` |
| Created | 2026-04-05 |
| DB size | 13 MB |
| Active connections | 1 |

## 2. Advisors — security

Ran Supabase's security linter. Two findings, both INFO/WARN level.

| Level | Issue | Table/Entity | Notes |
|---|---|---|---|
| INFO | `rls_enabled_no_policy` | `public.admin_rate_counter` | RLS is on but zero policies — so nobody can read/write via the anon/auth API. That's the **intended** state: it's only touched by `_admin_rl_hit()` which runs as SECURITY DEFINER. Safe. |
| WARN | `auth_leaked_password_protection` | Auth | HaveIBeenPwned check is disabled. **Action:** enable in Dashboard → Authentication → Settings → Password security |

No CRITICAL / HIGH / MEDIUM security issues. RLS is enabled on all 15
public tables.

## 3. Advisors — performance

Ran the performance linter. All findings are INFO/WARN; none block
today's workload (13 MB DB, <100 rows in most tables).

### Unused indexes (15)
Created by earlier perf-hardening migrations but never served a query
because the corresponding tables are still near-empty. **Decision: keep
them.** They cost bytes; scrapping them now only to re-add when rows
arrive is churn. Revisit when any table passes ~10k rows.

Flagged:
- `bookings`: `idx_bookings_alive`, `idx_bookings_artist_id`, `idx_bookings_venue_id`, `idx_bookings_review_prompt_pending`
- `artists`: `idx_artists_alive`, `idx_artists_profile_id`
- `messages`: `idx_messages_booking_id`
- `contracts`: `idx_contracts_booking_id`
- `payments`: `idx_payments_booking_id`
- `reviews`: `idx_reviews_target`, `idx_reviews_booking`
- `email_events`: `idx_email_events_created`, `idx_email_events_type`, `idx_email_events_resend`
- `admin_rate_counter`: `idx_admin_rate_counter_bucket`

### Unindexed foreign keys (1)
- `public.client_errors.user_id_fkey` — the `user_id` FK on the error
  logger table has no covering index. Low priority (we query by
  `created_at` for pruning, not by user). **Action: optional** — add
  `CREATE INDEX idx_client_errors_user_id ON client_errors(user_id)`
  if we ever add a "show me this user's errors" admin view.

### Multiple permissive policies (14 warnings)
Apache-merge-style overlap on `bookings`, `profiles`, `reviews`. For
each (role, action) pair, both the admin policy AND the owner policy
match — Postgres evaluates both. Correctness is fine (OR-combined),
but every SELECT on these tables runs 2 policy predicates when 1 would
do. **Action: low-pri consolidation.** Merge into a single
`USING (is_owner OR is_admin())` predicate per table.

## 4. Extensions in use

| Extension | Schema | Version | Use |
|---|---|---|---|
| `plpgsql` | pg_catalog | 1.0 | PL/pgSQL language |
| `pg_cron` | pg_catalog | 1.6.4 | 8 scheduled jobs |
| `pg_net` | extensions | 0.20.0 | Async HTTP from cron jobs to edge functions |
| `pgcrypto` | extensions | 1.3 | `gen_random_uuid()` on reviews + invitations |
| `uuid-ossp` | extensions | 1.1 | Legacy UUID generator (`uuid_generate_v4`) |
| `pg_stat_statements` | extensions | 1.11 | Query profiling |
| `pg_graphql` | graphql | 1.5.11 | Supabase-managed GraphQL layer |
| `supabase_vault` | vault | 0.3.1 | Secret storage |

Everything else available on Supabase (postgis, pgvector, pgmq, etc.) is
installed at the cluster level but not enabled in this project. Good
hygiene.

## 5. Tables (15 total, all RLS-enabled)

| Table | Rows | RLS | Policies |
|---|---|---|---|
| `profiles` | 5 | ✓ | 4 |
| `artists` | 14 | ✓ | 4 |
| `bookings` | 0 | ✓ | 6 |
| `contracts` | 0 | ✓ | 4 |
| `payments` | 0 | ✓ | 3 |
| `messages` | 0 | ✓ | 3 |
| `reviews` | 0 | ✓ | 5 |
| `venues` | 0 | ✓ | 3 |
| `notifications` | 0 | ✓ | 3 |
| `invitations` | 0 | ✓ | 2 |
| `email_events` | 0 | ✓ | 1 |
| `client_errors` | 9 | ✓ | 2 |
| `admin_audit_log` | 0 | ✓ | 1 |
| `admin_rate_counter` | 0 | ✓ | 0 (intentional — see §2) |
| `cron_runs` | 31 | ✓ | 1 |

## 6. Auth

| | |
|---|---|
| Total users | 5 |
| Email-confirmed | 5 |
| Banned (active) | 0 |
| Deleted | 0 |
| Active in last 7d | 1 |
| Active in last 30d | 3 |

Profile-vs-user integrity check: **all 5 auth.users have a matching
`profiles` row** via the `handle_new_user` trigger. No orphans.

Roles snapshot: 4 promoters + 1 artist. No admins in `public.profiles.role`
because admin-ness is determined by static email allowlist in
`public.is_admin()`, not by the role column.

## 7. Storage

Single bucket: **`artist-media`** (public, 0 objects, 0 bytes).
No uploads yet — artists haven't started populating their EPK galleries
through the avatar/gallery flow. Bucket policies are tight (tenant-prefixed
paths, 10 MB cap, content-type allowlist — enforced by the
`storage_tighten_artist_media` migration).

## 8. Edge functions (12)

| Function | JWT | Version | Purpose |
|---|---|---|---|
| `signup` | ❌ open | v4 | Custom signup bypassing Supabase SMTP |
| `send-email` | ✅ required | **v10** | 11 transactional templates (booking, contract, payment, invitation, 3-step drip, review prompt) |
| `send-password-reset` | ❌ open | v2 | Custom recovery-link generator + Resend dispatch |
| `health` | ❌ open | v1 | `/functions/v1/health` — probed by `/status.html` |
| `profile-share` | ❌ open | v1 | Edge-rendered OG tags for link-preview bots |
| `resend-webhook` | ❌ open | v1 | Ingests Resend delivery events into `email_events` |
| `stripe-webhook` | ❌ open | v2 | Stripe event ingestion (dormant — Stripe deferred) |
| `admin-user-action` | ✅ required | v2 | Suspend / unsuspend / magic-link-as-user / resend welcome |
| `admin-daily-digest` | ❌ open | v1 | Admin's morning summary email — cron-invoked |
| `send-booking-reminders` | ❌ open | v3 | 24h-before-event reminders — cron-invoked |
| `send-artist-onboarding-drip` | ❌ open | v1 | 1h / 24h / 72h artist drip — cron-invoked |
| `send-review-prompts` | ❌ open | v1 | Post-event rating prompt — cron-invoked |

**JWT posture.** The 8 `verify_jwt: false` functions all handle one of
three legitimate auth patterns:
- **Webhook** (`resend-webhook`, `stripe-webhook`) — verified via
  signature header, not JWT
- **Cron caller** (`send-*`, `admin-daily-digest`) — verified via
  `CRON_SECRET` shared-secret header passed by pg_cron
- **Public** (`health`, `profile-share`) — no auth by design
- **Anon entry** (`signup`, `send-password-reset`) — public flows that
  must work before the user has a session

All three patterns verify identity inside the function body rather than
at the platform level. Correct.

## 9. RPCs (34 total)

Every RPC in the `public` schema:

| RPC | Security | Purpose |
|---|---|---|
| `is_admin()` | DEFINER | Email allowlist gate |
| `_current_email()` | DEFINER | Internal helper |
| `_admin_rl_hit(action)` | DEFINER | Rate-limit counter increment |
| `_admin_rl_hit_for(admin_id, action)` | DEFINER | Same, service-role variant |
| `_artist_user_id(artist_id)` | DEFINER | Resolve artist → profile UID |
| `admin_list_users()` | DEFINER | Admin Users tab |
| `admin_stats()` | DEFINER | Admin dashboard stats tile |
| `admin_email_stats(hours)` | DEFINER | Admin Emails tab aggregates |
| `admin_broadcast_notification(title, body, href, filter_role)` | DEFINER | Bulk notification blast |
| `admin_force_cancel_booking(booking_id, reason)` | DEFINER | Admin moderation action |
| `admin_update_user_role(user_id, role)` | DEFINER | Role change (admin-only) |
| `admin_undo_last_action(target_type, target_id)` | DEFINER | One-shot undo for admin mutations |
| `log_admin_action(action, target_type, target_id, meta)` | DEFINER | Fire-and-forget admin audit write |
| `log_impersonation_event(admin_email, action, target_type, target_id, meta)` | DEFINER | Impersonated-session audit |
| `log_cron_run(job, status, duration_ms, error, meta)` | DEFINER | Cron self-logging helper |
| `claim_artist_profile(artist_id)` | DEFINER | Artist claims unclaimed profile |
| `create_review(booking_id, rating, comment)` | DEFINER | Party-to-booking gated review upsert |
| `review_stats_for_user(user_id)` | DEFINER | Aggregate stats (count + avg) |
| `reviews_for_user(user_id, limit)` | DEFINER | Public reviews list |
| `cron_health_summary()` | DEFINER | Admin Health tab RPC |
| `cron_health_public()` | DEFINER | Anonymised variant for `/status.html` |
| `cron_history_7d(job)` | DEFINER | Legacy — per-day strip for booking-reminders |
| `expire_stale_contracts()` | DEFINER | Called by cron job 9 |
| `handle_new_user()` | DEFINER | Trigger on auth.users insert |
| `notify_booking_event()` | DEFINER | Booking trigger → notifications insert |
| `notify_contract_event()` | DEFINER | Contract trigger → notifications insert |
| `notify_message_event()` | DEFINER | Message trigger → notifications insert |
| `notify_payment_event()` | DEFINER | Payment trigger → notifications insert |
| `audit_artist_change()` | DEFINER | Artist update trigger → admin_audit_log |
| `audit_artist_insert()` | DEFINER | Artist insert trigger → admin_audit_log |
| `prevent_role_change()` | INVOKER | Profile BEFORE UPDATE trigger — blocks role escalation |
| `current_role()` | DEFINER | Returns caller's role |
| `rls_auto_enable()` | DEFINER | DDL guardrail for future tables |
| `generate_invoice_number()` | INVOKER | Internal helper |

**Observation**: only two INVOKER functions (`generate_invoice_number`,
`prevent_role_change`). Everything else runs as DEFINER which is correct
— mutation RPCs need to bypass the caller's limited RLS to do their
job, and `SET search_path = public` is applied to all of them (confirmed
during the `lock_function_search_paths` migration).

## 10. Triggers (10)

| Table | Trigger | When | Event | Function |
|---|---|---|---|---|
| `artists` | `trg_audit_artist` | AFTER | UPDATE | `audit_artist_change` |
| `artists` | `trg_audit_artist_insert` | AFTER | INSERT | `audit_artist_insert` |
| `bookings` | `trg_notify_booking` | AFTER | INSERT / UPDATE | `notify_booking_event` |
| `contracts` | `trg_notify_contract` | AFTER | INSERT / UPDATE | `notify_contract_event` |
| `messages` | `trg_notify_message` | AFTER | INSERT | `notify_message_event` |
| `payments` | `trg_notify_payment` | AFTER | INSERT / UPDATE | `notify_payment_event` |
| `profiles` | `profiles_lock_role` | BEFORE | UPDATE | `prevent_role_change` |
| _auth.users_ | `on_auth_user_created` | AFTER | INSERT | `handle_new_user` (in auth schema) |

## 11. Realtime publication

`supabase_realtime` publishes two tables:
- `public.messages` — powers the chat surface on `messages.html`
- `public.notifications` — powers the nav bell

Nothing else is in the publication, which is correct: broadcasting
`bookings` / `contracts` / `payments` to every connected client would
be a privacy leak and useless bandwidth (their UIs refetch on nav).

## 12. Cron jobs (8 active)

All 8 jobs self-log to `cron_runs` after the 2026-04-24
self-logging retrofit migration.

| Job | Schedule (UTC) | Runs last 24h | Errors last 24h |
|---|---|---|---|
| `send-booking-reminders` (id 2) | `0 * * * *` hourly | 24 | 0 |
| `admin-daily-digest` (id 6) | `0 5 * * *` daily | 2 | 0 |
| `expire-stale-contracts` (id 9) | `0 2 * * *` daily | 1 | 0 |
| `prune-client-errors` (id 10) | `0 3 * * *` daily | 1 | 0 |
| `prune-cron-runs` (id 11) | `0 4 * * 0` weekly | 0 (next Sun) | 0 |
| `prune-email-events` (id 12) | `30 3 * * *` daily | 0 (fires 03:30) | 0 |
| `send-artist-onboarding-drip` (id 13) | `30 * * * *` hourly | 1 | 0 |
| `send-review-prompts` (id 14) | `0 10 * * *` daily | 0 (fires 10:00) | 0 |

All systems operational. No errors in the last 24h across any job.

## 13. Foreign key constraints

| From | → To | ON DELETE |
|---|---|---|
| `artists.profile_id` | `profiles.id` | CASCADE |
| `bookings.artist_id` | `artists.id` | NO ACTION |
| `bookings.promoter_id` | `profiles.id` | NO ACTION |
| `bookings.venue_id` | `venues.id` | NO ACTION |
| `contracts.booking_id` | `bookings.id` | CASCADE |
| `invitations.invited_by` | `profiles.id` | NO ACTION |
| `messages.booking_id` | `bookings.id` | NO ACTION |
| `messages.receiver_id` | `profiles.id` | NO ACTION |
| `messages.sender_id` | `profiles.id` | NO ACTION |
| `payments.booking_id` | `bookings.id` | NO ACTION |
| `reviews.booking_id` | `bookings.id` | CASCADE |
| `venues.created_by` | `profiles.id` | NO ACTION |

**Note**: `NO ACTION` will reject a `DELETE FROM profiles` when the
user has any bookings / messages / venues. That's intentional — we use
`profiles.deleted_at` for soft-delete, never hard-delete, so the
constraint is a guard rail not a day-to-day concern.

## 14. Migrations — drift from repo

**Live project has 39 migrations** (via `list_migrations`). **Repo
carries 30 `.sql` files** in `supabase/migrations/`.

The drift is expected — several early migrations (the initial schema,
the auto-profile trigger, the initial 14-artist seed, the
claim-artist RPC) were applied via the Supabase CLI or dashboard before
we standardised on "mirror every live migration into the repo." The
gap is historical, not ongoing.

**Live-only (not mirrored in repo):**
- `20260405151417_create_rostr_schema`
- `20260405151444_add_auto_profile_trigger`
- `20260405200237_create_artist_media_storage_bucket`
- `20260419143453_lock_function_search_paths`
- `20260419151629_seed_initial_14_artists`
- `20260419152433_claim_artist_profile_rpc`
- `20260419155402_perf_fk_indexes_rls_initplan`
- `20260421090154_admin_artist_management`
- `20260421090712_contracts_audit_log`

**Action** (low-pri but nice-to-have): dump these 9 missing migrations
from the Supabase dashboard and commit them so `supabase/migrations/`
is a faithful mirror. Not a correctness issue — the repo is authoritative
for code, Supabase is authoritative for schema.

## 15. Action items — prioritised

Nothing here is on fire. All items are hygiene.

### Now
1. **Enable HaveIBeenPwned leaked-password check** in Dashboard → Auth
   → Password security. Takes 30 seconds, zero downtime.

### Soon
2. **Consolidate overlapping RLS policies** on `bookings`, `profiles`,
   `reviews` — 14 advisor warnings. Single `USING (is_owner OR is_admin())`
   per (table, action) instead of two separate policies.
3. **Backfill the 9 missing migration SQL files** into
   `supabase/migrations/` so the repo mirror is complete. Dashboard →
   Database → Migrations exports the SQL for each.

### Later
4. **Add covering index** `CREATE INDEX idx_client_errors_user_id ON
   public.client_errors(user_id)` if/when an admin "user-level error
   history" view is built.
5. **Enable Point-in-Time Recovery** when we cross 100 bookings or
   the first real payment lands (tracked in `docs/BACKUP_RESTORE.md`).
6. **Revisit unused indexes** when any table passes ~10k rows. Today
   they're cheap insurance against the first slow query.

### Not planned
- The 15 unused indexes — keep them until we have real data to know
  which access patterns matter.
- The `admin_rate_counter` "no policy" warning — intentional, DEFINER-only.
- Any new extension installs — current set covers all active features.

## 16. Summary

**Status: healthy.** 13 MB DB, 5 users, 15 RLS-enabled tables, 12 edge
functions all active, 8 cron jobs all green in the last 24h, zero
critical/high advisors, one low-impact auth setting to flip.
