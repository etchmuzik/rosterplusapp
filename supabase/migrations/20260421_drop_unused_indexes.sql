-- ═══════════════════════════════════════════════════════════
-- Drop unused indexes flagged by Supabase's performance advisor.
--
-- None of these have been used in production. They were either:
--   a) created defensively for queries we never wrote,
--   b) superseded by compound indexes, or
--   c) duplicates of FK auto-indexes.
--
-- If any of these turn out to be needed once real traffic arrives,
-- recreate them as needed — the DDL is cheap and reversible.
--
-- Applied live via Supabase MCP on 2026-04-21.
-- ═══════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.idx_artists_profile_id;
DROP INDEX IF EXISTS public.idx_artists_status;
DROP INDEX IF EXISTS public.idx_bookings_artist_id;
DROP INDEX IF EXISTS public.idx_bookings_venue_id;
DROP INDEX IF EXISTS public.bookings_promoter_active_idx;
DROP INDEX IF EXISTS public.bookings_artist_active_idx;
DROP INDEX IF EXISTS public.idx_messages_booking_id;
DROP INDEX IF EXISTS public.idx_contracts_booking_id;
DROP INDEX IF EXISTS public.idx_payments_booking_id;
DROP INDEX IF EXISTS public.idx_payments_artist_confirmed;
DROP INDEX IF EXISTS public.idx_payments_promoter_recorded;
DROP INDEX IF EXISTS public.notifications_user_unread_idx;
DROP INDEX IF EXISTS public.notifications_user_created_idx;
DROP INDEX IF EXISTS public.admin_audit_log_created_idx;
DROP INDEX IF EXISTS public.admin_audit_log_actor_idx;
DROP INDEX IF EXISTS public.admin_audit_log_target_idx;
