-- Hard-delete Goomgum + ENAI per operator request (2026-05-12).
--
-- Supersedes the soft-delete from 20260512_roster_adjust_v2.sql.
-- The rows simply no longer exist after this migration.
--
-- Safety pre-check (confirmed before applying):
--   - Both rows have profile_id = NULL (unclaimed scout rows, no
--     auth.users / profiles cascade).
--   - Zero bookings reference these artist UUIDs.
--   - Zero booking_events transitively reference them.
--
-- Idempotent: re-running deletes zero rows once they're gone.

DELETE FROM public.artists
 WHERE stage_name IN ('Goomgum', 'ENAI')
   AND profile_id IS NULL;
