-- Restrict EXECUTE on the remaining 25 anon-callable SECURITY DEFINER
-- functions flagged by the 2026-04-29 advisor.
--
-- After 20260429115330_revoke_execute_on_trigger_class_functions.sql
-- handled the 10 trigger-class entries, the advisor still listed 25
-- callable from anon. This migration sorts those 25 into three buckets:
--
--   1. Revoked from anon only (17). These need authenticated context to
--      do anything useful — admin RPCs (all internally gated by
--      is_admin()), admin rate-limit helpers, the dormant reviews API,
--      claim_artist_profile, and internal helpers not used by RLS.
--
--   2. Revoked from anon AND authenticated (2). These are called only
--      by pg_cron + edge functions running as service_role.
--
--   3. Kept anon-callable, documented with COMMENT as intentional (6).
--      Either used inside RLS USING/WITH CHECK for anon-role queries
--      (is_admin, current_role) or deliberately public (check_availability,
--      cron_health_*, status page).
--
-- Net effect: anon_security_definer_function_executable advisor count
-- drops 25 → 6, and the remaining 6 are no longer ambiguous — the
-- COMMENT explains why each one is anon-callable on purpose.
--
-- Source: 2026-04-29 audit cited in shared/STATUS.md "Outstanding
-- follow-ups" section.

-- ── 1. Revoke from anon only ─────────────────────────────────────────

-- Admin internals (callers gated by is_admin() server-side anyway)
REVOKE EXECUTE ON FUNCTION public._admin_rl_hit(text)                                                   FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._admin_rl_hit_for(uuid, text)                                          FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.log_admin_action(text, text, uuid, jsonb)                              FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.log_impersonation_event(text, text, text, uuid, jsonb)                 FROM anon, public;

-- Admin RPCs
REVOKE EXECUTE ON FUNCTION public.admin_broadcast_notification(text, text, text, text)                   FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_email_stats(integer)                                             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_force_cancel_booking(uuid, text)                                 FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_list_users()                                                     FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_stats()                                                          FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_undo_last_action(text, uuid)                                     FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_role(uuid, text)                                     FROM anon, public;

-- Authenticated-only client RPCs
REVOKE EXECUTE ON FUNCTION public.claim_artist_profile(uuid)                                             FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.create_review(uuid, integer, text)                                     FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.review_stats_for_user(uuid)                                            FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reviews_for_user(uuid, integer)                                        FROM anon, public;

-- Internal helpers NOT referenced inside RLS policies (verified by
-- pg_policy scan 2026-05-09 — neither appears in any USING/WITH CHECK)
REVOKE EXECUTE ON FUNCTION public._artist_user_id(uuid)                                                  FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._current_email()                                                       FROM anon, public;

-- ── 2. Revoke from anon AND authenticated (cron / service_role only) ─

-- Called by pg_cron jobs running as the postgres role (cron.alter_job
-- + the function header sets search_path; service_role still allowed
-- for ad-hoc invocation by the operator).
REVOKE EXECUTE ON FUNCTION public.expire_stale_contracts()                                               FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.log_cron_run(text, text, integer, text, jsonb)                         FROM anon, authenticated, public;

-- ── 3. Keep anon EXECUTE — document as intentional ───────────────────

COMMENT ON FUNCTION public.is_admin() IS
  'Used inside RLS USING/WITH CHECK clauses on bookings, artists, '
  'reviews, admin_audit_log, client_errors, cron_runs, email_events. '
  'Anon-role queries on those tables need EXECUTE to evaluate the '
  'policy (returns false for anon). Anon-callable is intentional.';

COMMENT ON FUNCTION public.current_role() IS
  'Used inside RLS WITH CHECK clauses on bookings + payments INSERT '
  'policies (gates promoter-only writes). Anon queries can''t reach '
  'those INSERT paths anyway, but EXECUTE must be granted for the '
  'policy expression to evaluate without function-level error.';

COMMENT ON FUNCTION public.check_availability(uuid, date) IS
  'Public availability lookup — both web and iOS hit this BEFORE login '
  'on the artist directory / EPK pages. Anon EXECUTE is intentional. '
  'See shared/RPC_CONTRACT.md.';

COMMENT ON FUNCTION public.cron_health_public() IS
  'Powers the public status.html dashboard. Anon EXECUTE is intentional.';

COMMENT ON FUNCTION public.cron_health_summary() IS
  'Powers the public status.html dashboard. Anon EXECUTE is intentional.';

COMMENT ON FUNCTION public.cron_history_7d(text) IS
  'Powers the public status.html dashboard. Anon EXECUTE is intentional.';
