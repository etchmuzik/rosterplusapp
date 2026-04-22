-- Restore FK-covering indexes that the previous drop-unused-indexes
-- sweep over-pruned. The performance advisor flagged every missing
-- FK index under 0001_unindexed_foreign_keys.
--
-- Without these, any FK validation (INSERT/UPDATE/DELETE touching
-- the child) does a seq scan on the parent. At zero rows today it's
-- irrelevant, but it will bite the moment real traffic hits.
--
-- Applied live via Supabase MCP on 2026-04-23.

CREATE INDEX IF NOT EXISTS idx_artists_profile_id         ON public.artists(profile_id);
CREATE INDEX IF NOT EXISTS idx_bookings_artist_id         ON public.bookings(artist_id);
CREATE INDEX IF NOT EXISTS idx_bookings_venue_id          ON public.bookings(venue_id);
CREATE INDEX IF NOT EXISTS idx_contracts_booking_id       ON public.contracts(booking_id);
CREATE INDEX IF NOT EXISTS idx_messages_booking_id        ON public.messages(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id        ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id      ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor_id   ON public.admin_audit_log(actor_id);
